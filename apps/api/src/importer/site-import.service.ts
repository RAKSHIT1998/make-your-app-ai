import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { FlagsService } from '../flags/flags.service.js';
import { PRISMA } from '../prisma.service.js';
import { buildSiteBrief, type CrawledPage } from './site-brief.js';

export const SiteImportSchema = z.object({
  url: z.string().trim().min(4).max(2048),
  maxPages: z.number().int().min(1).max(10).default(6),
  /** The customer confirms the site is theirs (or they may reuse its content). */
  confirmOwnership: z.literal(true, { error: 'Confirm that this is your website or that you have permission to reuse its content.' }),
});
export type SiteImportInput = z.infer<typeof SiteImportSchema>;

/** Public internet only: the same rule the crawler applies, checked here first so bad addresses never leave the API. */
const PRIVATE = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96]] as const) PRIVATE.addSubnet(net, bits, 'ipv6');

function isPrivateIp(ip: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped) return PRIVATE.check(mapped, 'ipv4');
  return PRIVATE.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

const bad = (message: string) => new HttpException({ message, code: 'site_import_bad_url' }, HttpStatus.BAD_REQUEST);

export async function checkPublicUrl(raw: string, allowPrivate = false): Promise<URL> {
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw bad('That doesn’t look like a web address.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw bad('Only http and https addresses can be imported.');
  if (url.username || url.password) throw bad('Addresses with a user name or password can’t be imported.');
  url.hash = '';
  if (allowPrivate) return url;
  if (url.port && url.port !== '80' && url.port !== '443') throw bad('Only standard web addresses (ports 80 and 443) can be imported.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)) throw bad('Private addresses can’t be imported.');
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try { addresses = (await lookup(host, { all: true, verbatim: true })).map((a) => a.address); } catch { throw bad(`${host} could not be found. Check the address.`); }
  }
  if (!addresses.length || addresses.some(isPrivateIp)) throw bad('Private addresses can’t be imported.');
  return url;
}

interface CrawlResponse { url: string; host: string; pages: CrawledPage[]; skipped: { url: string; reason: string }[]; seconds: number }

/**
 * "Start from your current website": reads a customer's own site through the separate crawler service (Crawl4AI,
 * headless Chromium, never in this process) and turns it into a build brief they can edit before building.
 */
@Injectable()
export class SiteImportService {
  private readonly log = new Logger(SiteImportService.name);
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  get available() { return !!(this.config.CRAWLER_URL && this.config.CRAWLER_TOKEN); }

  async status() {
    return { available: this.available && (await this.flags.isEnabled('site_import')), perDay: this.config.SITE_IMPORTS_PER_DAY, maxPages: 10 };
  }

  async import(user: AuthUser, input: SiteImportInput, ip?: string) {
    await this.flags.assert('site_import', 'Website import');
    if (!this.available) throw new HttpException({ message: 'Website import isn’t set up on this server yet.', code: 'site_import_unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
    const url = await checkPublicUrl(input.url, this.config.SITE_IMPORT_ALLOW_PRIVATE_NETWORKS);
    const since = new Date(Date.now() - 24 * 3600_000);
    const used = await this.prisma.auditLog.count({ where: { actorId: user.id, action: 'site.imported', createdAt: { gte: since } } });
    if (used >= this.config.SITE_IMPORTS_PER_DAY) {
      throw new HttpException({ message: `You can import ${this.config.SITE_IMPORTS_PER_DAY} websites a day. Try again tomorrow.`, code: 'site_import_daily_limit' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    let res: Response;
    try {
      res = await fetch(`${this.config.CRAWLER_URL!.replace(/\/$/, '')}/crawl`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-crawler-token': this.config.CRAWLER_TOKEN! },
        body: JSON.stringify({ url: url.toString(), maxPages: input.maxPages }), signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      this.log.warn(`crawler unreachable: ${(e as Error).message}`);
      throw new HttpException({ message: 'The website reader isn’t reachable right now. Please try again in a few minutes.', code: 'site_import_unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    const body = await res.json().catch(() => null) as (CrawlResponse & { detail?: unknown }) | null;
    if (!res.ok || !body?.pages) {
      const detail = typeof body?.detail === 'string' ? body.detail : 'The website couldn’t be read.';
      if (res.status === 401) this.log.error('crawler rejected the API token: check CRAWLER_TOKEN on both services');
      const status = res.status === 400 ? HttpStatus.BAD_REQUEST : res.status === 429 ? HttpStatus.TOO_MANY_REQUESTS : res.status === 504 ? HttpStatus.GATEWAY_TIMEOUT : res.status === 422 ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.BAD_GATEWAY;
      throw new HttpException({ message: status === HttpStatus.BAD_GATEWAY ? 'The website reader had a problem. Please try again.' : detail, code: 'site_import_failed' }, status);
    }

    const pages = body.pages.slice(0, input.maxPages);
    const brief = buildSiteBrief(url.toString(), pages);
    await this.audit.record({ action: 'site.imported', actorId: user.id, organizationId: user.personalOrgId, targetType: 'website', targetId: url.hostname, ip, metadata: { url: url.toString(), pages: pages.length, skipped: body.skipped.length } });
    return {
      url: url.toString(), host: url.hostname,
      pages: pages.map((p) => ({ url: p.url, title: p.title, words: p.markdown.split(/\s+/).filter(Boolean).length })),
      skipped: body.skipped,
      images: pages.flatMap((p) => p.images ?? []).filter((i, n, all) => all.findIndex((x) => x.src === i.src) === n).slice(0, 12),
      brief,
    };
  }
}
