import { Body, Controller, Get, Inject, Ip, Param, ParseUUIDPipe, Put, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AppConfigSchema, AppStudioService, type AppConfig } from './appstudio.service.js';

const Uuid = new ParseUUIDPipe();

@Controller('projects/:id')
export class AppStudioController {
  constructor(@Inject(AppStudioService) private readonly s: AppStudioService) {}
  @Get('app-config') config(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string) { return this.s.config(u, id); }
  @Put('app-config') update(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Body(new ZodPipe(AppConfigSchema)) b: AppConfig, @Ip() ip: string) { return this.s.updateConfig(u, id, b, ip); }
  @Get('export') @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async export(@CurrentUser() u: AuthUser, @Param('id', Uuid) id: string, @Ip() ip: string, @Res() res: Response) {
    const z = await this.s.export(u, id, ip);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${z.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(z.data);
  }
}
