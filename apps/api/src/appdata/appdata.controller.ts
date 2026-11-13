import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { rateLimits } from '../common/rate-limits.js';
import { ProjectsService } from '../projects/projects.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppDataService, type AppEnv } from './appdata.service.js';
import { AppServicesService } from './app-services.service.js';

const Key = new ZodPipe(z.string().regex(/^(pv_[A-Za-z0-9_-]{20,64}|lv_[0-9a-f-]{36})$/, 'Unknown app'));
const Name = new ZodPipe(z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/, 'Unknown collection'));
const Id = new ZodPipe(z.string().max(64));
const data = { default: { limit: () => rateLimits.appData, ttl: 60_000 } };
const auth = { default: { limit: () => rateLimits.appAuth, ttl: 60_000 } };

/**
 * Public data API used by generated apps through the `App` SDK (CORS open, no platform credentials accepted).
 * End users authenticate with `x-app-session`, never with a platform token.
 */
@Public()
@Controller('appdata/:key')
export class AppDataController {
  constructor(@Inject(AppDataService) private readonly s: AppDataService, @Inject(AppServicesService) private readonly svc: AppServicesService) {}

  // Free services, available to any live or preview app (never as an open proxy: the app key is checked first).
  @Get('services/currency/latest') @Throttle(data) async rates(@Param('key', Key) key: string, @Query('base') base?: string, @Query('symbols') symbols?: string) {
    await this.s.resolve(key);
    return this.svc.latestRates(String(base ?? 'EUR'), typeof symbols === 'string' && symbols ? symbols.split(',').map((x) => x.trim()) : undefined);
  }
  @Get('services/weather') @Throttle(data) async weather(@Param('key', Key) key: string, @Query('lat') lat?: string, @Query('lon') lon?: string, @Query('timezone') tz?: string) {
    await this.s.resolve(key);
    return this.svc.weather(Number(lat ?? NaN), Number(lon ?? NaN), typeof tz === 'string' && tz && tz.length <= 64 ? tz : 'UTC');
  }
  @Get('services/countries') @Throttle(data) async countries(@Param('key', Key) key: string, @Query('lang') lang?: string) {
    await this.s.resolve(key);
    return this.svc.countries(typeof lang === 'string' && lang.length <= 20 ? lang : 'en');
  }

  @Post('auth/signup') @Throttle(auth) async signUp(@Param('key', Key) key: string, @Body() b: unknown) { return this.s.signUp(await this.s.resolve(key), b); }
  @Post('auth/signin') @HttpCode(200) @Throttle(auth) async signIn(@Param('key', Key) key: string, @Body() b: unknown) { return this.s.signIn(await this.s.resolve(key), b); }
  @Post('auth/signout') @HttpCode(200) @Throttle(data) async signOut(@Param('key', Key) key: string, @Headers('x-app-session') t?: string) { await this.s.resolve(key); return this.s.signOut(t); }
  @Get('auth/me') @Throttle(data) async me(@Param('key', Key) key: string, @Headers('x-app-session') t?: string) { return this.s.me(await this.s.resolve(key), t); }

