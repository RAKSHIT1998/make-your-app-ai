import { Body, Controller, Get, HttpCode, Inject, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { SiteImportSchema, SiteImportService, type SiteImportInput } from './site-import.service.js';

@Controller('imports/site')
export class SiteImportController {
  constructor(@Inject(SiteImportService) private readonly s: SiteImportService) {}

  @Get() status() { return this.s.status(); }

  @Post() @HttpCode(200) @Throttle({ default: { limit: 20, ttl: 60_000 } })
  run(@CurrentUser() u: AuthUser, @Body(new ZodPipe(SiteImportSchema)) b: SiteImportInput, @Ip() ip: string) { return this.s.import(u, b, ip); }
}
