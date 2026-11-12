import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { CreditsService } from './credits.service.js';

const Q = z.object({ organizationId: z.uuid().optional() });

@Controller('credits')
export class CreditsController {
  constructor(
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(OrgsService) private readonly orgs: OrgsService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser, @Query(new ZodPipe(Q)) q: z.infer<typeof Q>) {
    const organizationId = q.organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, organizationId, 'viewer');
    return { organizationId, balance: await this.credits.balance(organizationId) };
  }
}
