import type { CreateProjectInput, ProjectDto, ProjectType } from '@mya/shared';
import { activeWorkspace } from './prefs';
import { supabase } from './supabase';

const apiBase = (process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://localhost:4000' : '')).replace(/\/$/, '');
/** False in a release build without EXPO_PUBLIC_API_URL; screens show a setup notice instead of calling localhost. */
export const API_CONFIGURED = apiBase.length > 0;
export const API_URL = `${apiBase}/api/v1`;
/** Public website, for legal pages and public project pages. Empty when not configured: those links are hidden. */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? (__DEV__ ? 'http://localhost:3000' : '')).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
  }
}

export type TokenSource = () => Promise<string | null>;
const sessionToken: TokenSource = async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null;
const anonymous: TokenSource = async () => null;

const GET_ORG_PATHS = /^\/(activity|generations\/estimate|credits|timeline|billing\/overview|billing\/usage|billing\/payg|projects)$/;
const POST_ORG_PATHS = /^\/(projects|showcase\/[^/]+\/remix)$/;

/** Adds the active workspace to org-aware requests. It only chooses which of the caller's workspaces; the server decides access. */
function withWorkspace(path: string, init: RequestInit): { path: string; init: RequestInit } {
  const org = activeWorkspace();
  if (!org) return { path, init };
  const [pathname = '', query = ''] = path.split('?');
  const method = (init.method ?? 'GET').toUpperCase();
  if (method === 'GET' && GET_ORG_PATHS.test(pathname)) {
    const sp = new URLSearchParams(query);
    if (!sp.has('organizationId')) sp.set('organizationId', org);
    return { path: `${pathname}?${sp.toString()}`, init };
  }
  if (method === 'POST' && POST_ORG_PATHS.test(pathname) && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (body && typeof body === 'object' && !('organizationId' in body)) return { path, init: { ...init, body: JSON.stringify({ ...body, organizationId: org }) } };
    } catch {
      /* not JSON */
    }
  }
  return { path, init };
}

export async function apiFetch<T>(rawPath: string, rawInit: RequestInit = {}, getToken: TokenSource = sessionToken): Promise<T> {
  if (!API_CONFIGURED) throw new ApiError(0, 'This build is not connected to a server yet.', null);
  const token = await getToken();
  const { path, init } = withWorkspace(rawPath, rawInit);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.", null);
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body as { message?: unknown } | null)?.message;
    throw new ApiError(res.status, typeof msg === 'string' ? msg : Array.isArray(msg) ? String(msg[0]) : `Request failed (${res.status})`, body);
  }
  return body as T;
}
const json = (b: unknown) => ({ body: JSON.stringify(b) });

// ───────── Account and workspaces ─────────
export interface Me {
  id: string; email: string; displayName: string | null; handle: string | null; bio: string; createdAt: string;
  platformRole: 'user' | 'support' | 'admin' | 'superadmin';
  personalOrgId: string;
  organizations: { id: string; name: string; role: string; personal: boolean }[];
}
export interface DeletionPreview { workspaces: { id: string; name: string; personal: boolean }[]; projects: number; subscriptionsToCancel: number; blockers: string[] }

// ───────── Building ─────────
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'canceled';
export interface PlanDraft {
  spec: { name: string; category: string; summary: string; audience: string; pages: { route: string; title: string; purpose: string; sections: string[] }[]; entities: { name: string; fields: string[] }[]; integrations: { name: string; purpose: string; requiresCustomerConfig: boolean }[]; securityNotes: string[] };
  questions: { id: string; question: string; why: string }[];
  assumptions: string[];
}
export interface Run {
  id: string; projectId: string; kind: 'create' | 'edit' | 'repair' | 'plan' | 'ask'; status: RunStatus; prompt: string; error: string | null;
  creditsUsed: number; creditsRefunded?: number; answer?: string | null; createdAt: string; finishedAt: string | null;
  plan?: PlanDraft | { suggestedPrompt: string } | null; fromPlanId?: string | null;
}
export interface RunEvent { id: string; type: string; agent: string | null; message: string; createdAt: string }
export interface Version { id: string; number: number; commitSha: string; message: string; createdAt: string; isHead: boolean }
export interface Approval { id: string; action: string; status: string; summary: string; createdAt: string; expiresAt: string }
export interface ActivityItem extends Run { project: { id: string; name: string; type: string } }
export interface Estimate { balance: number; maxCreditsPerRun: number; typical: { create: { median: number; p90: number; sample: number } | null; edit: { median: number; p90: number; sample: number } | null } }
export interface Achievements { badges: { key: string; title: string; description: string; earnedAt: string | null }[]; streak: { current: number; longest: number; last30: boolean[] } }

