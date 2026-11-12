import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { BillingService } from './billing.service.js';

const OrgQuery = z.object({ organizationId: z.uuid().optional() });
const SubBody = z.object({ planPriceId: z.uuid(), organizationId: z.uuid().optional() });
const UsageQuery = z.object({ organizationId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const TopupBody = z.object({ creditPackId: z.uuid(), organizationId: z.uuid().optional() });

@Controller('billing')
export class BillingController {
  constructor(@Inject(BillingService) private readonly b: BillingService) {}

  @Public() @Get('plans') plans() { return this.b.catalogue(); }
  @Get('overview') overview(@CurrentUser() u: AuthUser, @Query(new ZodPipe(OrgQuery)) q: z.infer<typeof OrgQuery>) { return this.b.overview(u, q.organizationId); }
  @Get('usage') usage(@CurrentUser() u: AuthUser, @Query(new ZodPipe(UsageQuery)) q: z.infer<typeof UsageQuery>) { return this.b.usage(u, q.organizationId, q.limit); }
  @Post('checkout/subscription') @Throttle({ default: { limit: 10, ttl: 60_000 } }) subscribe(@CurrentUser() u: AuthUser, @Body(new ZodPipe(SubBody)) b: z.infer<typeof SubBody>) { return this.b.startSubscription(u, b.planPriceId, b.organizationId); }
  @Post('checkout/topup') @Throttle({ default: { limit: 10, ttl: 60_000 } }) topup(@CurrentUser() u: AuthUser, @Body(new ZodPipe(TopupBody)) b: z.infer<typeof TopupBody>) { return this.b.startTopup(u, b.creditPackId, b.organizationId); }
  @Get('checkouts/:id') checkout(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.b.checkoutStatus(u, id); }
  @Post('subscription/cancel') @HttpCode(200) cancel(@CurrentUser() u: AuthUser, @Body(new ZodPipe(OrgQuery)) b: z.infer<typeof OrgQuery>) { return this.b.cancel(u, b.organizationId); }
}

/** Platform billing webhooks — the only path that activates paid entitlements or credits purchases. */
@Public()
@Controller('webhooks/billing')
export class BillingWebhooksController {
  constructor(@Inject(BillingService) private readonly b: BillingService) {}

  @Post(':provider')
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  receive(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>, @Headers() headers: Record<string, string>) {
    return this.b.handleWebhook(provider, req.rawBody, headers);
  }
}
