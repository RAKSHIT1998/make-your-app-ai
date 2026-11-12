import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@mya/db';
import { PRISMA } from '../prisma.service.js';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  organizationId?: string | null;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Pass `tx` to make the audit row part of the caller's transaction. */
  async record(entry: AuditEntry, tx: Prisma.TransactionClient | PrismaClient = this.prisma) {
    await tx.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        organizationId: entry.organizationId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ip: entry.ip ?? null,
        metadata: entry.metadata ?? {},
      },
    });
  }
}
