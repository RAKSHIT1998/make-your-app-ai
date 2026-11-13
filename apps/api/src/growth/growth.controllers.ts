import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser, OptionalUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PlatformAdminGuard, RequirePlatformRole } from '../auth/platform-admin.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ExploreQuerySchema, PublishSchema, ReportSchema, ShowcaseService, type PublishInput } from './showcase.service.js';
import { GrowthSettingsSchema, ReferralsService } from './referrals.service.js';
import { ModerationService } from './moderation.service.js';
import { CollectionPatchSchema, CollectionSchema, CommentReportSchema, CommentSchema, CommunityService } from './community.service.js';

const Slug = z.string().regex(/^[a-z0-9-]{1,80}$/);
const SlugPipe = new ZodPipe(Slug);
const Uuid = new ParseUUIDPipe();
const RemixBody = z.object({ organizationId: z.uuid().optional() });
const ClaimBody = z.object({ code: z.string().trim().min(4).max(20) });
const HideBody = z.object({ note: z.string().trim().min(3).max(300) });
const ModerateBody = z.object({ action: z.enum(['remove', 'restore']) });
const FeatureBody = z.object({ featured: z.boolean() });

/** Public showcase: Explore, project pages, creator profiles. Signed-in callers are recognised but not required. */
@Public()
@Controller()
export class ShowcaseController {
  constructor(@Inject(ShowcaseService) private readonly s: ShowcaseService) {}

  @Get('explore') explore(@Query(new ZodPipe(ExploreQuerySchema)) q: z.infer<typeof ExploreQuerySchema>) { return this.s.explore(q); }
  @Get('showcase/:slug') page(@Param('slug', SlugPipe) slug: string, @OptionalUser() u: AuthUser | null) { return this.s.page(slug, u); }
  @Get('showcase/:slug/play') @Throttle({ default: { limit: 60, ttl: 60_000 } }) play(@Param('slug', SlugPipe) slug: string) { return this.s.play(slug); }
  @Post('showcase/:slug/view') @HttpCode(200) @Throttle({ default: { limit: 120, ttl: 60_000 } })
  view(@Param('slug', SlugPipe) slug: string, @OptionalUser() u: AuthUser | null, @Ip() ip: string, @Headers('user-agent') ua?: string) { return this.s.view(slug, u, ip, ua); }
  @Get('creators/:handle') creator(@Param('handle', SlugPipe) handle: string, @OptionalUser() u: AuthUser | null) { return this.s.creator(handle, u); }
}

/** Signed-in showcase actions. */
@Controller()
export class ShowcaseActionsController {
  constructor(@Inject(ShowcaseService) private readonly s: ShowcaseService) {}

  @Put('showcase/:slug/like') @Throttle({ default: { limit: 60, ttl: 60_000 } }) like(@CurrentUser() u: AuthUser, @Param('slug', SlugPipe) slug: string) { return this.s.like(u, slug, true); }
  @Delete('showcase/:slug/like') @Throttle({ default: { limit: 60, ttl: 60_000 } }) unlike(@CurrentUser() u: AuthUser, @Param('slug', SlugPipe) slug: string) { return this.s.like(u, slug, false); }
  @Post('showcase/:slug/remix') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  remix(@CurrentUser() u: AuthUser, @Param('slug', SlugPipe) slug: string, @Body(new ZodPipe(RemixBody)) b: z.infer<typeof RemixBody>, @Ip() ip: string) { return this.s.remix(u, slug, b.organizationId, ip); }
  @Post('showcase/:slug/report') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  report(@CurrentUser() u: AuthUser, @Param('slug', SlugPipe) slug: string, @Body(new ZodPipe(ReportSchema)) b: z.infer<typeof ReportSchema>) { return this.s.report(u, slug, b); }

  @Get('projects/:id/publishing') publishing(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) { return this.s.publishing(u, id); }
  @Put('projects/:id/publishing') publish(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(PublishSchema)) b: PublishInput, @Ip() ip: string) { return this.s.publish(u, id, b, ip); }
}

@Controller('referrals')
export class ReferralsController {
  constructor(@Inject(ReferralsService) private readonly r: ReferralsService) {}
  @Get() dashboard(@CurrentUser() u: AuthUser) { return this.r.dashboard(u); }
  @Post('claim') @Throttle({ default: { limit: 10, ttl: 60_000 } }) claim(@CurrentUser() u: AuthUser, @Body(new ZodPipe(ClaimBody)) b: z.infer<typeof ClaimBody>) { return this.r.claim(u, b.code); }
}