export const api = {
  me: () => apiFetch<Me>('/me'),
  updateMe: (b: { displayName?: string | null; handle?: string; bio?: string }) => apiFetch<Me>('/me', { method: 'PATCH', ...json(b) }),
  deletionPreview: () => apiFetch<DeletionPreview>('/me/deletion'),
  deleteAccount: (confirmEmail: string) => apiFetch<{ deleted: boolean; signInRemoved: boolean }>('/me', { method: 'DELETE', ...json({ confirmEmail }) }),
  flags: () => apiFetch<Record<string, boolean>>('/flags', {}, anonymous),
  credits: () => apiFetch<{ balance: number }>('/credits'),
  estimate: () => apiFetch<Estimate>('/generations/estimate'),
  activity: (limit = 8) => apiFetch<ActivityItem[]>(`/activity?limit=${limit}`),
  achievements: () => apiFetch<Achievements>('/me/achievements'),
  projects: () => apiFetch<{ items: ProjectDto[]; nextCursor: string | null }>('/projects?limit=100'),
  project: (id: string) => apiFetch<ProjectDto>(`/projects/${id}`),
  createProject: (input: Omit<CreateProjectInput, 'description'> & { description?: string; type: ProjectType }) => apiFetch<ProjectDto>('/projects', { method: 'POST', ...json(input) }),
  renameProject: (id: string, name: string) => apiFetch<ProjectDto>(`/projects/${id}`, { method: 'PATCH', ...json({ name }) }),
  archiveProject: (id: string) => apiFetch<ProjectDto>(`/projects/${id}`, { method: 'PATCH', ...json({ status: 'archived' }) }),
  restoreProject: (id: string) => apiFetch<ProjectDto>(`/projects/${id}/restore`, { method: 'POST' }),
  deleteProject: (id: string) => apiFetch<void>(`/projects/${id}`, { method: 'DELETE' }),
  generate: (projectId: string, prompt: string, opts: { mode?: 'build' | 'plan' | 'ask'; planRunId?: string; answers?: string } = {}) => apiFetch<Run>(`/projects/${projectId}/generations`, { method: 'POST', ...json({ prompt, ...opts }) }),
  runs: (projectId: string) => apiFetch<Run[]>(`/projects/${projectId}/generations`),
  events: (runId: string, after = '0') => apiFetch<RunEvent[]>(`/generations/${runId}/events?after=${after}`),
  files: (projectId: string) => apiFetch<{ path: string; sizeBytes: number }[]>(`/projects/${projectId}/files`),
  file: (projectId: string, path: string) => apiFetch<{ path: string; content: string | null }>(`/projects/${projectId}/file?path=${encodeURIComponent(path)}`),
  versions: (projectId: string) => apiFetch<Version[]>(`/projects/${projectId}/versions`),
  restore: (projectId: string, versionId: string) => apiFetch<Version[]>(`/projects/${projectId}/versions/${versionId}/restore`, { method: 'POST' }),
  approvals: (projectId: string) => apiFetch<Approval[]>(`/projects/${projectId}/approvals`),
  decide: (approvalId: string, approve: boolean) => apiFetch<{ status: string; error?: string }>(`/approvals/${approvalId}/${approve ? 'approve' : 'reject'}`, { method: 'POST' }),
};

