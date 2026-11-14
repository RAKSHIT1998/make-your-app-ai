import { ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Prisma, type AppUser, type PrismaClient } from '@mya/db';
import type { GitProjectStore } from '@mya/codegen';
import { APP_BACKEND_FILE, parseAppBackend, parseFilterValue, validateAppRecord, type AppBackend } from '@mya/shared';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PRISMA } from '../prisma.service.js';
import { PROJECT_STORE } from '../ai/ai.providers.js';
import { FlagsService } from '../flags/flags.service.js';

/** Same rule as a public project page (kept here to avoid an import cycle with the showcase service). */
const publicWhere: Prisma.ProjectWhereInput = { visibility: 'public', deletedAt: null, moderatedAt: null, publishedVersionId: { not: null } };

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const SESSION_DAYS = 30;
export type AppEnv = 'preview' | 'live';
export interface AppContext { projectId: string; env: AppEnv; backend: AppBackend }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}
async function verifyPassword(pw: string, stored: string) {
  const [, n, r, p, salt, hash] = stored.split('$');
  const want = Buffer.from(hash ?? '', 'base64');
  const got = await scrypt(pw, Buffer.from(salt ?? '', 'base64'), want.length || 64, { N: Number(n), r: Number(r), p: Number(p) });
  return want.length > 0 && timingSafeEqual(want, got);
}
const DUMMY_HASH = `scrypt$16384$8$1$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(64).toString('base64')}`;

/**
 * The built-in backend that generated full-stack apps talk to. Each app's schema and access rules come from its own
 * app.backend.json (the head version for preview, the published version for live), so what the builder sees in the
 * workspace is exactly what runs. Every query is scoped by project and environment; end users are separate from
 * platform users and can never reach platform data.
 */