@Controller('admin/growth')
@UseGuards(PlatformAdminGuard)
@RequirePlatformRole('support')
export class GrowthAdminController {
  constructor(
    @Inject(ReferralsService) private readonly r: ReferralsService,
    @Inject(ModerationService) private readonly m: ModerationService,
    @Inject(CommunityService) private readonly community: CommunityService,
  ) {}
  @Get('referrals') referrals() { return this.r.adminSummary(); }
  @Get('showcase') showcase() { return this.m.queue(); }
  @Get('comments') comments() { return this.community.moderationQueue(); }
  @RequirePlatformRole('admin') @Post('comments/:id/moderate') moderateComment(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(ModerateBody)) b: z.infer<typeof ModerateBody>) { return this.community.moderate(u, id, b.action); }
  @RequirePlatformRole('admin') @Patch('settings') settings(@CurrentUser() u: AuthUser, @Body(new ZodPipe(GrowthSettingsSchema)) b: z.infer<typeof GrowthSettingsSchema>) { return this.r.updateSettings(u, b); }
  @RequirePlatformRole('admin') @Post('projects/:id/feature') feature(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(FeatureBody)) b: z.infer<typeof FeatureBody>) { return this.m.feature(u, id, b.featured); }
  @RequirePlatformRole('admin') @Post('projects/:id/hide') hide(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(HideBody)) b: z.infer<typeof HideBody>) { return this.m.setHidden(u, id, true, b.note); }
  @RequirePlatformRole('admin') @Post('projects/:id/restore') restore(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) { return this.m.setHidden(u, id, false, 'restored'); }
  @RequirePlatformRole('admin') @Post('reports/:id/dismiss') dismiss(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) { return this.m.dismiss(u, id); }
}

const CommentIdPipe = Uuid;
const FeedQuery = z.object({ page: z.coerce.number().int().min(1).max(50).default(1) });
const CollectionsQuery = z.object({ slug: Slug.optional() });

/** Public reads for community content. Signed-in callers are recognised so "mine" flags are right. */
@Public()
@Controller()
export class CommunityPublicController {
  constructor(@Inject(CommunityService) private readonly c: CommunityService) {}
  @Get('showcase/:slug/comments') comments(@Param('slug', SlugPipe) slug: string, @OptionalUser() u: AuthUser | null) { return this.c.comments(slug, u); }
  @Get('collections/:id') collection(@Param('id', Uuid) id: string, @OptionalUser() u: AuthUser | null) { return this.c.collection(id, u); }
}

/** Signed-in community actions. Writes are throttled per client on top of the per-user limits in the service. */
@Controller()
export class CommunityController {
  constructor(@Inject(CommunityService) private readonly c: CommunityService) {}
  @Post('showcase/:slug/comments') @Throttle({ default: { limit: 20, ttl: 60_000 } })
  addComment(@CurrentUser() u: AuthUser, @Param('slug', SlugPipe) slug: string, @Body(new ZodPipe(CommentSchema)) b: z.infer<typeof CommentSchema>) { return this.c.addComment(u, slug, b); }
  @Delete('comments/:id') @HttpCode(204) @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async removeComment(@CurrentUser() u: AuthUser, @Param('id', CommentIdPipe) id: string, @Ip() ip: string) { await this.c.removeComment(u, id, ip); }
  @Post('comments/:id/report') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reportComment(@CurrentUser() u: AuthUser, @Param('id', CommentIdPipe) id: string, @Body(new ZodPipe(CommentReportSchema)) b: z.infer<typeof CommentReportSchema>) { return this.c.reportComment(u, id, b); }

  @Put('creators/:handle/follow') @Throttle({ default: { limit: 60, ttl: 60_000 } }) follow(@CurrentUser() u: AuthUser, @Param('handle', SlugPipe) h: string) { return this.c.follow(u, h, true); }
  @Delete('creators/:handle/follow') @Throttle({ default: { limit: 60, ttl: 60_000 } }) unfollow(@CurrentUser() u: AuthUser, @Param('handle', SlugPipe) h: string) { return this.c.follow(u, h, false); }
  @Get('feed/following') feed(@CurrentUser() u: AuthUser, @Query(new ZodPipe(FeedQuery)) q: z.infer<typeof FeedQuery>) { return this.c.feed(u, q.page); }

  @Get('collections') mine(@CurrentUser() u: AuthUser, @Query(new ZodPipe(CollectionsQuery)) q: z.infer<typeof CollectionsQuery>) { return this.c.myCollections(u, q.slug); }
  @Post('collections') @Throttle({ default: { limit: 20, ttl: 60_000 } }) createCollection(@CurrentUser() u: AuthUser, @Body(new ZodPipe(CollectionSchema)) b: z.infer<typeof CollectionSchema>) { return this.c.createCollection(u, b); }
  @Patch('collections/:id') updateCollection(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(CollectionPatchSchema)) b: z.infer<typeof CollectionPatchSchema>) { return this.c.updateCollection(u, id, b); }
  @Delete('collections/:id') @HttpCode(204) async deleteCollection(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) { await this.c.deleteCollection(u, id); }
  @Put('collections/:id/items/:slug') @Throttle({ default: { limit: 60, ttl: 60_000 } }) addItem(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Param('slug', SlugPipe) slug: string) { return this.c.setItem(u, id, slug, true); }
  @Delete('collections/:id/items/:slug') @Throttle({ default: { limit: 60, ttl: 60_000 } }) removeItem(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Param('slug', SlugPipe) slug: string) { return this.c.setItem(u, id, slug, false); }
}
