import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { Public } from './auth/decorators.js';
import { PRISMA } from './prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Liveness: the process is up (no dependencies). */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Readiness: the API can serve traffic (database reachable). Deploys count as healthy only when this returns 200. */
  @Public()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', db: 'down' });
    }
    return { status: 'ok', db: 'ok' };
  }
}
