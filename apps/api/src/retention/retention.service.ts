import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { PRISMA } from '../prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OrgsService } from '../orgs/orgs.service.js';

const DAY = 864e5;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Timeline entries are drawn from the audit log; only these actions are shown to customers. */
const TIMELINE: Record<string, string> = {
  'project.created': 'Created a project',
  'generation.started': 'Asked the AI for a change',
  'project.version_restored': 'Restored an earlier version',
  'project.published': 'Published a project',
  'project.unpublished': 'Unpublished a project',
  'project.remixed': 'Remixed a public project',
  'project.updated': 'Updated project details',
  'project.deleted': 'Deleted a project',
  'store.created': 'Created a store',
  'store.payments_connected': 'Connected store payments',
  'order.fulfilled': 'Fulfilled an order',
  'order.refunded': 'Refunded an order',
  'billing.subscription_paid': 'Subscription payment confirmed',
  'billing.topup_paid': 'Bought credits',
  'referral.claimed': 'Joined through an invite',
};

/**
 * Retention features computed only from real records: badges, build streaks and the activity timeline.
 * Nothing here is stored separately, so nothing can be awarded without the underlying activity.
 */
@Injectable()
export class RetentionService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(OrgsService) private readonly orgs: OrgsService,
  ) {}

  async achievements(user: AuthUser) {
    const orgIds = (await this.orgs.listForUser(user.id)).map((m) => m.organization.id);
    const first = async <T extends { createdAt?: Date; publishedAt?: Date | null; paidAt?: Date | null; qualifiedAt?: Date | null }>(p: Promise<T | null>, field: keyof T = 'createdAt' as keyof T) => {
      const r = await p;
      const v = r?.[field] as Date | null | undefined;
      return v ? v.toISOString() : null;
    };
    const [firstProject, firstBuild, firstPublish, firstLike, firstRemix, firstStore, firstSale, firstReferral, runDays] = await Promise.all([
      first(this.prisma.project.findFirst({ where: { createdById: user.id }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })),
      first(this.prisma.generationRun.findFirst({ where: { requestedBy: user.id, status: 'succeeded', kind: { in: ['create', 'edit'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })),
      first(this.prisma.auditLog.findFirst({ where: { actorId: user.id, action: 'project.published' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })),
      first(this.prisma.projectLike.findFirst({ where: { project: { createdById: user.id }, NOT: { userId: user.id } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })),
      first(this.prisma.project.findFirst({ where: { remixedFrom: { createdById: user.id }, NOT: { createdById: user.id } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })),
      first(this.prisma.store.findFirst({ where: { organizationId: { in: orgIds } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })),
      first(this.prisma.order.findFirst({ where: { store: { organizationId: { in: orgIds } }, status: { in: ['paid', 'partially_refunded', 'refunded'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })),
      first(this.prisma.referral.findFirst({ where: { referrerId: user.id, status: 'rewarded' }, orderBy: { qualifiedAt: 'asc' }, select: { qualifiedAt: true } }), 'qualifiedAt'),
      this.prisma.$queryRaw<{ day: Date }[]>`SELECT DISTINCT date_trunc('day', "finishedAt") AS day FROM "GenerationRun" WHERE "requestedBy" = ${user.id}::uuid AND status = 'succeeded' AND kind IN ('create','edit') AND "finishedAt" > now() - interval '400 days' ORDER BY day`,
    ]);
    const streak = this.streak(runDays.map((r) => dayKey(new Date(r.day))));
    const badges = [
      { key: 'first_project', title: 'First project', description: 'Started your first project.', earnedAt: firstProject },
      { key: 'first_build', title: 'First build', description: 'The AI built a working version for you.', earnedAt: firstBuild },
      { key: 'first_publish', title: 'Published', description: 'Shared a project on a public page.', earnedAt: firstPublish },
      { key: 'first_like', title: 'First like', description: 'Someone liked one of your projects.', earnedAt: firstLike },
      { key: 'first_remix', title: 'Remixed', description: 'Someone remixed one of your projects.', earnedAt: firstRemix },
      { key: 'first_store', title: 'Shop open', description: 'Created a store in Business Studio.', earnedAt: firstStore },
      { key: 'first_customer', title: 'First customer', description: 'A customer paid for an order in your store.', earnedAt: firstSale },
      { key: 'first_referral', title: 'Connector', description: 'Someone you invited became a customer.', earnedAt: firstReferral },
      { key: 'streak_7', title: '7-day streak', description: 'Built something 7 days in a row.', earnedAt: streak.sevenDayAt },
    ];
    return { badges, streak: { current: streak.current, longest: streak.longest, last30: streak.last30 } };
  }

  /** Consecutive days with at least one successful AI change. Today without activity doesn't break a streak yet. */
  private streak(days: string[]) {
    const set = new Set(days);
    let longest = 0;
    let run = 0;
    let prev: number | null = null;
    let sevenDayAt: string | null = null;
    for (const d of days) {
      const t = Date.parse(d);
      run = prev !== null && t - prev === DAY ? run + 1 : 1;
      longest = Math.max(longest, run);
      if (run >= 7 && !sevenDayAt) sevenDayAt = new Date(t).toISOString();
      prev = t;
    }
    const today = Date.parse(dayKey(new Date()));
    let cursor = set.has(dayKey(new Date(today))) ? today : today - DAY;
    let current = 0;
    while (set.has(dayKey(new Date(cursor)))) { current++; cursor -= DAY; }
    const last30 = Array.from({ length: 30 }, (_, i) => set.has(dayKey(new Date(today - (29 - i) * DAY))));
    return { current, longest, last30, sevenDayAt };
  }

  async timeline(user: AuthUser, organizationId: string | undefined, projectId: string | undefined, limit: number) {
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'viewer');
    const rows = await this.prisma.auditLog.findMany({
      where: { organizationId: orgId, action: { in: Object.keys(TIMELINE) }, ...(projectId ? { OR: [{ targetId: projectId }, { metadata: { path: ['projectId'], equals: projectId } }] } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: { displayName: true, email: true } } },
    });
    const projectIds = [...new Set(rows.filter((r) => r.targetType === 'project' && r.targetId).map((r) => r.targetId!))];
    const runIds = rows.filter((r) => r.targetType === 'generation_run' && r.targetId).map((r) => r.targetId!);
    const runs = runIds.length ? await this.prisma.generationRun.findMany({ where: { id: { in: runIds } }, select: { id: true, projectId: true, status: true, prompt: true, kind: true } }) : [];
    const allProjectIds = [...new Set([...projectIds, ...runs.map((r) => r.projectId)])];
    const projects = new Map((await this.prisma.project.findMany({ where: { id: { in: allProjectIds }, organizationId: orgId }, select: { id: true, name: true, deletedAt: true } })).map((p) => [p.id, p]));
    return rows.map((r) => {
      const run = r.targetType === 'generation_run' ? runs.find((x) => x.id === r.targetId) : undefined;
      const project = projects.get(run?.projectId ?? r.targetId ?? '');
      return {
        id: String(r.id),
        action: r.action,
        label: run ? (run.kind === 'plan' ? 'Drafted a plan' : run.kind === 'create' ? 'Built the first version' : 'Asked the AI for a change') : TIMELINE[r.action]!,
        at: r.createdAt.toISOString(),
        actor: r.actor?.displayName ?? r.actor?.email.split('@')[0] ?? null,
        project: project && !project.deletedAt ? { id: project.id, name: project.name } : null,
        detail: run ? { prompt: run.prompt.split('\n\n')[0]!.slice(0, 140), status: run.status } : null,
      };
    });
  }
}
