import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@mya/db';
import { PRISMA } from '../prisma.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';

type Tx = Prisma.TransactionClient | PrismaClient;

@Injectable()
export class CreditsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async balance(organizationId: string, tx: Tx = this.prisma): Promise<number> {
    const agg = await tx.creditLedgerEntry.aggregate({ where: { organizationId }, _sum: { amount: true } });
    return agg._sum.amount ?? 0;
  }

  creditsForCost(costMicros: number): number {
    return Math.ceil((costMicros * this.config.CREDITS_PER_USD) / 1_000_000);
  }

  /** Idempotent grant (the idempotency key is unique in the ledger). */
  async grant(organizationId: string, amount: number, reason: 'plan_grant' | 'purchase' | 'adjustment' | 'refund', idempotencyKey: string) {
    await this.prisma.creditLedgerEntry.upsert({
      where: { idempotencyKey },
      update: {},
      create: { organizationId, amount, reason, idempotencyKey },
    });
  }

  async ensureInitialGrant(organizationId: string) {
    if (this.config.FREE_PLAN_CREDITS > 0) await this.grant(organizationId, this.config.FREE_PLAN_CREDITS, 'plan_grant', `initial:${organizationId}`);
  }

  async assertCanSpend(organizationId: string, needed: number) {
    const bal = await this.balance(organizationId);
    if (bal < needed) {
      throw new HttpException({ message: `Not enough credits (balance ${bal}, needed ${needed}).`, balance: bal }, HttpStatus.PAYMENT_REQUIRED);
    }
  }

  /** Debits inside the caller's transaction. Serialised per org with an advisory lock so concurrent debits can't overspend. */
  async debit(tx: Prisma.TransactionClient, organizationId: string, amount: number, idempotencyKey: string, ref: { type: string; id: string }) {
    if (amount <= 0) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
    await tx.creditLedgerEntry.create({
      data: { organizationId, amount: -amount, reason: 'ai_usage', idempotencyKey, referenceType: ref.type, referenceId: ref.id },
    });
  }
}