// ───────── Explore and publishing ─────────
export const CATEGORIES = ['business', 'portfolio', 'restaurant', 'ecommerce', 'education', 'health', 'events', 'nonprofit', 'saas', 'personal', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = { business: 'Business', portfolio: 'Portfolio', restaurant: 'Food & drink', ecommerce: 'Shops', education: 'Education', health: 'Health', events: 'Events', nonprofit: 'Non-profit', saas: 'Software', personal: 'Personal', other: 'Other' };
export interface ShowcaseCard {
  slug: string; type: ProjectType; category: Category | null; title: string; description: string; publishedAt: string | null; featured: boolean;
  likes: number; views: number; remixes: number; allowRemix: boolean; pageCount: number; palette: Record<string, string> | null;
  creator: { handle: string | null; name: string | null };
}
export interface ShowcasePage extends ShowcaseCard {
  summary: string | null; audience: string | null; pages: { route: string; title: string; purpose: string }[];
  fileCount: number; versionNumber: number | null; likedByMe: boolean; isOwner: boolean; projectId: string | null; playable: boolean;
}
export interface Publishing {
  visibility: 'private' | 'public'; slug: string | null; publishedAt: string | null; publicTitle: string; publicDescription: string; category: Category | null;
  allowRemix: boolean; commentsEnabled: boolean; showAttribution: boolean; canHideAttribution: boolean; hasVersion: boolean; outdated: boolean; moderated: boolean; moderationNote: string | null; creatorHandle: string | null;
}
export interface ExploreQuery { q?: string; type?: ProjectType; sort?: 'trending' | 'recent' | 'popular' | 'featured'; page?: number; limit?: number }
const qs = (o: object) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
/** Must match the server's report reasons. */
export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or misleading' },
  { value: 'abuse', label: 'Abusive or hateful' },
  { value: 'illegal', label: 'Illegal or dangerous' },
  { value: 'copyright', label: 'Copies someone else’s work' },
  { value: 'impersonation', label: 'Pretends to be someone else' },
  { value: 'other', label: 'Something else' },
] as const;

export const showcase = {
  explore: (q: ExploreQuery) => apiFetch<{ items: ShowcaseCard[]; page: number; hasMore: boolean }>(`/explore${qs(q)}`),
  page: (slug: string) => apiFetch<ShowcasePage>(`/showcase/${slug}`),
  view: (slug: string) => apiFetch<{ counted: boolean }>(`/showcase/${slug}/view`, { method: 'POST' }),
  like: (slug: string, on: boolean) => apiFetch<{ liked: boolean; likes: number }>(`/showcase/${slug}/like`, { method: on ? 'PUT' : 'DELETE' }),
  remix: (slug: string) => apiFetch<ProjectDto>(`/showcase/${slug}/remix`, { method: 'POST', body: '{}' }),
  report: (slug: string, reason: string, details: string) => apiFetch<{ reported: boolean; duplicate: boolean }>(`/showcase/${slug}/report`, { method: 'POST', ...json({ reason, details }) }),
  publishing: (projectId: string) => apiFetch<Publishing>(`/projects/${projectId}/publishing`),
  publish: (projectId: string, b: { visibility: 'private' | 'public'; publicTitle?: string; publicDescription?: string; category?: Category | null; allowRemix?: boolean }) =>
    apiFetch<Publishing>(`/projects/${projectId}/publishing`, { method: 'PUT', ...json(b) }),
};

