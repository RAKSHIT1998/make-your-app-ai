import { HostingProviderError, type DeployRequest, type DnsRecord, type HostingProvider, type LogLine, type ProviderDeployment, type ProviderDeploymentState, type ProviderDomain } from './types.js';

type Fetch = typeof fetch;
const API = 'https://api.vercel.com';
const STATE: Record<string, ProviderDeploymentState> = { QUEUED: 'queued', INITIALIZING: 'building', BUILDING: 'building', READY: 'ready', ERROR: 'error', CANCELED: 'canceled' };

export interface VercelConfig { token: string; teamId?: string | undefined }

/** Vercel adapter (REST API). Vercel builds the Next.js project on its side; nothing runs in our API. */
export class VercelHosting implements HostingProvider {
  readonly name = 'vercel';
  constructor(private readonly cfg: VercelConfig, private readonly http: Fetch = fetch) {}

  private async call<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T> {
    const u = new URL(API + path);
    if (this.cfg.teamId) u.searchParams.set('teamId', this.cfg.teamId);
    const res = await this.http(u, { method, headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : {};
    if (!res.ok && !okStatuses.includes(res.status)) {
      const err = (json as { error?: { message?: string; code?: string } }).error;
      throw new HostingProviderError(err?.message ?? `Vercel API error ${res.status}`, res.status, err?.code);
    }
    return json as T;
  }

  async ensureSite(siteName: string, framework: 'nextjs') {
    try {
      const p = await this.call<{ id: string; alias?: { domain: string }[] }>('GET', `/v9/projects/${encodeURIComponent(siteName)}`);
      return { externalProjectId: p.id, productionUrl: p.alias?.[0] ? `https://${p.alias[0].domain}` : null };
    } catch (e) {
      if (!(e instanceof HostingProviderError) || e.status !== 404) throw e;
    }
    const p = await this.call<{ id: string }>('POST', '/v10/projects', { name: siteName, framework });
    return { externalProjectId: p.id, productionUrl: null };
  }

  async deploy(req: DeployRequest): Promise<ProviderDeployment> {
    const files = [...req.files].map(([file, data]) => ({ file, data, encoding: 'utf-8' }));
    const d = await this.call<{ id: string; url?: string; readyState?: string }>('POST', '/v13/deployments?skipAutoDetectionConfirmation=1', {
      name: req.siteName,
      project: req.siteName,
      target: req.target,
      files,
      projectSettings: { framework: req.framework },
      meta: req.meta ?? {},
    });
    return { externalId: d.id, url: d.url ? `https://${d.url}` : null, state: STATE[d.readyState ?? 'QUEUED'] ?? 'queued' };
  }

  async getDeployment(externalId: string): Promise<ProviderDeployment> {
    const d = await this.call<{ id: string; url?: string; readyState?: string; errorMessage?: string; alias?: string[] }>('GET', `/v13/deployments/${encodeURIComponent(externalId)}`);
    return { externalId: d.id, url: d.url ? `https://${d.url}` : null, state: STATE[d.readyState ?? 'QUEUED'] ?? 'queued', errorMessage: d.errorMessage ?? null };
  }

  async logs(externalId: string): Promise<LogLine[]> {
    const ev = await this.call<{ type: string; created: number; text?: string; payload?: { text?: string } }[]>('GET', `/v3/deployments/${encodeURIComponent(externalId)}/events?builds=1&limit=-1`);
    return (Array.isArray(ev) ? ev : []).map((e) => ({ at: new Date(e.created).toISOString(), type: e.type === 'stderr' ? 'stderr' : e.type === 'stdout' ? 'stdout' : 'event', text: (e.text ?? e.payload?.text ?? e.type).slice(0, 2000) }));
  }

  async syncEnv(siteName: string, env: Record<string, string>) {
    const site = encodeURIComponent(siteName);
    const existing = await this.call<{ envs: { id: string; key: string }[] }>('GET', `/v9/projects/${site}/env`);
    for (const e of existing.envs ?? []) if (!(e.key in env)) await this.call('DELETE', `/v9/projects/${site}/env/${e.id}`);
    const entries = Object.entries(env);
    if (entries.length) await this.call('POST', `/v10/projects/${site}/env?upsert=true`, entries.map(([key, value]) => ({ key, value, type: 'encrypted', target: ['production', 'preview'] })));
  }

  private records(hostname: string, verification: { type: string; domain: string; value: string; reason: string }[] = []): DnsRecord[] {
    const apex = hostname.split('.').length === 2;
    const route: DnsRecord = apex ? { type: 'A', name: '@', value: '76.76.21.21', reason: 'Points your domain at the site' } : { type: 'CNAME', name: hostname.split('.')[0]!, value: 'cname.vercel-dns.com', reason: 'Points your subdomain at the site' };
    return [route, ...verification.map((v) => ({ type: v.type as DnsRecord['type'], name: v.domain, value: v.value, reason: 'Proves you own the domain' }))];
  }

  async addDomain(siteName: string, hostname: string): Promise<ProviderDomain> {
    const d = await this.call<{ name: string; verified: boolean; verification?: { type: string; domain: string; value: string; reason: string }[] }>('POST', `/v10/projects/${encodeURIComponent(siteName)}/domains`, { name: hostname });
    return { hostname: d.name, verified: d.verified, configured: false, records: this.records(hostname, d.verification) };
  }

  async checkDomain(siteName: string, hostname: string): Promise<ProviderDomain> {
    const site = encodeURIComponent(siteName);
    let d = await this.call<{ name: string; verified: boolean; verification?: { type: string; domain: string; value: string; reason: string }[] }>('GET', `/v9/projects/${site}/domains/${encodeURIComponent(hostname)}`);
    if (!d.verified) d = await this.call('POST', `/v9/projects/${site}/domains/${encodeURIComponent(hostname)}/verify`, {}, [400]);
    const cfg = await this.call<{ misconfigured?: boolean }>('GET', `/v6/domains/${encodeURIComponent(hostname)}/config`);
    return { hostname, verified: !!d.verified, configured: cfg.misconfigured === false, records: this.records(hostname, d.verified ? [] : d.verification) };
  }

  async removeDomain(siteName: string, hostname: string) {
    await this.call('DELETE', `/v9/projects/${encodeURIComponent(siteName)}/domains/${encodeURIComponent(hostname)}`, undefined, [404]);
  }
}
