import { Body, Controller, Delete, Get, Inject, Ip, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PlatformAdminGuard, RequirePlatformRole } from '../auth/platform-admin.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { SubmitTemplateSchema, TemplatesQuerySchema, TemplatesService } from './templates.service.js';

const Uuid = new ParseUUIDPipe();
const SlugPipe = new ZodPipe(z.string().regex(/^[a-z0-9-]{1,80}$/));
const UseBody = z.object({ organizationId: z.uuid().optional(), name: z.string().trim().min(1).max(80).optional() });
const ReviewBody = z.object({ decision: z.enum(['approve', 'reject', 'feature', 'unfeature']), note: z.string().trim().max(300).optional() });
const QueueQ = z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() });

@Controller()
export class TemplatesController {
  constructor(@Inject(TemplatesService) private readonly t: TemplatesService) {}

  @Public() @Get('templates') list(@Query(new ZodPipe(TemplatesQuerySchema)) q: z.infer<typeof TemplatesQuerySchema>) { return this.t.list(q); }
  @Public() @Get('templates/:slug') get(@Param('slug', SlugPipe) slug: string) { return this.t.get(slug); }
  @Post('templates/:slug/use') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  use(@CurrentUser() u: AuthUser, @Param('slug', SlugPipe) slug: string, @Body(new ZodPipe(UseBody)) b: z.infer<typeof UseBody>, @Ip() ip: string) { return this.t.use(u, slug, b.organizationId, b.name, ip); }

  @Get('projects/:id/template') mine(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) { return this.t.mine(u, id); }
  @Put('projects/:id/template') submit(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(SubmitTemplateSchema)) b: z.infer<typeof SubmitTemplateSchema>, @Ip() ip: string) { return this.t.submit(u, id, b, ip); }
  @Delete('projects/:id/template') withdraw(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Ip() ip: string) { return this.t.withdraw(u, id, ip); }

  @Get('admin/templates') @UseGuards(PlatformAdminGuard) @RequirePlatformRole('support') queue(@Query(new ZodPipe(QueueQ)) q: z.infer<typeof QueueQ>) { return this.t.queue(q.status); }
  @Post('admin/templates/:id/review') @UseGuards(PlatformAdminGuard) @RequirePlatformRole('admin')
  review(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(ReviewBody)) b: z.infer<typeof ReviewBody>) { return this.t.review(u, id, b.decision, b.note); }
}
