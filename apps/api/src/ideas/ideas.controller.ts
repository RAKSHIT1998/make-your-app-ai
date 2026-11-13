import { Body, Controller, Get, Inject, Ip, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { IdeasService, ValidateIdeaSchema } from './ideas.service.js';

const HistoryQuery = z.object({ organizationId: z.uuid().optional() });

@Controller('ideas')
export class IdeasController {
  constructor(@Inject(IdeasService) private readonly ideas: IdeasService) {}

  @Post('validate') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  validate(@CurrentUser() u: AuthUser, @Body(new ZodPipe(ValidateIdeaSchema)) b: z.infer<typeof ValidateIdeaSchema>, @Ip() ip: string) { return this.ideas.validate(u, b, ip); }

  @Get() history(@CurrentUser() u: AuthUser, @Query(new ZodPipe(HistoryQuery)) q: z.infer<typeof HistoryQuery>) { return this.ideas.history(u, q.organizationId); }
}
