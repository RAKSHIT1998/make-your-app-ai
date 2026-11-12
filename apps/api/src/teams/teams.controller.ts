import { Body, Controller, Delete, Get, HttpCode, Inject, Ip, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CreateWorkspaceSchema, InviteSchema, RoleChangeSchema, TeamsService, TokenSchema } from './teams.service.js';
import type { z } from 'zod';

const Uuid = new ParseUUIDPipe();
const Token = new ZodPipe(TokenSchema);

@Controller()
export class TeamsController {
  constructor(@Inject(TeamsService) private readonly t: TeamsService) {}

  @Post('orgs') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(CreateWorkspaceSchema)) b: z.infer<typeof CreateWorkspaceSchema>, @Ip() ip: string) { return this.t.createWorkspace(u, b.name, ip); }
  @Get('orgs/:id/team') overview(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) { return this.t.overview(u, id); }
  @Patch('orgs/:id') rename(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(CreateWorkspaceSchema)) b: z.infer<typeof CreateWorkspaceSchema>, @Ip() ip: string) { return this.t.rename(u, id, b.name, ip); }

  @Get('orgs/:id/members') members(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) { return this.t.members(u, id); }
  @Patch('orgs/:id/members/:userId') role(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Param('userId', Uuid) userId: string, @Body(new ZodPipe(RoleChangeSchema)) b: z.infer<typeof RoleChangeSchema>, @Ip() ip: string) { return this.t.changeRole(u, id, userId, b.role, ip); }
  @Delete('orgs/:id/members/:userId') @HttpCode(204) async remove(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Param('userId', Uuid) userId: string, @Ip() ip: string) { await this.t.removeMember(u, id, userId, ip); }

  @Get('orgs/:id/invitations') invitations(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) { return this.t.invitations(u, id); }
  @Post('orgs/:id/invitations') @Throttle({ default: { limit: 20, ttl: 60_000 } })
  invite(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(InviteSchema)) b: z.infer<typeof InviteSchema>, @Ip() ip: string) { return this.t.invite(u, id, b, ip); }
  @Delete('orgs/:id/invitations/:invitationId') @HttpCode(204) async revoke(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Param('invitationId', Uuid) invitationId: string, @Ip() ip: string) { await this.t.revoke(u, id, invitationId, ip); }

  @Public() @Get('invitations/:token') @Throttle({ default: { limit: 30, ttl: 60_000 } }) preview(@Param('token', Token) token: string) { return this.t.preview(token); }
  @Post('invitations/:token/accept') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  accept(@CurrentUser() u: AuthUser, @Param('token', Token) token: string, @Ip() ip: string) { return this.t.accept(u, token, ip); }
}