// ───────── Challenges ─────────
export type ChallengePhase = 'upcoming' | 'open' | 'voting' | 'ended' | 'cancelled' | 'draft';
export interface ChallengeSummary { slug: string; title: string; brief: string; projectTypes: ProjectType[]; prize: string | null; startsAt: string; submissionsCloseAt: string; votingClosesAt: string; votesPerUser: number; phase: ChallengePhase; entries: number }
export interface ChallengeEntry { id: string; rank: number; votes: number; note: string; submittedAt: string; winner: boolean; mine: boolean; votedByMe: boolean; project: ShowcaseCard }
export interface ChallengeDetail extends Omit<ChallengeSummary, 'entries'> { entries: ChallengeEntry[]; myVotesLeft: number | null; myEntry: string | null }
export interface CreatorRank { rank: number; handle: string; name: string; likes: number; remixes: number; podiums: number; score: number }
export const challenges = {
  list: () => apiFetch<{ enabled: boolean; current: ChallengeSummary[]; upcoming: ChallengeSummary[]; past: ChallengeSummary[] }>('/challenges'),
  get: (slug: string) => apiFetch<ChallengeDetail>(`/challenges/${slug}`),
  eligible: (slug: string) => apiFetch<{ id: string; title: string; slug: string | null; type: ProjectType }[]>(`/challenges/${slug}/eligible`),
  enter: (slug: string, projectId: string, note: string) => apiFetch<ChallengeDetail>(`/challenges/${slug}/entries`, { method: 'POST', ...json({ projectId, note }) }),
  withdraw: (slug: string, id: string) => apiFetch<ChallengeDetail>(`/challenges/${slug}/entries/${id}`, { method: 'DELETE' }),
  vote: (slug: string, id: string, on: boolean) => apiFetch<ChallengeDetail>(`/challenges/${slug}/entries/${id}/vote`, { method: on ? 'PUT' : 'DELETE' }),
  creators: () => apiFetch<CreatorRank[]>('/leaderboards/creators'),
};

// ───────── Plan and usage (view only in the app) ─────────
export interface BillingOverview {
  organizationId: string;
  plan: { code: string; name: string; source: string };
  entitlements: { monthlyCredits: number; maxActiveProjects: number; dailyCreditLimit: number | null; maxCreditsPerRun: number; teamSeats: number; featureFlags: string[]; projectTypes: string[] };
  period: { start: string; end: string | null };
  subscription: { status: string; interval: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  credits: { allowanceRemaining: number; purchasedRemaining: number; total: number; usedThisPeriod: number; usedToday: number };
  usage: { activeProjects: number };
  invoices: { id: string; number: string; description: string; currency: string; totalMinor: number; refundedMinor: number; status: string; paidAt: string }[];
}
export interface UsageEntry { id: string; amount: number; reason: string; bucket: 'allowance' | 'purchased' | 'payg'; createdAt: string; detail: string | null }
export interface PaygView { enabled: boolean; status: 'none' | 'pending' | 'active' | 'past_due' | 'disabled'; active: boolean; currency: 'INR' | 'USD' | null; cardLabel: string | null; monthlyCapMinor: number; usedThisMonth: number; capCredits: number; owedMinor: number; premiumAi: boolean; lastError: string | null }
export const billing = {
  overview: () => apiFetch<BillingOverview>('/billing/overview'),
  usage: (limit = 30) => apiFetch<UsageEntry[]>(`/billing/usage?limit=${limit}`),
  payg: () => apiFetch<PaygView>('/billing/payg'),
};

// ───────── Owner ─────────
export interface AdminOverview {
  days: number; users: { total: number; new: number; active: number };
  subscriptions: { active: number; byPlan: Record<string, number>; cancellationsInPeriod: number; paymentProblems: number };
  mrrMinor: Record<string, number>; revenue: { currency: string; grossMinor: number; refundsMinor: number; feesMinor: number; invoices: number }[];
  ai: { costUsd: number; inputTokens: number; outputTokens: number }; generations: Record<string, number>; projects: number;
  grossMarginInr: { netRevenueMinor: number; aiCostMinor: number; marginMinor: number } | null; notes: string[];
}
export interface AdminFlag { key: string; enabled: boolean; description: string; default: boolean; updatedAt: string | null }
export const admin = {
  overview: (days = 30) => apiFetch<AdminOverview>(`/admin/overview?days=${days}`),
  flags: () => apiFetch<AdminFlag[]>('/admin/flags'),
  setFlag: (key: string, enabled: boolean) => apiFetch<unknown>(`/admin/flags/${key}`, { method: 'PATCH', ...json({ enabled }) }),
  audit: () => apiFetch<{ id: string; action: string; actor: string | null; targetType: string | null; createdAt: string }[]>('/admin/audit-log?limit=50'),
};

export const isOwner = (me: Me | undefined) => !!me && ['admin', 'superadmin'].includes(me.platformRole);
