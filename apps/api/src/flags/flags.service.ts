import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { PRISMA } from '../prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';

/** Every platform switch the code checks. Unknown keys can't be created from the console. */
export const FLAGS = {
  ai_generation: { default: true, description: 'AI generation and edits (global kill switch).' },
  plan_first_builder: { default: true, description: 'Plan-first mode: review an AI plan and answer questions before code is written.' },
  voice_input: { default: true, description: 'Voice input for prompts and edit requests (browser speech recognition).' },
  publishing: { default: true, description: 'Publishing projects to public pages.' },
  explore: { default: true, description: 'The public Explore gallery.' },
  remix: { default: true, description: 'Remix with AI on public projects.' },
  templates: { default: true, description: 'Template gallery, submissions and starting projects from templates.' },
  team_workspaces: { default: true, description: 'Team workspaces: create shared workspaces and invite teammates.' },
  hosting: { default: true, description: 'Deployments, custom domains and environment variables (Cloud Studio).' },
  comments: { default: true, description: 'Comments on public project pages.' },
  app_backends: { default: true, description: 'Built-in backends of generated full-stack apps (data, end-user accounts). Off: those apps cannot load or save data.' },
  refund_failed_builds: { default: true, description: 'Failed-build guarantee: return the credits of AI runs that fail without delivering anything (daily cap per workspace).' },
  referrals: { default: true, description: 'Linking invite codes to new accounts. Reward amounts live in Growth settings.' },
} as const;
export type FlagKey = keyof typeof FLAGS;

@Injectable()
export class FlagsService {
  private cache: { at: number; values: Record<FlagKey, boolean> } | null = null;
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async all(): Promise<Record<FlagKey, boolean>> {
    if (this.cache && Date.now() - this.cache.at < 5_000) return this.cache.values;
    const rows = await this.prisma.platformFlag.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
    const values = Object.fromEntries((Object.keys(FLAGS) as FlagKey[]).map((k) => [k, byKey.get(k) ?? FLAGS[k].default])) as Record<FlagKey, boolean>;
    this.cache = { at: Date.now(), values };
    return values;
  }

  async isEnabled(key: FlagKey) {
    return (await this.all())[key];
  }

  /** Throws a clear 503 when an owner has switched a feature off. */
  async assert(key: FlagKey, what: string) {
    if (!(await this.isEnabled(key))) throw new ServiceUnavailableException({ message: `${what} is temporarily turned off. Please try again later.`, code: 'feature_disabled', flag: key });
  }

  async list() {
    const values = await this.all();
    const rows = await this.prisma.platformFlag.findMany();
    return (Object.keys(FLAGS) as FlagKey[]).map((k) => ({ key: k, enabled: values[k], description: FLAGS[k].description, default: FLAGS[k].default, updatedAt: rows.find((r) => r.key === k)?.updatedAt.toISOString() ?? null }));
  }

  async set(actor: AuthUser, key: FlagKey, enabled: boolean) {
    await this.prisma.platformFlag.upsert({ where: { key }, update: { enabled, updatedBy: actor.id }, create: { key, enabled, description: FLAGS[key].description, updatedBy: actor.id } });
    this.cache = null;
    await this.audit.record({ action: 'admin.flag_changed', actorId: actor.id, targetType: 'platform_flag', targetId: key, metadata: { enabled } });
    return this.list();
  }
}
