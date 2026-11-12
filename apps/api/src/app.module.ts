import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { CreditsService } from './credits/credits.service.js';
import { CreditsController } from './credits/credits.controller.js';
import { GenerationsService } from './generation/generations.service.js';
import { GenerationsController } from './generation/generations.controller.js';
import { aiProviders } from './ai/ai.providers.js';
import { configureRateLimits } from './common/rate-limits.js';
import { GatewayRegistry, gatewayFactoryProvider } from './commerce/gateways.js';
import { MerchantService } from './commerce/merchant.service.js';
import { StorefrontService } from './commerce/storefront.service.js';
import { MerchantController, PaymentWebhooksController, StorefrontController } from './commerce/commerce.controllers.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, overrides: { provide: symbol; useValue: unknown }[] = []): DynamicModule {
    configureRateLimits(config);
    return {
      module: AppModule,
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: config.RATE_LIMIT_PER_MINUTE }])],
      controllers: [HealthController, OrgsController, ProjectsController, CreditsController, GenerationsController, MerchantController, StorefrontController, PaymentWebhooksController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        prismaProvider,
        PrismaLifecycle,
        AuditService,
        TokenVerifier,
        AuthService,
        OrgsService,
        ProjectsService,
        CreditsService,
        GenerationsService,
        ...aiProviders,
        gatewayFactoryProvider,
        GatewayRegistry,
        MerchantService,
        StorefrontService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        ...overrides,
      ],
    };
  }
}
