import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ProjectsService } from '../projects/projects.service.js';
import { AuditService } from '../audit/audit.service.js';
import { InsightsService } from './insights.service.js';
import { AppDataService } from '../appdata/appdata.service.js';

const Uuid = new ParseUUIDPipe();
const DaysQ = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), 'days must be 7, 30 or 90').default(30) });
const ControlsBody = z.object({ signupsOpen: z.boolean().optional(), paused: z.boolean().optional() }).strict().refine((b) => Object.keys(b).length > 0, 'Nothing to change');
const TeamAdd = z.object({ emails: z.array(z.string().max(254)).min(1).max(100) }).strict();
const TeamRemove = z.object({ email: z.string().max(254) }).strict();
const ExportQ = z.object({ collection: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/) });

/** The project owner's dashboard: analytics, money and controls for what they built. */
@Controller('projects/:id/insights')
export class InsightsController {
  constructor(
    @Inject(InsightsService) private readonly s: InsightsService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AppDataService) private readonly appData: AppDataService,
  ) {}

  /** Team apps: who may have an account on the live app. Managing it takes an admin; it's audited. */
  @Get('team') async team(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) {
    await this.projects.getAuthorized(u, id, 'viewer');
    return this.appData.teamList(id, 'live');
  }
  @Post('team') @HttpCode(200) @Throttle({ default: { limit: 30, ttl: 60_000 } }) async teamAdd(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(TeamAdd)) b: z.infer<typeof TeamAdd>) {
    const p = await this.projects.getAuthorized(u, id, 'admin');
    const r = await this.appData.teamAdd(id, 'live', b.emails);
    await this.audit.record({ action: 'app.team_added', actorId: u.id, organizationId: p.organizationId, targetType: 'project', targetId: id, metadata: { count: r.added } });
    return r;
  }
  @Delete('team') async teamRemove(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(TeamRemove)) b: z.infer<typeof TeamRemove>) {
    const p = await this.projects.getAuthorized(u, id, 'admin');
    const r = await this.appData.teamRemove(id, 'live', b.email);
    await this.audit.record({ action: 'app.team_removed', actorId: u.id, organizationId: p.organizationId, targetType: 'project', targetId: id });
    return r;
  }

  @Get() async overview(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Query(new ZodPipe(DaysQ)) q: z.infer<typeof DaysQ>) {
    const p = await this.projects.getAuthorized(u, id, 'viewer');
    return this.s.overview(u, p, q.days);
  }

  /** Pausing or closing sign-ups affects real users of the live app, so it takes an admin. */
  @Patch('controls') async controls(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(ControlsBody)) b: z.infer<typeof ControlsBody>) {
    const p = await this.projects.getAuthorized(u, id, 'admin');
    const r = await this.s.setControls(id, b);
    await this.audit.record({ action: 'app.controls_changed', actorId: u.id, organizationId: p.organizationId, targetType: 'project', targetId: id, metadata: b });
    return r;
  }

  /** CSV exports of the live app's users and data. Exports hold end users' personal data: admins only, and audited. */
  @Get('export/users') @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="app-users.csv"') @Header('Cache-Control', 'no-store')
  async exportUsers(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) {
    const p = await this.projects.getAuthorized(u, id, 'admin');
    await this.audit.record({ action: 'app.users_exported', actorId: u.id, organizationId: p.organizationId, targetType: 'project', targetId: id });
    return this.s.exportUsers(id);
  }

  @Get('export/records') @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="app-data.csv"') @Header('Cache-Control', 'no-store')
  async exportRecords(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Query(new ZodPipe(ExportQ)) q: z.infer<typeof ExportQ>) {
    const p = await this.projects.getAuthorized(u, id, 'admin');
    await this.audit.record({ action: 'app.records_exported', actorId: u.id, organizationId: p.organizationId, targetType: 'project', targetId: id, metadata: { collection: q.collection } });
    return this.s.exportCollection(id, q.collection);
  }
}
