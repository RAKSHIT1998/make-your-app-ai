/**
 * Hosting provider adapter. The API talks only to this interface, so the provider
 * (Vercel today; Cloudflare, Render, Netlify later) can change without touching the app.
 * Implementations run with PLATFORM credentials, server-side only.
 */
export type ProviderDeploymentState = 'queued' | 'building' | 'ready' | 'error' | 'canceled';

export interface DeployRequest {
  /** Stable provider-side site name, e.g. "mya-grand-lake-3f2a". */
  siteName: string;
  /** Complete project files (path → UTF-8 content). */
  files: Map<string, string>;
  framework: 'nextjs';
  target: 'production' | 'preview';
  /** Opaque labels stored with the deployment (project/version ids). */
  meta?: Record<string, string>;
}

export interface ProviderDeployment {
  externalId: string;
  url: string | null;
  state: ProviderDeploymentState;
  errorMessage?: string | null;
}

export interface DnsRecord { type: 'A' | 'CNAME' | 'TXT'; name: string; value: string; reason: string }

export interface ProviderDomain {
  hostname: string;
  /** Ownership verified with the provider. */
  verified: boolean;
  /** DNS points at the provider (traffic reaches the site; SSL can be issued). */
  configured: boolean;
  /** Records the customer must add at their DNS host. */
  records: DnsRecord[];
}

export interface LogLine { at: string; type: 'stdout' | 'stderr' | 'event'; text: string }

export interface HostingProvider {
  readonly name: string;
  ensureSite(siteName: string, framework: 'nextjs'): Promise<{ externalProjectId: string; productionUrl: string | null }>;
  deploy(req: DeployRequest): Promise<ProviderDeployment>;
  getDeployment(externalId: string): Promise<ProviderDeployment>;
  logs(externalId: string): Promise<LogLine[]>;
  /** Replaces the site's environment variables with exactly this set (encrypted at the provider). */
  syncEnv(siteName: string, env: Record<string, string>): Promise<void>;
  addDomain(siteName: string, hostname: string): Promise<ProviderDomain>;
  checkDomain(siteName: string, hostname: string): Promise<ProviderDomain>;
  removeDomain(siteName: string, hostname: string): Promise<void>;
}

export class HostingProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
  }
}
