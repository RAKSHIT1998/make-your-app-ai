import { Controller, Get, Inject } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OrgsService } from './orgs.service.js';

@Controller()
export class OrgsController {
  constructor(@Inject(OrgsService) private readonly orgs: OrgsService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const memberships = await this.orgs.listForUser(user.id);
    return {
      id: user.id,
      email: user.email,
      platformRole: user.platformRole,
      personalOrgId: user.personalOrgId,
      organizations: memberships.map((m) => ({ ...m.organization, role: m.role })),
    };
  }
}
