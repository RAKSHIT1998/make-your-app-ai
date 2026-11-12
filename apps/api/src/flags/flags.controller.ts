import { Body, Controller, Get, Inject, Param, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PlatformAdminGuard, RequirePlatformRole } from '../auth/platform-admin.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { FLAGS, FlagsService, type FlagKey } from './flags.service.js';

const Key = new ZodPipe(z.enum(Object.keys(FLAGS) as [FlagKey, ...FlagKey[]]));
const Body_ = z.object({ enabled: z.boolean() });

@Controller()
export class FlagsController {
  constructor(@Inject(FlagsService) private readonly f: FlagsService) {}

  /** Public: lets clients hide switched-off features. The server enforces them regardless. */
  @Public() @Get('flags') flags() { return this.f.all(); }

  @Get('admin/flags') @UseGuards(PlatformAdminGuard) @RequirePlatformRole('support') list() { return this.f.list(); }
  @Patch('admin/flags/:key') @UseGuards(PlatformAdminGuard) @RequirePlatformRole('admin')
  set(@CurrentUser() u: AuthUser, @Param('key', Key) key: FlagKey, @Body(new ZodPipe(Body_)) b: z.infer<typeof Body_>) { return this.f.set(u, key, b.enabled); }
}
