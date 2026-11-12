import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, Store } from '@mya/db';
import { defaultGatewayFactory, type GatewayCredentials, type GatewayFactory, type PaymentGateway } from '@mya/payments';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PRISMA } from '../prisma.service.js';
import { decryptJson, encryptJson } from '../common/crypto.js';

export const GATEWAY_FACTORY = Symbol('GATEWAY_FACTORY');
export const gatewayFactoryProvider = { provide: GATEWAY_FACTORY, useValue: defaultGatewayFactory };

/** Loads a store's payment gateway from the org's encrypted Integration credentials. Secrets never leave this class. */
@Injectable()
export class GatewayRegistry {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GATEWAY_FACTORY) private readonly factory: GatewayFactory,
  ) {}

  private key(): string {
    if (!this.config.ENCRYPTION_KEY) throw new HttpException({ message: 'Payment setup required: the server has no ENCRYPTION_KEY configured.', setupRequired: true }, HttpStatus.SERVICE_UNAVAILABLE);
    return this.config.ENCRYPTION_KEY;
  }

  build(creds: GatewayCredentials): PaymentGateway {
    return this.factory(creds);
  }

  async save(organizationId: string, creds: GatewayCredentials, test: { ok: boolean; error?: string }) {
    const encrypted = encryptJson(this.key(), creds);
    await this.prisma.integration.upsert({
      where: { organizationId_provider: { organizationId, provider: creds.provider } },
      update: { encryptedCreds: encrypted, status: 'connected', lastTestedAt: new Date(), lastTestResult: test },
      create: { organizationId, provider: creds.provider, status: 'connected', scopes: ['payments'], encryptedCreds: encrypted, lastTestedAt: new Date(), lastTestResult: test },
    });
  }

  async forStore(store: Pick<Store, 'organizationId' | 'paymentProvider'>): Promise<PaymentGateway | null> {
    if (!store.paymentProvider) return null;
    const integ = await this.prisma.integration.findUnique({ where: { organizationId_provider: { organizationId: store.organizationId, provider: store.paymentProvider } } });
    if (!integ?.encryptedCreds || integ.status !== 'connected') return null;
    return this.factory(decryptJson<GatewayCredentials>(this.key(), integ.encryptedCreds));
  }

  async status(store: Pick<Store, 'id' | 'organizationId' | 'paymentProvider'>) {
    if (!store.paymentProvider) return { provider: null, status: 'not_configured' as const, webhookUrl: null, lastTestedAt: null };
    const integ = await this.prisma.integration.findUnique({ where: { organizationId_provider: { organizationId: store.organizationId, provider: store.paymentProvider } } });
    return {
      provider: store.paymentProvider,
      status: (integ?.status ?? 'not_configured') as string,
      lastTestedAt: integ?.lastTestedAt?.toISOString() ?? null,
      webhookUrl: `${this.config.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/webhooks/payments/${store.paymentProvider}/${store.id}`,
    };
  }
}
