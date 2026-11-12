import type { DeployRequest, HostingProvider, LogLine, ProviderDeployment, ProviderDomain } from './types.js';

/**
 * In-memory provider for tests and local development without a hosting account.
 * Deployments become "ready" after `readyAfterPolls` status checks; it never pretends to be a real host
 * (URLs use the reserved .invalid TLD).
 */
export class FakeHosting implements HostingProvider {
  readonly name = 'fake';
  deployments = new Map<string, { req: DeployRequest; polls: number; fail: boolean }>();
  env = new Map<string, Record<string, string>>();
  domains = new Map<string, { verified: boolean; configured: boolean }>();
  failNext = false;
  constructor(private readonly readyAfterPolls = 1) {}

  async ensureSite(siteName: string) { return { externalProjectId: `prj_${siteName}`, productionUrl: `https://${siteName}.hosting.invalid` }; }
  async deploy(req: DeployRequest): Promise<ProviderDeployment> {
    const id = `dpl_${this.deployments.size + 1}`;
    this.deployments.set(id, { req, polls: 0, fail: this.failNext });
    this.failNext = false;
    return { externalId: id, url: `https://${req.siteName}-${id}.hosting.invalid`, state: 'queued' };
  }
  async getDeployment(id: string): Promise<ProviderDeployment> {
    const d = this.deployments.get(id);
    if (!d) throw new Error('unknown deployment');
    d.polls++;
    const state = d.polls < this.readyAfterPolls ? 'building' : d.fail ? 'error' : 'ready';
    return { externalId: id, url: `https://${d.req.siteName}-${id}.hosting.invalid`, state, errorMessage: state === 'error' ? 'Build failed: Type error in app/page.tsx' : null };
  }
  async logs(id: string): Promise<LogLine[]> {
    const d = this.deployments.get(id);
    return d ? [{ at: new Date().toISOString(), type: 'stdout', text: `Building ${d.req.files.size} files` }, ...(d.fail ? [{ at: new Date().toISOString(), type: 'stderr' as const, text: 'Type error in app/page.tsx' }] : [])] : [];
  }
  async syncEnv(siteName: string, env: Record<string, string>) { this.env.set(siteName, { ...env }); }
  async addDomain(_s: string, hostname: string): Promise<ProviderDomain> {
    this.domains.set(hostname, { verified: false, configured: false });
    return { hostname, verified: false, configured: false, records: [{ type: 'CNAME', name: hostname.split('.')[0]!, value: 'cname.hosting.invalid', reason: 'Points your subdomain at the site' }] };
  }
  async checkDomain(_s: string, hostname: string): Promise<ProviderDomain> {
    const d = this.domains.get(hostname) ?? { verified: false, configured: false };
    return { hostname, ...d, records: d.configured ? [] : [{ type: 'CNAME', name: hostname.split('.')[0]!, value: 'cname.hosting.invalid', reason: 'Points your subdomain at the site' }] };
  }
  async removeDomain(_s: string, hostname: string) { this.domains.delete(hostname); }
}