@Injectable()
export class AppDataService {
  private readonly cache = new Map<string, AppBackend | null>();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROJECT_STORE) private readonly store: GitProjectStore,
    @Inject(FlagsService) private readonly flags: FlagsService,
  ) {}

  /** The schema declared at one version of a project, cached per commit (a commit never changes). */
  async backendAt(projectId: string, commitSha: string): Promise<AppBackend | null> {
    const key = `${projectId}:${commitSha}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const tree = await this.store.readTree(projectId, commitSha);
    const raw = tree.get(APP_BACKEND_FILE);
    const parsed = raw === undefined ? null : parseAppBackend(raw);
    const backend = parsed?.ok ? parsed.backend : null;
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, backend);
    return backend;
  }

  async previewKey(projectId: string): Promise<string> {
    const existing = await this.prisma.appBackend.findUnique({ where: { projectId } });
    if (existing) return existing.previewKey;
    const previewKey = randomBytes(24).toString('base64url');
    const row = await this.prisma.appBackend.upsert({ where: { projectId }, update: {}, create: { projectId, previewKey } });
    return row.previewKey;
  }

  /** Public data endpoint base URL for a key (`pv_…` preview, `lv_<projectId>` live). */
  endpoint(key: string) {
    return `${this.config.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/appdata/${key}`;
  }

  /** Resolves an app key to its project, environment and schema. Unknown, unpublished or backend-less apps are 404. */
  async resolve(key: string): Promise<AppContext> {
    if (!(await this.flags.isEnabled('app_backends'))) throw new HttpException({ message: 'App backends are temporarily turned off. Please try again later.', code: 'feature_disabled' }, HttpStatus.SERVICE_UNAVAILABLE);
    const notFound = () => new NotFoundException({ message: 'This app was not found or is no longer available.', code: 'app_not_found' });
    let projectId: string, sha: string | null | undefined, env: AppEnv;
    if (key.startsWith('pv_')) {
      const row = await this.prisma.appBackend.findUnique({ where: { previewKey: key.slice(3) }, select: { project: { select: { id: true, deletedAt: true, headVersion: { select: { commitSha: true } } } } } });
      if (!row || row.project.deletedAt) throw notFound();
      ({ id: projectId } = row.project); sha = row.project.headVersion?.commitSha; env = 'preview';
    } else if (key.startsWith('lv_') && /^[0-9a-f-]{36}$/.test(key.slice(3))) {
      const p = await this.prisma.project.findFirst({ where: { id: key.slice(3), ...publicWhere }, select: { id: true, publishedVersionId: true } });
      if (!p?.publishedVersionId) throw notFound();
      const v = await this.prisma.projectVersion.findUnique({ where: { id: p.publishedVersionId }, select: { commitSha: true } });
      projectId = p.id; sha = v?.commitSha; env = 'live';
    } else throw notFound();
    const backend = sha ? await this.backendAt(projectId, sha) : null;
    if (!backend) throw notFound();
    if (env === 'live') {
      const ctl = await this.prisma.appBackend.findUnique({ where: { projectId }, select: { paused: true } });
      if (ctl?.paused) throw new HttpException({ message: 'This app is paused by its owner. Please check back later.', code: 'app_paused' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { projectId, env, backend };
  }

  // ───────── End-user accounts ─────────

  private requireAuth(ctx: AppContext) {
    if (!ctx.backend.auth.enabled) throw new NotFoundException({ message: 'This app does not have user accounts.', code: 'auth_disabled' });
  }
  private userDto(u: AppUser) { return { id: u.id, email: u.email }; }

  private async newSession(u: AppUser) {
    const token = `ast_${randomBytes(32).toString('base64url')}`;
    await this.prisma.appSession.create({ data: { tokenHash: sha256(token), appUserId: u.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5) } });
    return { token, user: this.userDto(u) };
  }

  private credentials(body: unknown) {
    const b = (body ?? {}) as { email?: unknown; password?: unknown };
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) throw new BadRequestException({ message: 'Enter a valid email address.', code: 'invalid_email' });
    if (password.length < 8 || password.length > 200) throw new BadRequestException({ message: 'Use a password of at least 8 characters.', code: 'weak_password' });
    return { email, password };
  }

  async signUp(ctx: AppContext, body: unknown) {
    this.requireAuth(ctx);
    const { email, password } = this.credentials(body);
    if (ctx.env === 'live') {
      const ctl = await this.prisma.appBackend.findUnique({ where: { projectId: ctx.projectId }, select: { signupsOpen: true } });
      if (ctl && !ctl.signupsOpen) throw new ForbiddenException({ message: 'New sign-ups are closed for this app. Existing members can still sign in.', code: 'signups_closed' });
    }
    const count = await this.prisma.appUser.count({ where: { projectId: ctx.projectId, env: ctx.env } });
    if (count >= this.config.APP_DATA_MAX_USERS) throw new ConflictException({ message: 'This app has reached its account limit. Please contact the app owner.', code: 'user_limit' });
    try {
      const u = await this.prisma.appUser.create({ data: { projectId: ctx.projectId, env: ctx.env, email, passwordHash: await hashPassword(password), lastSignInAt: new Date() } });
      return this.newSession(u);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ message: 'An account with this email already exists. Sign in instead.', code: 'email_taken' });
      throw e;
    }
  }

  async signIn(ctx: AppContext, body: unknown) {
    this.requireAuth(ctx);
    const { email, password } = this.credentials(body);
    const u = await this.prisma.appUser.findUnique({ where: { projectId_env_email: { projectId: ctx.projectId, env: ctx.env, email } } });
    const ok = await verifyPassword(password, u?.passwordHash ?? DUMMY_HASH); // same work whether or not the email exists
    if (!u || !ok) throw new UnauthorizedException({ message: 'Wrong email or password.', code: 'invalid_credentials' });
    await this.prisma.appUser.update({ where: { id: u.id }, data: { lastSignInAt: new Date() } });
    return this.newSession(u);
  }

  /** The signed-in end user for this app and environment, or null. A token from another app or environment is ignored. */
  async currentUser(ctx: AppContext, token: string | undefined): Promise<AppUser | null> {
    if (!token || !ctx.backend.auth.enabled || token.length > 200) return null;
    const s = await this.prisma.appSession.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!s || s.expiresAt < new Date() || s.user.projectId !== ctx.projectId || s.user.env !== ctx.env) return null;
    return s.user;
  }

  async me(ctx: AppContext, token: string | undefined) {
    this.requireAuth(ctx);
    const u = await this.currentUser(ctx, token);
    if (!u) throw new UnauthorizedException({ message: 'You are signed out. Please sign in again.', code: 'signed_out' });
    return { user: this.userDto(u) };
  }

  async signOut(token: string | undefined) {
    if (token) await this.prisma.appSession.deleteMany({ where: { tokenHash: sha256(token) } });
    return { ok: true };
  }

  // ───────── Records ─────────

  private collection(ctx: AppContext, name: string) {
    const c = Object.prototype.hasOwnProperty.call(ctx.backend.collections, name) ? ctx.backend.collections[name] : undefined;
    if (!c) throw new NotFoundException({ message: `This app has no "${name}" data.`, code: 'unknown_collection' });
    return c;
  }
  private signedIn(u: AppUser | null): AppUser {
    if (!u) throw new UnauthorizedException({ message: 'Please sign in first.', code: 'signin_required' });
    return u;
  }
  private dto(r: { id: string; ownerId: string | null; data: Prisma.JsonValue; createdAt: Date; updatedAt: Date }, u: AppUser | null) {
    return { ...(r.data as Record<string, unknown>), id: r.id, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), mine: !!u && r.ownerId === u.id };
  }

  async list(ctx: AppContext, name: string, u: AppUser | null, q: Record<string, unknown>) {
    const c = this.collection(ctx, name);
    if (c.access.read !== 'public') this.signedIn(u);
    const mine = q.mine === '1' || q.mine === 'true' || c.access.read === 'owner';
    if (mine) this.signedIn(u);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const order = q.order === 'asc' ? 'asc' : 'desc';
    const filters: Prisma.AppRecordWhereInput[] = [];
    for (const [k, v] of Object.entries(q)) {
      if (!k.startsWith('f.') || typeof v !== 'string') continue;
      const field = k.slice(2);
      const f = Object.prototype.hasOwnProperty.call(c.fields, field) ? c.fields[field] : undefined;
      if (!f) throw new BadRequestException({ message: `Unknown field "${field}".`, code: 'unknown_field' });
      const value = parseFilterValue(f, v);
      if (value === undefined) throw new BadRequestException({ message: `"${v}" is not a valid value for "${field}".`, code: 'invalid_filter' });
      filters.push({ data: { path: [field], equals: value as Prisma.InputJsonValue } });
    }
    const where: Prisma.AppRecordWhereInput = { projectId: ctx.projectId, env: ctx.env, collection: name, ...(mine ? { ownerId: u!.id } : {}), AND: filters };
    const cursor = typeof q.cursor === 'string' && /^[0-9a-f-]{36}$/.test(q.cursor) ? q.cursor : undefined;
    const rows = await this.prisma.appRecord.findMany({ where, orderBy: [{ createdAt: order }, { id: order }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const items = rows.slice(0, limit);
    return { items: items.map((r) => this.dto(r, u)), nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  private async findReadable(ctx: AppContext, name: string, id: string, u: AppUser | null) {
    const c = this.collection(ctx, name);
    if (c.access.read !== 'public') this.signedIn(u);
    const r = /^[0-9a-f-]{36}$/.test(id) ? await this.prisma.appRecord.findFirst({ where: { id, projectId: ctx.projectId, env: ctx.env, collection: name } }) : null;
    // Records a user may not read are indistinguishable from records that don't exist.
    if (!r || (c.access.read === 'owner' && r.ownerId !== u?.id)) throw new NotFoundException({ message: 'Not found.', code: 'not_found' });
    return { c, r };
  }

  async get(ctx: AppContext, name: string, id: string, u: AppUser | null) {
    return this.dto((await this.findReadable(ctx, name, id, u)).r, u);
  }

  async create(ctx: AppContext, name: string, u: AppUser | null, body: unknown) {
    const c = this.collection(ctx, name);
    if (c.access.create === 'users') this.signedIn(u);
    const v = validateAppRecord(c.fields, body, false);
    if (!v.ok) throw new BadRequestException({ message: v.error, code: 'invalid_record' });
    const count = await this.prisma.appRecord.count({ where: { projectId: ctx.projectId, env: ctx.env } });
    if (count >= this.config.APP_DATA_MAX_RECORDS) throw new ConflictException({ message: 'This app has reached its storage limit. Please contact the app owner.', code: 'record_limit' });
    const r = await this.prisma.appRecord.create({ data: { projectId: ctx.projectId, env: ctx.env, collection: name, ownerId: u?.id ?? null, data: v.data as Prisma.InputJsonValue } });
    return this.dto(r, u);
  }

  private async findModifiable(ctx: AppContext, name: string, id: string, u: AppUser | null) {
    const { c, r } = await this.findReadable(ctx, name, id, u);
    if (c.access.modify === 'none') throw new ForbiddenException({ message: 'These records can’t be changed.', code: 'read_only' });
    const me = this.signedIn(u);
    if (r.ownerId !== me.id) throw new ForbiddenException({ message: 'You can only change your own records.', code: 'not_owner' });
    return { c, r };
  }

  async update(ctx: AppContext, name: string, id: string, u: AppUser | null, body: unknown) {
    const { c, r } = await this.findModifiable(ctx, name, id, u);
    const v = validateAppRecord(c.fields, body, true);
    if (!v.ok) throw new BadRequestException({ message: v.error, code: 'invalid_record' });
    const merged = { ...(r.data as Record<string, unknown>), ...v.data };
    const check = validateAppRecord(c.fields, Object.fromEntries(Object.entries(merged).filter(([k]) => k in c.fields)), false);
    if (!check.ok) throw new BadRequestException({ message: check.error, code: 'invalid_record' });
    const updated = await this.prisma.appRecord.update({ where: { id: r.id }, data: { data: check.data as Prisma.InputJsonValue } });
    return this.dto(updated, u);
  }

  async remove(ctx: AppContext, name: string, id: string, u: AppUser | null) {
    const { r } = await this.findModifiable(ctx, name, id, u);
    await this.prisma.appRecord.delete({ where: { id: r.id } });
    return { ok: true };
  }

  // ───────── Owner view (platform users, project-authorized by the caller) ─────────

  /** Commits behind the preview (head) and live (published, still public and not moderated) environments. */
  async shas(p: { headVersionId: string | null; publishedVersionId: string | null; visibility: string; moderatedAt: Date | null }) {
    const [head, pub] = await Promise.all([
      p.headVersionId ? this.prisma.projectVersion.findUnique({ where: { id: p.headVersionId }, select: { commitSha: true } }) : null,
      p.publishedVersionId && p.visibility === 'public' && !p.moderatedAt ? this.prisma.projectVersion.findUnique({ where: { id: p.publishedVersionId }, select: { commitSha: true } }) : null,
    ]);
    return { headSha: head?.commitSha ?? null, publishedSha: pub?.commitSha ?? null };
  }

  async ownerOverview(projectId: string, headSha: string | null, publishedSha: string | null, env: AppEnv) {
    const sha = env === 'live' ? publishedSha : headSha;
    const backend = sha ? await this.backendAt(projectId, sha) : null;
    const [counts, users] = await Promise.all([
      this.prisma.appRecord.groupBy({ by: ['collection'], where: { projectId, env }, _count: true }),
      this.prisma.appUser.count({ where: { projectId, env } }),
    ]);
    return {
      env,
      available: env === 'preview' ? !!backend : !!backend && !!publishedSha,
      backend,
      collections: Object.entries(backend?.collections ?? {}).map(([name, c]) => ({ name, access: c.access, fields: Object.entries(c.fields).map(([fname, f]) => ({ name: fname, ...f })), records: counts.find((x) => x.collection === name)?._count ?? 0 })),
      orphanedRecords: counts.filter((x) => !backend?.collections[x.collection]).reduce((n, x) => n + x._count, 0),
      users,
      limits: { records: this.config.APP_DATA_MAX_RECORDS, users: this.config.APP_DATA_MAX_USERS },
    };
  }

  async ownerRecords(projectId: string, env: AppEnv, collection: string, cursor?: string) {
    const rows = await this.prisma.appRecord.findMany({ where: { projectId, env, collection }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51, include: { owner: { select: { email: true } } }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const items = rows.slice(0, 50);
    return { items: items.map((r) => ({ id: r.id, data: r.data, owner: r.owner?.email ?? null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })), nextCursor: rows.length > 50 ? items.at(-1)!.id : null };
  }

  async ownerUsers(projectId: string, env: AppEnv) {
    const rows = await this.prisma.appUser.findMany({ where: { projectId, env }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, email: true, createdAt: true, lastSignInAt: true, _count: { select: { records: true } } } });
    return rows.map((u) => ({ id: u.id, email: u.email, createdAt: u.createdAt.toISOString(), lastSignInAt: u.lastSignInAt?.toISOString() ?? null, records: u._count.records }));
  }

  async ownerDeleteRecord(projectId: string, env: AppEnv, id: string) {
    const r = await this.prisma.appRecord.deleteMany({ where: { id, projectId, env } });
    if (!r.count) throw new NotFoundException('Record not found');
  }

  /** Deletes an end user, their sessions and every record they created. */
  async ownerDeleteUser(projectId: string, env: AppEnv, id: string) {
    const r = await this.prisma.appUser.deleteMany({ where: { id, projectId, env } });
    if (!r.count) throw new NotFoundException('User not found');
  }

  async ownerClear(projectId: string, env: AppEnv) {
    const [records, users] = await this.prisma.$transaction([
      this.prisma.appRecord.deleteMany({ where: { projectId, env } }),
      this.prisma.appUser.deleteMany({ where: { projectId, env } }),
    ]);
    return { records: records.count, users: users.count };
  }
}
