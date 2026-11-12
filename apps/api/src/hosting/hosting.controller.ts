import { Body, Controller, Delete, Get, HttpCode, Inject, Ip, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PlatformAdminGuard, RequirePlatformRole } from '../auth/platform-admin.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { rateLimits } from '../common/rate-limits.js';
import { DomainSchema, EnvVarSchema, HostingService } from './hosting.service.js';

const Uuid = new ParseUUIDPipe();
const OrgQ = z.object({ organizationId: z.uuid().optional() });
const KeyPipe = new ZodPipe(z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/));
const HostPipe = new ZodPipe(z.string().toLowerCase().max(253).regex(/^[a-z0-9.-]+$/));

/** Cloud Studio. Provider credentials stay server-side; env values are write-only from the browser. */
@Controller()
export class HostingController {
  constructor(@Inject(HostingService) private readonly h: HostingService) {}

  @Get('hosting/sites') sites(@CurrentUser() u: AuthUser, @Query(new ZodPipe(OrgQ)) q: z.infer<typeof OrgQ>) { return this.h.sites(u, q.organizationId); }
  @Get('projects/:id/hosting') status(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) { return this.h.status(u, id); }
  @Post('projects/:id/deployments') @Throttle({ default: { limit: () => rateLimits.deploy, ttl: 60_000 } })
  deploy(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Ip() ip: string) { return this.h.deploy(u, id, ip); }
  @Post('projects/:id/deployments/:did/rollback') @Throttle({ default: { limit: () => rateLimits.deploy, ttl: 60_000 } })
  rollback(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Param('did', Uuid) did: string, @Ip() ip: string) { return this.h.deploy(u, id, ip, did); }
  @Get('projects/:id/deployments/:did/logs') logs(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Param('did', Uuid) did: string) { return this.h.logs(u, id, did); }

  @Put('projects/:id/env') setEnv(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(EnvVarSchema)) b: z.infer<typeof EnvVarSchema>, @Ip() ip: string) { return this.h.setEnv(u, id, b, ip); }
  @Delete('projects/:id/env/:key') @HttpCode(204) deleteEnv(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Param('key', KeyPipe) key: string, @Ip() ip: string) { return this.h.deleteEnv(u, id, key, ip); }

  @Post('projects/:id/domains') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  addDomain(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(DomainSchema)) b: z.infer<typeof DomainSchema>, @Ip() ip: string) { return this.h.addDomain(u, id, b.hostname, ip); }
  @Post('projects/:id/domains/:host/check') @HttpCode(200) checkDomain(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Param('host', HostPipe) host: string) { return this.h.checkDomain(u, id, host); }
  @Delete('projects/:id/domains/:host') @HttpCode(204) removeDomain(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Param('host', HostPipe) host: string, @Ip() ip: string) { return this.h.removeDomain(u, id, host, ip); }

  @Get('admin/hosting') @UseGuards(PlatformAdminGuard) @RequirePlatformRole('support') admin() { return this.h.adminStats(); }
}
