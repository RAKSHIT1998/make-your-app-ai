import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PlatformAdminGuard, RequirePlatformRole } from '../auth/platform-admin.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AiRoutingService, AiTier, RouteInput, TierRateInput } from './ai-routing.service.js';
import { AdminService, CreditAdjust, PackInput, PackUpdate, PlanInput, PlanUpdate, PriceInput, PriceUpdate } from './admin.service.js';

const Days = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
const UsersQ = z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const StatusBody = z.object({ reason: z.string().trim().min(3).max(300) });
const Uuid = new ParseUUIDPipe();

/** Owner administration API. Separately authorized by platform role on every request. */
@Controller('admin')
@UseGuards(PlatformAdminGuard)
@RequirePlatformRole('support')
export class AdminController {
  constructor(@Inject(AdminService) private readonly a: AdminService, @Inject(AiRoutingService) private readonly ai: AiRoutingService) {}

  @Get('overview') overview(@Query(new ZodPipe(Days)) q: z.infer<typeof Days>) { return this.a.overview(q.days); }
  @Get('users') users(@Query(new ZodPipe(UsersQ)) q: z.infer<typeof UsersQ>) { return this.a.users(q.q, q.limit); }
  @Get('audit-log') audit(@Query(new ZodPipe(UsersQ)) q: z.infer<typeof UsersQ>) { return this.a.auditLog(q.limit); }
  @Get('plans') plans() { return this.a.plans(); }
  @Get('credit-packs') packs() { return this.a.packs(); }

  @RequirePlatformRole('admin') @Post('users/:id/suspend') suspend(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(StatusBody)) b: z.infer<typeof StatusBody>) { return this.a.setUserStatus(u, id, 'suspended', b.reason); }
  @RequirePlatformRole('admin') @Post('users/:id/restore') restore(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(StatusBody)) b: z.infer<typeof StatusBody>) { return this.a.setUserStatus(u, id, 'active', b.reason); }
  @RequirePlatformRole('admin') @Post('organizations/:id/credits') credits(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(CreditAdjust)) b: z.infer<typeof CreditAdjust>) { return this.a.adjustCredits(u, id, b); }

  @RequirePlatformRole('superadmin') @Post('plans') createPlan(@CurrentUser() u: AuthUser, @Body(new ZodPipe(PlanInput)) b: z.infer<typeof PlanInput>) { return this.a.createPlan(u, b); }
  @RequirePlatformRole('superadmin') @Patch('plans/:id') updatePlan(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(PlanUpdate)) b: z.infer<typeof PlanUpdate>) { return this.a.updatePlan(u, id, b); }
  @RequirePlatformRole('superadmin') @Post('plans/:id/prices') addPrice(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(PriceInput)) b: z.infer<typeof PriceInput>) { return this.a.addPrice(u, id, b); }
  @RequirePlatformRole('superadmin') @Patch('prices/:id') updatePrice(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(PriceUpdate)) b: z.infer<typeof PriceUpdate>) { return this.a.updatePrice(u, id, b); }
  @RequirePlatformRole('superadmin') @Post('credit-packs') createPack(@CurrentUser() u: AuthUser, @Body(new ZodPipe(PackInput)) b: z.infer<typeof PackInput>) { return this.a.createPack(u, b); }
  @RequirePlatformRole('superadmin') @Patch('credit-packs/:id') updatePack(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(PackUpdate)) b: z.infer<typeof PackUpdate>) { return this.a.updatePack(u, id, b); }

  @Get('ai/routing') aiRouting() { return this.ai.overview(); }
  @RequirePlatformRole('superadmin') @Put('ai/routes') saveRoute(@CurrentUser() u: AuthUser, @Body(new ZodPipe(RouteInput)) b: z.infer<typeof RouteInput>) { return this.ai.upsertRoute(u, b); }
  @RequirePlatformRole('superadmin') @Delete('ai/routes/:id') deleteRoute(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) { return this.ai.deleteRoute(u, id); }
  @RequirePlatformRole('superadmin') @Put('ai/tier-rates/:tier') setRate(@CurrentUser() u: AuthUser, @Param('tier', new ZodPipe(AiTier)) tier: z.infer<typeof AiTier>, @Body(new ZodPipe(TierRateInput)) b: z.infer<typeof TierRateInput>) { return this.ai.setTierRate(u, tier, b); }
}
