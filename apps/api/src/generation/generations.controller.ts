import { Body, Controller, Get, HttpCode, Inject, Ip, MessageEvent, Param, ParseUUIDPipe, Post, Query, Sse } from '@nestjs/common';
import { StartGenerationSchema, type StartGenerationInput } from '@mya/shared';
import { Throttle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { rateLimits } from '../common/rate-limits.js';
import { GenerationsService } from './generations.service.js';

const EventsQuery = z.object({ after: z.string().regex(/^\d+$/).default('0') });
const FileQuery = z.object({ path: z.string().min(1).max(300) });
const ActivityQuery = z.object({ organizationId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(15) });
const OrgQ = z.object({ organizationId: z.uuid().optional() });
const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'awaiting_approval']);

@Controller()
export class GenerationsController {
  constructor(@Inject(GenerationsService) private readonly gen: GenerationsService) {}

  @Post('projects/:id/generations')
  @HttpCode(202)
  @Throttle({ default: { limit: () => rateLimits.generation, ttl: 60_000 } })
  start(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(StartGenerationSchema)) body: StartGenerationInput, @Ip() ip: string) {
    return this.gen.start(user, id, body, ip);
  }

  @Get('projects/:id/generations')
  list(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.gen.listRuns(user, id);
  }

  @Get('activity')
  activity(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ActivityQuery)) q: z.infer<typeof ActivityQuery>) {
    return this.gen.activity(user, q.organizationId, q.limit);
  }

  @Get('generations/estimate')
  estimate(@CurrentUser() user: AuthUser, @Query(new ZodPipe(OrgQ)) q: z.infer<typeof OrgQ>) {
    return this.gen.estimate(user, q.organizationId);
  }

  @Get('generations/:runId')
  get(@CurrentUser() user: AuthUser, @Param('runId', new ParseUUIDPipe()) runId: string) {
    return this.gen.getRun(user, runId);
  }

  @Get('generations/:runId/events')
  events(@CurrentUser() user: AuthUser, @Param('runId', new ParseUUIDPipe()) runId: string, @Query(new ZodPipe(EventsQuery)) q: z.infer<typeof EventsQuery>) {
    return this.gen.events(user, runId, BigInt(q.after));
  }

  /** Server-sent events: streams AgentEvents until the run reaches a terminal state. */
  @Sse('generations/:runId/stream')
  stream(@CurrentUser() user: AuthUser, @Param('runId', new ParseUUIDPipe()) runId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((sub) => {
      let after = 0n;
      let stopped = false;
      const tick = async () => {
        try {
          for (const e of await this.gen.events(user, runId, after)) {
            after = BigInt(e.id);
            sub.next({ id: e.id, type: 'agent-event', data: e });
          }
          const run = await this.gen.getRun(user, runId);
          if (TERMINAL.has(run.status)) {
            sub.next({ type: 'run', data: run });
            sub.complete();
            return;
          }
        } catch (err) {
          sub.error(err);
          return;
        }
        if (!stopped) setTimeout(tick, 1000);
      };
      void tick();
      return () => {
        stopped = true;
      };
    });
  }

  @Get('projects/:id/files')
  files(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.gen.listFiles(user, id);
  }

  @Get('projects/:id/file')
  file(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Query(new ZodPipe(FileQuery)) q: z.infer<typeof FileQuery>) {
    return this.gen.fileContent(user, id, q.path);
  }

  @Get('projects/:id/versions')
  versions(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.gen.listVersions(user, id);
  }

  @Post('projects/:id/versions/:versionId/restore')
  restore(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Param('versionId', new ParseUUIDPipe()) versionId: string, @Ip() ip: string) {
    return this.gen.restoreVersion(user, id, versionId, ip);
  }

  @Get('projects/:id/approvals')
  approvals(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.gen.listApprovals(user, id);
  }

  @Post('approvals/:approvalId/approve')
  approve(@CurrentUser() user: AuthUser, @Param('approvalId', new ParseUUIDPipe()) approvalId: string, @Ip() ip: string) {
    return this.gen.decide(user, approvalId, true, ip);
  }

  @Post('approvals/:approvalId/reject')
  reject(@CurrentUser() user: AuthUser, @Param('approvalId', new ParseUUIDPipe()) approvalId: string, @Ip() ip: string) {
    return this.gen.decide(user, approvalId, false, ip);
  }
}
