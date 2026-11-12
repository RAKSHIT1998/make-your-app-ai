import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { HostingDeployment, PrismaClient, Project } from '@mya/db';
import { FakeHosting, HostingProviderError, VercelHosting, type HostingProvider } from '@mya/hosting';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PRISMA } from '../prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { CreditsService } from '../credits/credits.service.js';
import { FlagsService } from '../flags/flags.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { GenerationsService } from '../generation/generations.service.js';
import { decryptJson, encryptJson } from '../common/crypto.js';
import { OrgsService } from '../orgs/orgs.service.js';

export const HOSTING_PROVIDER = Symbol('HOSTING_PROVIDER');
export const HOSTING_HEALTH_CHECK = Symbol('HOSTING_HEALTH_CHECK');
export type HealthCheck = (url: string) => Promise<{ ok: boolean; status: number | null; error?: string }>;

export const hostingProviderFactory = {
  provide: HOSTING_PROVIDER,
  inject: [APP_CONFIG],
  useFactory: (c: AppConfig): HostingProvider | null =>
    c.HOSTING_PROVIDER === 'vercel' && c.VERCEL_TOKEN ? new VercelHosting({ token: c.VERCEL_TOKEN, teamId: c.VERCEL_TEAM_ID }) : c.HOSTING_PROVIDER === 'fake' ? new FakeHosting() : null,
};

/** "live" requires the deployed URL to actually answer. */
export const defaultHealthCheck: HealthCheck = async (url) => {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    return { ok: r.status < 500, status: r.status };
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : String(e) };
  }
};
export const healthCheckProvider = { provide: HOSTING_HEALTH_CHECK, useValue: defaultHealthCheck };

