import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RetentionService } from './retention.service.js';

const TimelineQ = z.object({ organizationId: z.uuid().optional(), projectId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });

@Controller()
export class RetentionController {
  constructor(@Inject(RetentionService) private readonly r: RetentionService) {}
  @Get('me/achievements') achievements(@CurrentUser() u: AuthUser) { return this.r.achievements(u); }
  @Get('timeline') timeline(@CurrentUser() u: AuthUser, @Query(new ZodPipe(TimelineQ)) q: z.infer<typeof TimelineQ>) { return this.r.timeline(u, q.organizationId, q.projectId, q.limit); }
}
