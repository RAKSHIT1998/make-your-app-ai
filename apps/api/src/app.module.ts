import { Module, type DynamicModule } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfig } from './config.js';
import { PRISMA, PrismaLifecycle, prismaProvider } from './prisma.service.js';
import { PostgresThrottlerStorage } from './common/postgres-throttler.storage.js';
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
import { BillingService, billingProvidersFactory } from './billing/billing.service.js';
import { BillingController, BillingWebhooksController } from './billing/billing.controllers.js';
import { AdminService } from './admin/admin.service.js';
import { AiRoutingService } from './admin/ai-routing.service.js';
import { AdminController } from './admin/admin.controller.js';
import { CommunityService } from './growth/community.service.js';
import { TeamsService } from './teams/teams.service.js';
import { TeamsController } from './teams/teams.controller.js';
import { IdeasService } from './ideas/ideas.service.js';
import { IdeasController } from './ideas/ideas.controller.js';
import { PlatformAdminGuard } from './auth/platform-admin.guard.js';
import { GatewayRegistry, gatewayFactoryProvider } from './commerce/gateways.js';
import { MerchantService } from './commerce/merchant.service.js';
import { ShippingService, shippingFactoryProvider } from './commerce/shipping.service.js';
import { StorefrontService } from './commerce/storefront.service.js';
import { HostingService, healthCheckProvider, hostingProviderFactory } from './hosting/hosting.service.js';
import { HostingController } from './hosting/hosting.controller.js';
import { TemplatesService } from './templates/templates.service.js';
import { TemplatesController } from './templates/templates.controller.js';
import { AppStudioService } from './appstudio/appstudio.service.js';
import { AppStudioController } from './appstudio/appstudio.controller.js';
import { RetentionService } from './retention/retention.service.js';
import { RetentionController } from './retention/retention.controller.js';
import { FlagsService } from './flags/flags.service.js';
import { FlagsController } from './flags/flags.controller.js';
import { ShowcaseService } from './growth/showcase.service.js';
import { ReferralsService } from './growth/referrals.service.js';
import { ModerationService } from './growth/moderation.service.js';
import { GrowthAdminController, ReferralsController, ShowcaseActionsController, CommunityPublicController, CommunityController, ShowcaseController } from './growth/growth.controllers.js';
import { MerchantController, PaymentWebhooksController, StorefrontController } from './commerce/commerce.controllers.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, overrides: { provide: symbol; useValue: unknown }[] = []): DynamicModule {
    configureRateLimits(config);
    return {
      module: AppModule,
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: config.RATE_LIMIT_PER_MINUTE }])],
      controllers: [HealthController, OrgsController, ProjectsController, CreditsController, GenerationsController, MerchantController, StorefrontController, PaymentWebhooksController, BillingController, BillingWebhooksController, AdminController, ShowcaseController, ShowcaseActionsController, CommunityPublicController, CommunityController, ReferralsController, GrowthAdminController, FlagsController, RetentionController, HostingController, TemplatesController, AppStudioController, TeamsController, IdeasController],
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
        shippingFactoryProvider,
        ShippingService,
        StorefrontService,
        billingProvidersFactory,
        BillingService,
        AdminService,
        AiRoutingService,
        FlagsService,
        RetentionService,
        hostingProviderFactory,
        healthCheckProvider,
        HostingService,
        TemplatesService,
        AppStudioService,
        TeamsService,
        CommunityService,
        IdeasService,
        ShowcaseService,
        ReferralsService,
        ModerationService,
        PlatformAdminGuard,
        ...(config.RATE_LIMIT_STORE === 'postgres' ? [{ provide: ThrottlerStorage, useFactory: (prisma: PrismaClient) => new PostgresThrottlerStorage(prisma), inject: [PRISMA] }] : []),
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        ...overrides,
      ],
    };
  }
}