export const EnvVarSchema = z.object({
  key: z.string().trim().regex(/^[A-Z_][A-Z0-9_]{0,127}$/, 'Use UPPER_SNAKE_CASE letters, digits and underscores.')
    .refine((k) => !/^(VERCEL|MYA|NOW)_/.test(k), 'This prefix is reserved by the platform.'),
  value: z.string().max(32_000),
});
export const DomainSchema = z.object({
  hostname: z.string().trim().toLowerCase().max(253).regex(/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Enter a domain like shop.example.com.')
    .refine((h) => !/(\.|^)(vercel\.app|vercel\.com|localhost|invalid|local)$/.test(h), 'Use a domain you own.'),
});

const ACTIVE: HostingDeployment['status'][] = ['queued', 'building'];

@Injectable()
export class HostingService {
  private readonly log = new Logger('Hosting');
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HOSTING_PROVIDER) private readonly provider: HostingProvider | null,
    @Inject(HOSTING_HEALTH_CHECK) private readonly health: HealthCheck,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(GenerationsService) private readonly generations: GenerationsService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OrgsService) private readonly orgs: OrgsService,
  ) {}

  private requireProvider(): HostingProvider {
    if (!this.provider) throw new ServiceUnavailableException({ message: 'Hosting isn’t configured on this server yet. The platform owner needs to add a hosting provider token.', code: 'hosting_not_configured' });
    return this.provider;
  }

  private async entitlements(orgId: string) {
    const e = await this.credits.entitlement(orgId);
    return { canDeploy: e.featureFlags.includes('hosting_basic') || e.featureFlags.includes('hosting'), canUseCustomDomains: e.featureFlags.includes('hosting') };
  }

  private providerError(e: unknown): never {
    if (e instanceof HostingProviderError) {
      this.log.error(`provider error ${e.status ?? ''} ${e.code ?? ''}: ${e.message}`);
      throw new HttpException({ message: `The hosting provider rejected the request: ${e.message}`, code: 'hosting_provider_error' }, HttpStatus.BAD_GATEWAY);
    }
    throw e;
  }

  private siteNameFor(p: Project) {
    const base = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'site';
    return `mya-${base}-${p.id.slice(0, 8)}`;
  }

  private dto(d: HostingDeployment, liveId: string | null) {
    return { id: d.id, status: d.status, kind: d.kind, url: d.url, versionNumber: d.versionNumber, error: d.error, createdAt: d.createdAt.toISOString(), readyAt: d.readyAt?.toISOString() ?? null, current: d.id === liveId, health: d.healthCheck ?? null };
  }

  // ───────── Overview ─────────

  /** Workspace-wide list for the Cloud Studio home. */
  async sites(user: AuthUser, organizationId?: string) {
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'viewer');
    const projects = await this.prisma.project.findMany({
      where: { organizationId: orgId, deletedAt: null, status: { not: 'archived' } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, type: true, headVersionId: true, hostingSite: true, deployments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const ent = await this.entitlements(orgId);
    return {
      configured: !!this.provider,
      provider: this.provider?.name ?? null,
      entitlements: ent,
      sites: projects.map((p) => ({
        projectId: p.id, name: p.name, type: p.type, hasVersion: !!p.headVersionId,
        productionUrl: p.hostingSite?.productionUrl ?? null,
        lastDeployment: p.deployments[0] ? this.dto(p.deployments[0], p.hostingSite?.liveDeploymentId ?? null) : null,
      })),
    };
  }

  async status(user: AuthUser, projectId: string) {
    const p = await this.projects.getAuthorized(user, projectId, 'viewer');
    const pending = await this.prisma.hostingDeployment.findMany({ where: { projectId, status: { in: ACTIVE } } });
    for (const d of pending) await this.sync(d).catch((e) => this.log.warn(`sync ${d.id}: ${e instanceof Error ? e.message : e}`));
    const [site, deployments, env, domains, ent] = await Promise.all([
      this.prisma.hostingSite.findUnique({ where: { projectId } }),
      this.prisma.hostingDeployment.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.projectEnvVar.findMany({ where: { projectId }, orderBy: { key: 'asc' }, select: { key: true, updatedAt: true } }),
      this.prisma.domain.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
      this.entitlements(p.organizationId),
    ]);
    const head = p.headVersionId ? await this.prisma.projectVersion.findUnique({ where: { id: p.headVersionId }, select: { number: true } }) : null;
    return {
      configured: !!this.provider,
      provider: this.provider?.name ?? null,
      entitlements: ent,
      headVersion: head?.number ?? null,
      site: site ? { productionUrl: site.productionUrl, siteName: site.siteName, liveDeploymentId: site.liveDeploymentId } : null,
      deployments: deployments.map((d) => this.dto(d, site?.liveDeploymentId ?? null)),
      env: env.map((e) => ({ key: e.key, updatedAt: e.updatedAt.toISOString(), public: e.key.startsWith('NEXT_PUBLIC_') })),
      domains: domains.map((d) => ({ hostname: d.hostname, status: d.status, sslStatus: d.sslStatus, records: d.dnsRecords })),
    };
  }

  // ───────── Deploy, sync, rollback ─────────

  async deploy(user: AuthUser, projectId: string, ip: string | null, fromDeploymentId?: string) {
    await this.flags.assert('hosting', 'Hosting');
    const provider = this.requireProvider();
    const p = await this.projects.getAuthorized(user, projectId, 'member');
    const ent = await this.entitlements(p.organizationId);
    if (!ent.canDeploy) throw new HttpException({ message: 'Deploying websites needs the Creator plan or higher.', code: 'plan_hosting' }, HttpStatus.PAYMENT_REQUIRED);
    if (p.type !== 'website' && p.type !== 'business_website') throw new BadRequestException('Only websites can be deployed today.');

    let version;
    if (fromDeploymentId) {
      const src = await this.prisma.hostingDeployment.findFirst({ where: { id: fromDeploymentId, projectId, status: { in: ['live', 'deployed_unverified'] } } });
      if (!src) throw new NotFoundException('Only successful deployments can be rolled back to.');
      version = await this.prisma.projectVersion.findUniqueOrThrow({ where: { id: src.versionId } });
    } else {
      if (!p.headVersionId) throw new BadRequestException('Generate the project before deploying it.');
      version = await this.prisma.projectVersion.findUniqueOrThrow({ where: { id: p.headVersionId } });
    }
    const today = new Date(new Date().toISOString().slice(0, 10));
    const [running, todayCount] = await Promise.all([
      this.prisma.hostingDeployment.findFirst({ where: { projectId, status: { in: ACTIVE } } }),
      this.prisma.hostingDeployment.count({ where: { project: { organizationId: p.organizationId }, createdAt: { gte: today } } }),
    ]);
    if (running) throw new ConflictException('A deployment is already in progress for this project.');
    if (todayCount >= this.config.MAX_DEPLOYMENTS_PER_DAY) throw new HttpException({ message: `Daily deployment limit reached (${this.config.MAX_DEPLOYMENTS_PER_DAY}). It resets at midnight UTC.`, code: 'hosting_daily_limit' }, HttpStatus.TOO_MANY_REQUESTS);

    const files = await this.generations.readVersionTree(p.id, version.commitSha);
    for (const path of [...files.keys()]) if (/(^|\/)\.env(\..*)?$/.test(path)) files.delete(path);
    const siteName = (await this.prisma.hostingSite.findUnique({ where: { projectId } }))?.siteName ?? this.siteNameFor(p);
    let result;
    try {
      const site = await provider.ensureSite(siteName, 'nextjs');
      await this.prisma.hostingSite.upsert({ where: { projectId }, update: {}, create: { projectId, provider: provider.name, siteName, externalProjectId: site.externalProjectId, productionUrl: site.productionUrl } });
      await provider.syncEnv(siteName, await this.decryptedEnv(projectId));
      result = await provider.deploy({ siteName, files, framework: 'nextjs', target: 'production', meta: { projectId: p.id, version: String(version.number) } });
    } catch (e) {
      this.providerError(e);
    }
    const d = await this.prisma.hostingDeployment.create({
      data: { projectId, versionId: version.id, versionNumber: version.number, provider: provider.name, externalId: result.externalId, url: result.url, status: 'queued', kind: fromDeploymentId ? 'rollback' : 'deploy', createdById: user.id, approvedBy: user.id },
    });
    await this.audit.record({ action: fromDeploymentId ? 'hosting.rollback' : 'hosting.deploy', actorId: user.id, organizationId: p.organizationId, targetType: 'project', targetId: p.id, ip, metadata: { deploymentId: d.id, version: version.number } });
    return this.dto(d, null);
  }

  /** Pulls the provider's state. Safe to call repeatedly; survives API restarts (state lives in the DB + provider). */
  async sync(d: HostingDeployment) {
    if (!this.provider || !d.externalId || !ACTIVE.includes(d.status)) return d;
    if (d.lastSyncedAt && Date.now() - d.lastSyncedAt.getTime() < 2_000) return d;
    const r = await this.provider.getDeployment(d.externalId);
    const now = new Date();
    if (r.state === 'queued' || r.state === 'building') {
      return this.prisma.hostingDeployment.update({ where: { id: d.id }, data: { status: 'building', lastSyncedAt: now, url: r.url ?? d.url } });
    }
    if (r.state === 'error' || r.state === 'canceled') {
      return this.prisma.hostingDeployment.update({ where: { id: d.id }, data: { status: 'failed', error: (r.errorMessage ?? (r.state === 'canceled' ? 'The deployment was canceled.' : 'The build failed.')).slice(0, 2000), lastSyncedAt: now } });
    }
    const url = r.url ?? d.url;
    const h = url ? await this.health(url) : { ok: false, status: null, error: 'No URL returned' };
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.hostingDeployment.update({ where: { id: d.id }, data: { status: h.ok ? 'live' : 'deployed_unverified', url, readyAt: now, lastSyncedAt: now, healthCheck: { ok: h.ok, status: h.status, error: h.error ?? null, at: now.toISOString() } } });
      await tx.hostingSite.update({ where: { projectId: d.projectId }, data: { liveDeploymentId: d.id, ...(url ? { productionUrl: url } : {}) } });
      return u;
    });
    return updated;
  }

  async logs(user: AuthUser, projectId: string, deploymentId: string) {
    await this.projects.getAuthorized(user, projectId, 'viewer');
    const d = await this.prisma.hostingDeployment.findFirst({ where: { id: deploymentId, projectId } });
    if (!d?.externalId) throw new NotFoundException('Deployment not found');
    try {
      return await this.requireProvider().logs(d.externalId);
    } catch (e) {
      this.providerError(e);
    }
  }

  // ───────── Environment variables ─────────

  private key() {
    if (!this.config.ENCRYPTION_KEY) throw new ServiceUnavailableException('Secrets storage isn’t configured (ENCRYPTION_KEY).');
    return this.config.ENCRYPTION_KEY;
  }

  private async decryptedEnv(projectId: string) {
    const rows = await this.prisma.projectEnvVar.findMany({ where: { projectId } });
    if (!rows.length) return {};
    const k = this.key();
    return Object.fromEntries(rows.map((r) => [r.key, decryptJson<string>(k, r.encryptedValue)]));
  }

  async setEnv(user: AuthUser, projectId: string, input: z.infer<typeof EnvVarSchema>, ip: string | null) {
    await this.flags.assert('hosting', 'Hosting');
    const p = await this.projects.getAuthorized(user, projectId, 'admin');
    if ((await this.prisma.projectEnvVar.count({ where: { projectId } })) >= 100 && !(await this.prisma.projectEnvVar.findUnique({ where: { projectId_key: { projectId, key: input.key } } }))) throw new BadRequestException('A project can have up to 100 environment variables.');
    const encryptedValue = encryptJson(this.key(), input.value);
    await this.prisma.projectEnvVar.upsert({ where: { projectId_key: { projectId, key: input.key } }, update: { encryptedValue }, create: { projectId, key: input.key, encryptedValue } });
    await this.audit.record({ action: 'hosting.env_set', actorId: user.id, organizationId: p.organizationId, targetType: 'project', targetId: p.id, ip, metadata: { key: input.key } });
    return { key: input.key };
  }

  async deleteEnv(user: AuthUser, projectId: string, key: string, ip: string | null) {
    const p = await this.projects.getAuthorized(user, projectId, 'admin');
    const r = await this.prisma.projectEnvVar.deleteMany({ where: { projectId, key } });
    if (!r.count) throw new NotFoundException('Variable not found');
    await this.audit.record({ action: 'hosting.env_deleted', actorId: user.id, organizationId: p.organizationId, targetType: 'project', targetId: p.id, ip, metadata: { key } });
  }

  // ───────── Custom domains ─────────

  async addDomain(user: AuthUser, projectId: string, hostname: string, ip: string | null) {
    await this.flags.assert('hosting', 'Hosting');
    const provider = this.requireProvider();
    const p = await this.projects.getAuthorized(user, projectId, 'admin');
    if (!(await this.entitlements(p.organizationId)).canUseCustomDomains) throw new HttpException({ message: 'Custom domains need the Pro plan or higher.', code: 'plan_custom_domains' }, HttpStatus.PAYMENT_REQUIRED);
    const site = await this.prisma.hostingSite.findUnique({ where: { projectId } });
    if (!site) throw new BadRequestException('Deploy the project once before connecting a domain.');
    if (await this.prisma.domain.findUnique({ where: { hostname } })) throw new ConflictException('That domain is already connected to a project.');
    if ((await this.prisma.domain.count({ where: { projectId } })) >= 5) throw new BadRequestException('A project can have up to 5 custom domains.');
    let d;
    try {
      d = await provider.addDomain(site.siteName, hostname);
    } catch (e) {
      this.providerError(e);
    }
    await this.prisma.domain.create({ data: { organizationId: p.organizationId, projectId, hostname, status: d.verified ? 'verified' : 'pending_verification', dnsRecords: d.records as never } });
    await this.audit.record({ action: 'hosting.domain_added', actorId: user.id, organizationId: p.organizationId, targetType: 'project', targetId: p.id, ip, metadata: { hostname } });
    return this.domainDto(hostname);
  }

  async checkDomain(user: AuthUser, projectId: string, hostname: string) {
    const provider = this.requireProvider();
    await this.projects.getAuthorized(user, projectId, 'viewer');
    const dom = await this.prisma.domain.findFirst({ where: { projectId, hostname } });
    const site = await this.prisma.hostingSite.findUnique({ where: { projectId } });
    if (!dom || !site) throw new NotFoundException('Domain not found');
    let d;
    try {
      d = await provider.checkDomain(site.siteName, hostname);
    } catch (e) {
      this.providerError(e);
    }
    const status = d.verified && d.configured ? 'active' : d.verified ? 'verified' : 'pending_verification';
    // SSL is issued by the provider once DNS points at it; we only report what the provider confirms.
    await this.prisma.domain.update({ where: { id: dom.id }, data: { status, sslStatus: status === 'active' ? 'issued_by_provider' : 'waiting_for_dns', dnsRecords: d.records as never } });
    return this.domainDto(hostname);
  }

  async removeDomain(user: AuthUser, projectId: string, hostname: string, ip: string | null) {
    const p = await this.projects.getAuthorized(user, projectId, 'admin');
    const dom = await this.prisma.domain.findFirst({ where: { projectId, hostname } });
    const site = await this.prisma.hostingSite.findUnique({ where: { projectId } });
    if (!dom) throw new NotFoundException('Domain not found');
    if (site && this.provider) {
      try {
        await this.provider.removeDomain(site.siteName, hostname);
      } catch (e) {
        this.providerError(e);
      }
    }
    await this.prisma.domain.delete({ where: { id: dom.id } });
    await this.audit.record({ action: 'hosting.domain_removed', actorId: user.id, organizationId: p.organizationId, targetType: 'project', targetId: p.id, ip, metadata: { hostname } });
  }

  private async domainDto(hostname: string) {
    const d = await this.prisma.domain.findUniqueOrThrow({ where: { hostname } });
    return { hostname: d.hostname, status: d.status, sslStatus: d.sslStatus, records: d.dnsRecords };
  }

  /** Owner analytics: deployment success rate. */
  async adminStats() {
    const rows = await this.prisma.hostingDeployment.groupBy({ by: ['status'], _count: true });
    const by = Object.fromEntries(rows.map((r) => [r.status, r._count]));
    const done = (by.live ?? 0) + (by.deployed_unverified ?? 0) + (by.failed ?? 0);
    return { byStatus: by, successRate: done ? ((by.live ?? 0) + (by.deployed_unverified ?? 0)) / done : null, sites: await this.prisma.hostingSite.count() };
  }

}
