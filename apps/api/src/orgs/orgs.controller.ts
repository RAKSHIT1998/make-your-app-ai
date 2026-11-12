import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { z } from 'zod';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../common/zod.pipe.js';

const UpdateMe = z.object({ displayName: z.string().trim().min(1).max(80).nullable(), avatarUrl: z.url().max(2000).nullable() }).partial();
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OrgsService } from './orgs.service.js';

@Controller()
export class OrgsController {
  constructor(
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const memberships = await this.orgs.listForUser(user.id);
    const profile = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { displayName: true, avatarUrl: true, createdAt: true } });
    return {
      id: user.id,
      email: user.email,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      createdAt: profile.createdAt.toISOString(),
      platformRole: user.platformRole,
      personalOrgId: user.personalOrgId,
      organizations: memberships.map((m) => ({ ...m.organization, role: m.role })),
    };
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(UpdateMe)) body: z.infer<typeof UpdateMe>) {
    await this.prisma.user.update({ where: { id: user.id }, data: body });
    return this.me(user);
  }
}
