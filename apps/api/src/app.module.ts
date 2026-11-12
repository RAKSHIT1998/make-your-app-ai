import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from './config.js';
import { PrismaLifecycle, prismaProvider } from './prisma.service.js';
import { AuditService } from './audit/audit.service.js';
import { TokenVerifier } from './auth/token-verifier.js';
import { AuthService } from './auth/auth.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import { OrgsService } from './orgs/orgs.service.js';
import { OrgsController } from './orgs/orgs.controller.js';
import { ProjectsService } from './projects/projects.service.js';
import { ProjectsController } from './projects/projects.controller.js';
import { HealthController } from './health.controller.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, OrgsController, ProjectsController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        prismaProvider,
        PrismaLifecycle,
        AuditService,
        TokenVerifier,
        AuthService,
        OrgsService,
        ProjectsService,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
