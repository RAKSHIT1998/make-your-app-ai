import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@mya/db';
import { APP_CONFIG, type AppConfig } from './config.js';

export const PRISMA = Symbol('PRISMA');

@Injectable()
export class PrismaLifecycle implements OnModuleDestroy {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}

export const prismaProvider = {
  provide: PRISMA,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => createPrismaClient(config.DATABASE_URL),
};
