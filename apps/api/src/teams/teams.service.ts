import { BadRequestException, ConflictException, ForbiddenException, GoneException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type OrgRole, type PrismaClient } from '@mya/db';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PRISMA } from '../prisma.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { ROLE_RANK, type AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { CreditsService } from '../credits/credits.service.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { FlagsService } from '../flags/flags.service.js';

export const InviteRoleSchema = z.enum(['admin', 'member', 'viewer']);
export const CreateWorkspaceSchema = z.object({ name: z.string().trim().min(2).max(60) });
export const InviteSchema = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()), role: InviteRoleSchema.default('member') });
export const RoleChangeSchema = z.object({ role: InviteRoleSchema });
export const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

const INVITE_DAYS = 7;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const maskEmail = (e: string) => {
  const [local = '', domain = ''] = e.split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`;
};

@Injectable()
export class TeamsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(FlagsService) private readonly flags: FlagsService,
  ) {}

  /** The workspace plus what the caller can do in it: seat usage comes from the workspace's own plan. */
  async overview(user: AuthUser, organizationId: string) {
    const role = await this.orgs.assertRole(user.id, organizationId, 'viewer');
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const ent = await this.credits.entitlement(organizationId);
    const [members, pending] = await Promise.all([
      this.prisma.organizationMembership.count({ where: { organizationId } }),
      this.prisma.organizationInvitation.count({ where: { organizationId, expiresAt: { gt: new Date() } } }),
    ]);
    const personalPlan = await this.credits.entitlement(user.personalOrgId);
    const planRow = await this.prisma.plan.findUnique({ where: { id: personalPlan.planId }, select: { maxOrgs: true } });
    const owned = await this.prisma.organizationMembership.count({ where: { userId: user.id, role: 'owner', organization: { personal: false } } });
    return {
      id: org.id, name: org.name, personal: org.personal, role,
      seats: { used: members, pending, limit: org.personal ? 1 : ent.teamSeats },
      canInvite: !org.personal && ROLE_RANK[role] >= ROLE_RANK.admin,
      // Creating workspaces is gated by the *personal* workspace's plan (Studio: up to 10 workspaces including personal).
      canCreateWorkspace: (planRow?.maxOrgs ?? 1) > owned + 1,
    };
  }

  async createWorkspace(user: AuthUser, name: string, ip: string | null) {
    const personal = await this.credits.entitlement(user.personalOrgId);
    const plan = await this.prisma.plan.findUnique({ where: { id: personal.planId }, select: { maxOrgs: true, name: true } });
    const owned = await this.prisma.organizationMembership.count({ where: { userId: user.id, role: 'owner', organization: { personal: false } } });
    if ((plan?.maxOrgs ?? 1) <= owned + 1) {
      throw new HttpException({ message: `Your ${plan?.name ?? 'current'} plan doesn't include more workspaces. Upgrade to create team workspaces.`, code: 'plan_limit_workspaces' }, HttpStatus.PAYMENT_REQUIRED);
    }
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'team'}-${randomBytes(4).toString('hex')}`;
    const org = await this.prisma.$transaction(async (tx) => {
      const o = await tx.organization.create({ data: { name, slug, personal: false, memberships: { create: { userId: user.id, role: 'owner' } } } });
      await this.audit.record({ action: 'workspace.created', actorId: user.id, organizationId: o.id, targetType: 'organization', targetId: o.id, ip, metadata: { name } }, tx);
      return o;
    });
    await this.credits.ensureWorkspaceAllowance(org.id);
    return { id: org.id, name: org.name, slug: org.slug, personal: false, role: 'owner' as const };
  }

  async rename(user: AuthUser, organizationId: string, name: string, ip: string | null) {
    await this.orgs.assertRole(user.id, organizationId, 'admin');
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (org.personal) throw new BadRequestException('Your personal workspace can’t be renamed.');
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: organizationId }, data: { name } });
      await this.audit.record({ action: 'workspace.renamed', actorId: user.id, organizationId, targetType: 'organization', targetId: organizationId, ip, metadata: { name } }, tx);
    });
    return { id: organizationId, name };
  }

  // ───────── Members ─────────

  async members(user: AuthUser, organizationId: string) {
    await this.orgs.assertRole(user.id, organizationId, 'viewer');
    const rows = await this.prisma.organizationMembership.findMany({ where: { organizationId }, include: { user: { select: { id: true, email: true, displayName: true } } }, orderBy: [{ createdAt: 'asc' }] });
    return rows.map((m) => ({ userId: m.userId, email: m.user.email, displayName: m.user.displayName, role: m.role, joinedAt: m.createdAt.toISOString(), you: m.userId === user.id }));
  }

  async changeRole(user: AuthUser, organizationId: string, userId: string, role: OrgRole, ip: string | null) {
    const mine = await this.orgs.assertRole(user.id, organizationId, 'admin');
    if (userId === user.id) throw new BadRequestException('You can’t change your own role.');
    const target = await this.prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'owner') throw new ForbiddenException('The owner’s role can’t be changed.');
    // Admins manage members and viewers; only the owner manages admins.
    if (mine !== 'owner' && (ROLE_RANK[target.role] >= ROLE_RANK.admin || role === 'admin')) throw new ForbiddenException('Only the workspace owner can change admins.');
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.update({ where: { id: target.id }, data: { role } });
      await this.audit.record({ action: 'workspace.member_role_changed', actorId: user.id, organizationId, targetType: 'user', targetId: userId, ip, metadata: { from: target.role, to: role } }, tx);
    });
    return { userId, role };
  }

  /** Removes a member, or lets someone leave. The owner can't be removed; their projects stay with the workspace. */
  async removeMember(user: AuthUser, organizationId: string, userId: string, ip: string | null) {
    const self = userId === user.id;
    const mine = await this.orgs.assertRole(user.id, organizationId, self ? 'viewer' : 'admin');
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (org.personal) throw new BadRequestException('Your personal workspace has no other members.');
    const target = await this.prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'owner') throw new ForbiddenException(self ? 'The owner can’t leave the workspace.' : 'The owner can’t be removed.');
    if (!self && mine !== 'owner' && ROLE_RANK[target.role] >= ROLE_RANK.admin) throw new ForbiddenException('Only the workspace owner can remove admins.');
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.delete({ where: { id: target.id } });
      await this.audit.record({ action: self ? 'workspace.member_left' : 'workspace.member_removed', actorId: user.id, organizationId, targetType: 'user', targetId: userId, ip }, tx);
    });
  }

  // ───────── Invitations ─────────

  async invitations(user: AuthUser, organizationId: string) {
    await this.orgs.assertRole(user.id, organizationId, 'admin');
    const rows = await this.prisma.organizationInvitation.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
    const now = Date.now();
    return rows.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString(), expired: i.expiresAt.getTime() <= now, createdAt: i.createdAt.toISOString() }));
  }

  /**
   * Creates (or re-issues) an invitation. There is no email provider wired in, so the link is returned once for the
   * inviter to share; only its hash is stored.
   */
  async invite(user: AuthUser, organizationId: string, input: z.infer<typeof InviteSchema>, ip: string | null) {
    const mine = await this.orgs.assertRole(user.id, organizationId, 'admin');
    await this.flags.assert('team_workspaces', 'Team workspaces');
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (org.personal) throw new BadRequestException('Personal workspaces can’t have teammates. Create a team workspace first.');
    if (input.role === 'admin' && mine !== 'owner') throw new ForbiddenException('Only the workspace owner can invite admins.');
    const email = input.email;
    const existing = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (existing && (await this.prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: existing.id } } }))) {
      throw new ConflictException('That person is already a member.');
    }
    const ent = await this.credits.entitlement(organizationId);
    const token = randomBytes(24).toString('base64url');
    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
      const [members, pending] = await Promise.all([
        tx.organizationMembership.count({ where: { organizationId } }),
        // Re-inviting the same email replaces its invitation, so it doesn't count twice.
        tx.organizationInvitation.count({ where: { organizationId, expiresAt: { gt: new Date() }, NOT: { email } } }),
      ]);
      if (members + pending >= ent.teamSeats) {
        throw new HttpException({ message: `This workspace's plan includes ${ent.teamSeats} seat${ent.teamSeats === 1 ? '' : 's'} and ${members + pending} are used or reserved. Upgrade the workspace to invite more people.`, code: 'plan_limit_seats' }, HttpStatus.PAYMENT_REQUIRED);
      }
      const expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5);
      const inv = await tx.organizationInvitation.upsert({
        where: { organizationId_email: { organizationId, email } },
        create: { organizationId, email, role: input.role, tokenHash: sha(token), invitedById: user.id, expiresAt },
        update: { role: input.role, tokenHash: sha(token), invitedById: user.id, expiresAt, createdAt: new Date() },
      });
      await this.audit.record({ action: 'workspace.invited', actorId: user.id, organizationId, targetType: 'invitation', targetId: inv.id, ip, metadata: { role: input.role } }, tx);
      return inv;
    });
    return { id: invitation.id, email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString(), link: `${this.config.WEB_APP_URL.replace(/\/$/, '')}/invite/team/${token}` };
  }

  async revoke(user: AuthUser, organizationId: string, invitationId: string, ip: string | null) {
    await this.orgs.assertRole(user.id, organizationId, 'admin');
    const r = await this.prisma.organizationInvitation.deleteMany({ where: { id: invitationId, organizationId } });
    if (!r.count) throw new NotFoundException('Invitation not found');
    await this.audit.record({ action: 'workspace.invite_revoked', actorId: user.id, organizationId, targetType: 'invitation', targetId: invitationId, ip });
  }

  /** Public: lets the invitee see what they're joining before signing in. Reveals nothing without the secret token. */
  async preview(token: string) {
    const inv = await this.prisma.organizationInvitation.findUnique({ where: { tokenHash: sha(token) }, include: { organization: { select: { name: true } } } });
    if (!inv) throw new NotFoundException('This invitation is no longer valid.');
    if (inv.expiresAt <= new Date()) throw new GoneException('This invitation has expired. Ask for a new one.');
    return { organizationName: inv.organization.name, role: inv.role, emailHint: maskEmail(inv.email), expiresAt: inv.expiresAt.toISOString() };
  }

  async accept(user: AuthUser, token: string, ip: string | null) {
    const inv = await this.prisma.organizationInvitation.findUnique({ where: { tokenHash: sha(token) }, include: { organization: { select: { id: true, name: true, personal: true } } } });
    if (!inv) throw new NotFoundException('This invitation is no longer valid.');
    if (inv.expiresAt <= new Date()) throw new GoneException('This invitation has expired. Ask for a new one.');
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException(`This invitation was sent to ${maskEmail(inv.email)}. Sign in with that email to accept it.`);
    }
    const ent = await this.credits.entitlement(inv.organizationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${inv.organizationId}))`;
      const claimed = await tx.organizationInvitation.deleteMany({ where: { id: inv.id } });
      if (!claimed.count) throw new NotFoundException('This invitation was already used.');
      const already = await tx.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } } });
      if (already) return;
      // The invitation held the seat; re-check in case the plan was downgraded since.
      if ((await tx.organizationMembership.count({ where: { organizationId: inv.organizationId } })) >= ent.teamSeats) {
        throw new HttpException({ message: 'This workspace has no free seats right now. Ask the owner to upgrade it.', code: 'plan_limit_seats' }, HttpStatus.PAYMENT_REQUIRED);
      }
      await tx.organizationMembership.create({ data: { organizationId: inv.organizationId, userId: user.id, role: inv.role } });
      await this.audit.record({ action: 'workspace.joined', actorId: user.id, organizationId: inv.organizationId, targetType: 'user', targetId: user.id, ip, metadata: { role: inv.role } }, tx);
    });
    return { organizationId: inv.organizationId, name: inv.organization.name, role: inv.role };
  }
}