  @Get('c/:name') @Throttle(data) async list(@Param('key', Key) key: string, @Param('name', Name) name: string, @Query() q: Record<string, unknown>, @Headers('x-app-session') t?: string) {
    const ctx = await this.s.resolve(key);
    return this.s.list(ctx, name, await this.s.currentUser(ctx, t), q);
  }
  @Post('c/:name') @Throttle(data) async create(@Param('key', Key) key: string, @Param('name', Name) name: string, @Body() b: unknown, @Headers('x-app-session') t?: string) {
    const ctx = await this.s.resolve(key);
    return this.s.create(ctx, name, await this.s.currentUser(ctx, t), b);
  }
  @Get('c/:name/:id') @Throttle(data) async get(@Param('key', Key) key: string, @Param('name', Name) name: string, @Param('id', Id) id: string, @Headers('x-app-session') t?: string) {
    const ctx = await this.s.resolve(key);
    return this.s.get(ctx, name, id, await this.s.currentUser(ctx, t));
  }
  @Patch('c/:name/:id') @Throttle(data) async update(@Param('key', Key) key: string, @Param('name', Name) name: string, @Param('id', Id) id: string, @Body() b: unknown, @Headers('x-app-session') t?: string) {
    const ctx = await this.s.resolve(key);
    return this.s.update(ctx, name, id, await this.s.currentUser(ctx, t), b);
  }
  @Delete('c/:name/:id') @Throttle(data) async remove(@Param('key', Key) key: string, @Param('name', Name) name: string, @Param('id', Id) id: string, @Headers('x-app-session') t?: string) {
    const ctx = await this.s.resolve(key);
    return this.s.remove(ctx, name, id, await this.s.currentUser(ctx, t));
  }
}

const EnvQ = z.object({ env: z.enum(['preview', 'live']).default('preview') });
const RecordsQ = EnvQ.extend({ collection: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/), cursor: z.uuid().optional() });
const Uuid = new ParseUUIDPipe();

/** The app owner's view of an app's data, in the workspace. Platform auth + project role. */
@Controller('projects/:id/data')
export class ProjectDataController {
  constructor(@Inject(AppDataService) private readonly s: AppDataService, @Inject(ProjectsService) private readonly projects: ProjectsService, @Inject(AuditService) private readonly audit: AuditService) {}

  private async project(u: AuthUser, id: string, min: 'viewer' | 'member' | 'admin') {
    const p = await this.projects.getAuthorized(u, id, min);
    return { p, ...(await this.s.shas(p)) };
  }

  @Get() async overview(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Query(new ZodPipe(EnvQ)) q: z.infer<typeof EnvQ>) {
    const { headSha, publishedSha } = await this.project(u, id, 'viewer');
    return this.s.ownerOverview(id, headSha, publishedSha, q.env);
  }
  @Get('records') async records(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Query(new ZodPipe(RecordsQ)) q: z.infer<typeof RecordsQ>) {
    await this.project(u, id, 'viewer');
    return this.s.ownerRecords(id, q.env, q.collection, q.cursor);
  }
  @Get('users') async users(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Query(new ZodPipe(EnvQ)) q: z.infer<typeof EnvQ>) {
    await this.project(u, id, 'viewer');
    return this.s.ownerUsers(id, q.env);
  }
  @Delete('records/:recordId') @HttpCode(204) async deleteRecord(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Param('recordId', Uuid) rid: string, @Query(new ZodPipe(EnvQ)) q: z.infer<typeof EnvQ>) {
    const { p } = await this.project(u, id, 'member');
    await this.s.ownerDeleteRecord(id, q.env, rid);
    await this.audit.record({ action: 'appdata.record_deleted', actorId: u.id, organizationId: p.organizationId, targetType: 'project', targetId: id, metadata: { env: q.env } });
  }
  @Delete('users/:userId') @HttpCode(204) async deleteUser(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Param('userId', Uuid) uid: string, @Query(new ZodPipe(EnvQ)) q: z.infer<typeof EnvQ>) {
    const { p } = await this.project(u, id, 'admin');
    await this.s.ownerDeleteUser(id, q.env, uid);
    await this.audit.record({ action: 'appdata.user_deleted', actorId: u.id, organizationId: p.organizationId, targetType: 'project', targetId: id, metadata: { env: q.env } });
  }
  /** Only preview data can be wiped in one go; live data belongs to the app's real users. */
  @Post('clear-preview') @HttpCode(200) async clear(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) {
    const { p } = await this.project(u, id, 'member');
    const r = await this.s.ownerClear(id, 'preview' as AppEnv);
    await this.audit.record({ action: 'appdata.preview_cleared', actorId: u.id, organizationId: p.organizationId, targetType: 'project', targetId: id, metadata: r });
    return r;
  }
}
