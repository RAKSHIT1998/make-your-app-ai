import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PRISMA } from '../prisma.service.js';
import { AppDataService } from '../appdata/appdata.service.js';
import { MerchantService } from '../commerce/merchant.service.js';
import type { AuthUser } from '../auth/auth.types.js';

const DAY = 864e5;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** One value per calendar day (UTC) from `since` to today, zero-filled, so charts never skip days. */
function series(days: number, rows: { day: Date | string; n: number }[]) {
  const by = new Map(rows.map((r) => [typeof r.day === 'string' ? r.day.slice(0, 10) : isoDay(r.day), r.n]));
  const out: { day: string; value: number }[] = [];
  const today = Date.parse(isoDay(new Date()));
  for (let i = days - 1; i >= 0; i--) {
    const day = isoDay(new Date(today - i * DAY));
    out.push({ day, value: by.get(day) ?? 0 });
  }
  return out;
}
const sum = (s: { value: number }[]) => s.reduce((n, x) => n + x.value, 0);

/** Neutralises spreadsheet formula injection and quotes every cell. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/**
 * The owner's dashboard for one project: who visits, who signs up, what data the live app holds, and (for a linked
 * store) the money. Everything is computed from data the platform already records; nothing is estimated.
 */
@Injectable()
export class InsightsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AppDataService) private readonly appData: AppDataService,
    @Inject(MerchantService) private readonly merchant: MerchantService,
  ) {}

  async overview(user: AuthUser, project: { id: string; name: string; type: string; slug: string | null; visibility: string; publishedAt: Date | null; publishedVersionId: string | null; headVersionId: string | null; moderatedAt: Date | null; viewCount: number; likeCount: number }, days: number) {
    const since = new Date(Date.parse(isoDay(new Date())) - (days - 1) * DAY);
    const prevSince = new Date(since.getTime() - days * DAY);
    const pid = project.id;
    const { publishedSha } = await this.appData.shas(project);
    const backend = publishedSha ? await this.appData.backendAt(pid, publishedSha) : null;
    const [visitorsRows, prevVisitors, signupRows, prevSignups, users, active7, active30, recordRows, recordsByCollection, comments, store, controls, version] = await Promise.all([
      this.prisma.$queryRaw<{ day: Date; n: number }[]>`SELECT day, COUNT(*)::int AS n FROM "ProjectViewDay" WHERE "projectId" = ${pid}::uuid AND day >= ${since}::date GROUP BY day`,
      this.prisma.projectViewDay.count({ where: { projectId: pid, day: { gte: prevSince, lt: since } } }),
      this.prisma.$queryRaw<{ day: Date; n: number }[]>`SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS n FROM "AppUser" WHERE "projectId" = ${pid}::uuid AND env = 'live' AND "createdAt" >= ${since} GROUP BY 1`,
      this.prisma.appUser.count({ where: { projectId: pid, env: 'live', createdAt: { gte: prevSince, lt: since } } }),
      this.prisma.appUser.count({ where: { projectId: pid, env: 'live' } }),
      this.prisma.appUser.count({ where: { projectId: pid, env: 'live', lastSignInAt: { gte: new Date(Date.now() - 7 * DAY) } } }),
      this.prisma.appUser.count({ where: { projectId: pid, env: 'live', lastSignInAt: { gte: new Date(Date.now() - 30 * DAY) } } }),
      this.prisma.$queryRaw<{ day: Date; n: number }[]>`SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS n FROM "AppRecord" WHERE "projectId" = ${pid}::uuid AND env = 'live' AND "createdAt" >= ${since} GROUP BY 1`,
      this.prisma.appRecord.groupBy({ by: ['collection'], where: { projectId: pid, env: 'live' }, _count: true }),
      this.prisma.projectComment.count({ where: { projectId: pid } }),
      this.prisma.store.findUnique({ where: { projectId: pid }, select: { id: true, name: true, status: true, currency: true } }),
      this.prisma.appBackend.findUnique({ where: { projectId: pid }, select: { signupsOpen: true, paused: true } }),
      project.publishedVersionId ? this.prisma.projectVersion.findUnique({ where: { id: project.publishedVersionId }, select: { number: true } }) : null,
    ]);

    const visitors = series(days, visitorsRows);
    const signups = series(days, signupRows);
    const records = series(days, recordRows);
    const live = project.visibility === 'public' && !!project.publishedVersionId && !project.moderatedAt;
    const change = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / before) * 100));

    return {
      days,
      project: {
        id: pid, name: project.name, type: project.type, live,
        url: live && project.slug ? `${this.config.WEB_APP_URL.replace(/\/$/, '')}/p/${project.slug}` : null,
        publishedAt: project.publishedAt?.toISOString() ?? null, publishedVersion: version?.number ?? null,
        hidden: !!project.moderatedAt,
      },
      visitors: { daily: visitors, total: sum(visitors), changePct: change(sum(visitors), prevVisitors), allTime: project.viewCount, likes: project.likeCount, comments },
      appUsers: backend?.auth.enabled || users > 0
        ? { daily: signups, newInPeriod: sum(signups), changePct: change(sum(signups), prevSignups), total: users, active7, active30, limit: this.config.APP_DATA_MAX_USERS }
        : null,
      data: backend
        ? {
            daily: records, newInPeriod: sum(records),
            collections: Object.keys(backend.collections).map((name) => ({ name, records: recordsByCollection.find((c) => c.collection === name)?._count ?? 0 })),
            total: recordsByCollection.reduce((n, c) => n + c._count, 0), limit: this.config.APP_DATA_MAX_RECORDS,
          }
        : null,
      money: store ? { store: { id: store.id, name: store.name, status: store.status }, ...(await this.merchant.analytics(user, store.id, days)) } : null,
      controls: backend ? { signupsOpen: controls?.signupsOpen ?? true, paused: controls?.paused ?? false, hasAccounts: backend.auth.enabled } : null,
    };
  }

  async setControls(projectId: string, patch: { signupsOpen?: boolean; paused?: boolean }) {
    await this.appData.previewKey(projectId); // makes sure the project's backend row exists
    const r = await this.prisma.appBackend.update({ where: { projectId }, data: patch, select: { signupsOpen: true, paused: true } });
    return r;
  }

  async exportUsers(projectId: string) {
    const rows = await this.prisma.appUser.findMany({ where: { projectId, env: 'live' }, orderBy: { createdAt: 'asc' }, select: { email: true, createdAt: true, lastSignInAt: true, _count: { select: { records: true } } } });
    return toCsv(['email', 'signed_up', 'last_sign_in', 'records'], rows.map((u) => [u.email, u.createdAt.toISOString(), u.lastSignInAt?.toISOString() ?? '', u._count.records]));
  }

  async exportCollection(projectId: string, collection: string) {
    const rows = await this.prisma.appRecord.findMany({ where: { projectId, env: 'live', collection }, orderBy: { createdAt: 'asc' }, include: { owner: { select: { email: true } } } });
    const fields = [...new Set(rows.flatMap((r) => (r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? Object.keys(r.data) : [])))].sort();
    return toCsv(['id', ...fields, 'owner', 'created', 'updated'], rows.map((r) => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      return [r.id, ...fields.map((f) => d[f]), r.owner?.email ?? '', r.createdAt.toISOString(), r.updatedAt.toISOString()];
    }));
  }
}
