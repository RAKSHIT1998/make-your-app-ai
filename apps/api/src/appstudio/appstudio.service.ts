import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient, Project } from '@mya/db';
import { z } from 'zod';
import { PRISMA } from '../prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { GenerationsService } from '../generation/generations.service.js';
import { SECRET_FILE } from '../growth/showcase.service.js';
import { zipFiles } from '../common/zip.js';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0F4C5C.');
const reverseDns = z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9_]*){2,}$/, 'Use reverse-domain format like com.yourcompany.app.').max(155);
export const AppConfigSchema = z.object({
  name: z.string().trim().min(1).max(30),
  slug: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, 'Lowercase letters, numbers and hyphens.'),
  version: z.string().trim().regex(/^\d+\.\d+\.\d+$/, 'Use semantic versioning like 1.0.0.'),
  iosBundleId: reverseDns,
  androidPackage: reverseDns.refine((p) => !p.includes('-'), 'Android packages can’t contain hyphens.'),
  primaryColor: hex,
  splashColor: hex,
  privacyPolicyUrl: z.url().max(500).or(z.literal('')),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

interface ExpoJson { expo: Record<string, unknown> & { name?: string; slug?: string; version?: string; splash?: { backgroundColor?: string }; ios?: { bundleIdentifier?: string; buildNumber?: string }; android?: { package?: string; versionCode?: number; adaptiveIcon?: { backgroundColor?: string } }; icon?: string; extra?: Record<string, unknown>; primaryColor?: string } }

@Injectable()
export class AppStudioService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(GenerationsService) private readonly generations: GenerationsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async headTree(p: Project) {
    if (!p.headVersionId) return null;
    const v = await this.prisma.projectVersion.findUniqueOrThrow({ where: { id: p.headVersionId } });
    return { version: v, tree: await this.generations.readVersionTree(p.id, v.commitSha) };
  }

  private parse(tree: Map<string, string>): ExpoJson {
    try {
      const j = JSON.parse(tree.get('app.json') ?? '') as ExpoJson;
      if (!j.expo) throw new Error('no expo key');
      return j;
    } catch {
      throw new BadRequestException('app.json is missing or invalid in this project.');
    }
  }

  async config(user: AuthUser, projectId: string) {
    const p = await this.projects.getAuthorized(user, projectId, 'viewer');
    if (p.type !== 'mobile_app') throw new BadRequestException('App settings are for mobile app projects.');
    const head = await this.headTree(p);
    if (!head) return { generated: false, config: null, checklist: [], builds: { available: false, reason: 'eas_not_connected' } };
    const e = this.parse(head.tree).expo;
    const config = {
      name: e.name ?? '', slug: e.slug ?? '', version: e.version ?? '1.0.0',
      iosBundleId: e.ios?.bundleIdentifier ?? '', androidPackage: e.android?.package ?? '',
      primaryColor: e.primaryColor ?? '#111111', splashColor: e.splash?.backgroundColor ?? '#ffffff',
      privacyPolicyUrl: String((e.extra as { privacyPolicyUrl?: string } | undefined)?.privacyPolicyUrl ?? ''),
    };
    const placeholder = (id: string) => !id || id.startsWith('com.example.');
    const checklist = [
      { key: 'name', label: 'App name set', done: !!config.name && config.name !== 'My App', detail: 'Shown under the icon on phones (max 30 characters).' },
      { key: 'ids', label: 'Bundle identifiers set', done: !placeholder(config.iosBundleId) && !placeholder(config.androidPackage), detail: 'Permanent once published — use a domain you control, e.g. com.yourcompany.app.' },
      { key: 'version', label: 'Version number', done: /^\d+\.\d+\.\d+$/.test(config.version), detail: 'Increase it for every store release.' },
      { key: 'privacy', label: 'Privacy policy URL', done: !!config.privacyPolicyUrl, detail: 'Required by both Apple and Google for most apps.' },
      { key: 'icon', label: 'App icon (1024×1024 PNG)', done: typeof e.icon === 'string', detail: 'Icon upload needs file storage, which isn’t connected yet. Expo uses a default icon until then.', blocked: true },
      { key: 'accounts', label: 'Your Apple and Google developer accounts', done: false, detail: 'Builds and store submissions use your own accounts (Apple Developer Program, Google Play Console). You submit; we never publish on your behalf.', manual: true },
    ];
    return { generated: true, version: head.version.number, config, checklist, builds: { available: false, reason: 'eas_not_connected' } };
  }

  /** Writes app.json directly (no AI) and saves it as a new version. Identifiers are only changed here. */
  async updateConfig(user: AuthUser, projectId: string, input: AppConfig, ip: string | null) {
    const p = await this.projects.getAuthorized(user, projectId, 'member');
    if (p.type !== 'mobile_app') throw new BadRequestException('App settings are for mobile app projects.');
    if (await this.prisma.generationRun.findFirst({ where: { projectId, status: { in: ['queued', 'running'] } } })) throw new BadRequestException('Wait for the AI to finish before changing app settings.');
    const head = await this.headTree(p);
    if (!head) throw new BadRequestException('Generate the app before changing its settings.');
    const json = this.parse(head.tree);
    const e = json.expo;
    const versionChanged = e.version !== input.version;
    Object.assign(e, { name: input.name, slug: input.slug, version: input.version, primaryColor: input.primaryColor });
    e.splash = { ...(e.splash ?? {}), backgroundColor: input.splashColor };
    e.ios = { ...(e.ios ?? {}), bundleIdentifier: input.iosBundleId, ...(versionChanged ? { buildNumber: String(Number(e.ios?.buildNumber ?? '0') + 1) } : {}) };
    e.android = { ...(e.android ?? {}), package: input.androidPackage, adaptiveIcon: { ...(e.android?.adaptiveIcon ?? {}), backgroundColor: input.splashColor }, ...(versionChanged ? { versionCode: (e.android?.versionCode ?? 0) + 1 } : {}) };
    e.extra = { ...(e.extra ?? {}), ...(input.privacyPolicyUrl ? { privacyPolicyUrl: input.privacyPolicyUrl } : {}) };
    if (!input.privacyPolicyUrl && e.extra) delete (e.extra as Record<string, unknown>).privacyPolicyUrl;
    head.tree.set('app.json', `${JSON.stringify(json, null, 2)}\n`);
    const fresh = await this.prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    await this.generations.importTree(fresh, head.tree, 'Updated app settings in App Studio');
    await this.audit.record({ action: 'appstudio.config_updated', actorId: user.id, organizationId: p.organizationId, targetType: 'project', targetId: p.id, ip, metadata: { version: input.version } });
    return this.config(user, projectId);
  }

  /** The current version as a ZIP — customers own their code and can build with their own tools (e.g. `eas build`). */
  async export(user: AuthUser, projectId: string, ip: string | null) {
    const p = await this.projects.getAuthorized(user, projectId, 'member');
    const head = await this.headTree(p);
    if (!head) throw new NotFoundException('Nothing to download yet — generate the project first.');
    for (const path of [...head.tree.keys()]) if (SECRET_FILE.test(path)) head.tree.delete(path);
    const root = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
    await this.audit.record({ action: 'project.exported', actorId: user.id, organizationId: p.organizationId, targetType: 'project', targetId: p.id, ip, metadata: { version: head.version.number } });
    return { filename: `${root}-v${head.version.number}.zip`, data: zipFiles(head.tree, root) };
  }
}
