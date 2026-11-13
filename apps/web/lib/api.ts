import type { CreateProjectInput, ProjectDto, ProjectType } from '@mya/shared';
import { supabase } from './supabase';
import { withWorkspace } from './workspace';

export const API_URL = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1`;

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
  }
}

export type TokenSource = () => Promise<string | null>;

const sessionToken: TokenSource = async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null;

export async function apiFetch<T>(rawPath: string, rawInit: RequestInit = {}, getToken: TokenSource = sessionToken): Promise<T> {
  const token = await getToken();
  const { path, init } = withWorkspace(rawPath, rawInit);
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body as { message?: unknown } | null)?.message;
    throw new ApiError(res.status, typeof msg === 'string' ? msg : `Request failed (${res.status})`, body);
  }
  return body as T;
}

export interface Me {
  id: string;
  email: string;
  displayName: string | null;
  handle: string | null;
  bio: string;
  platformRole: 'user' | 'support' | 'admin' | 'superadmin';
  personalOrgId: string;
  organizations: { id: string; name: string; role: string; personal: boolean }[];
}
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'canceled';
export interface PlanDraft {
  spec: { name: string; category: string; summary: string; audience: string; pages: { route: string; title: string; purpose: string; sections: string[] }[]; entities: { name: string; fields: string[] }[]; integrations: { name: string; purpose: string; requiresCustomerConfig: boolean }[]; securityNotes: string[] };
  questions: { id: string; question: string; why: string }[];
  assumptions: string[];
}
export interface Run { id: string; projectId: string; kind: 'create' | 'edit' | 'repair' | 'plan'; status: RunStatus; prompt: string; error: string | null; creditsUsed: number; createdAt: string; finishedAt: string | null; plan?: PlanDraft | null; fromPlanId?: string | null }
export interface RunEvent { id: string; type: string; agent: string | null; message: string; data?: Record<string, unknown>; createdAt: string }
export interface Version { id: string; number: number; commitSha: string; message: string; createdAt: string; isHead: boolean }
export interface Approval { id: string; action: string; status: string; summary: string; createdAt: string; expiresAt: string }

export interface ActivityItem extends Run { project: { id: string; name: string; type: string } }
export interface Estimate { balance: number; maxCreditsPerRun: number; typical: { create: { median: number; p90: number; sample: number } | null; edit: { median: number; p90: number; sample: number } | null } }
export interface UsageEntry { id: string; amount: number; reason: string; bucket: 'allowance' | 'purchased'; createdAt: string; detail: string | null }

export const api = {
  activity: (limit = 12) => apiFetch<ActivityItem[]>(`/activity?limit=${limit}`),
  estimate: () => apiFetch<Estimate>('/generations/estimate'),
  updateMe: (b: { displayName?: string | null; handle?: string; bio?: string }) => apiFetch<Me>('/me', { method: 'PATCH', body: JSON.stringify(b) }),
  restoreProject: (id: string) => apiFetch<ProjectDto>(`/projects/${id}/restore`, { method: 'POST' }),
  archiveProject: (id: string) => apiFetch<ProjectDto>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) }),
  renameProject: (id: string, name: string) => apiFetch<ProjectDto>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  me: () => apiFetch<Me>('/me'),
  credits: () => apiFetch<{ balance: number }>('/credits'),
  projects: () => apiFetch<{ items: ProjectDto[]; nextCursor: string | null }>('/projects?limit=50'),
  project: (id: string) => apiFetch<ProjectDto>(`/projects/${id}`),
  createProject: (input: Omit<CreateProjectInput, 'description'> & { description?: string; type: ProjectType }) => apiFetch<ProjectDto>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  deleteProject: (id: string) => apiFetch<void>(`/projects/${id}`, { method: 'DELETE' }),
  generate: (projectId: string, prompt: string, opts: { mode?: 'build' | 'plan'; planRunId?: string; answers?: string } = {}) => apiFetch<Run>(`/projects/${projectId}/generations`, { method: 'POST', body: JSON.stringify({ prompt, ...opts }) }),
  runs: (projectId: string) => apiFetch<Run[]>(`/projects/${projectId}/generations`),
  events: (runId: string, after = '0') => apiFetch<RunEvent[]>(`/generations/${runId}/events?after=${after}`),
  files: (projectId: string) => apiFetch<{ path: string; sizeBytes: number }[]>(`/projects/${projectId}/files`),
  file: (projectId: string, path: string) => apiFetch<{ path: string; content: string | null }>(`/projects/${projectId}/file?path=${encodeURIComponent(path)}`),
  preview: (projectId: string) => apiFetch<{ html: string; warnings: string[] }>(`/projects/${projectId}/preview`),
  versions: (projectId: string) => apiFetch<Version[]>(`/projects/${projectId}/versions`),
  restore: (projectId: string, versionId: string) => apiFetch<Version[]>(`/projects/${projectId}/versions/${versionId}/restore`, { method: 'POST' }),
  approvals: (projectId: string) => apiFetch<Approval[]>(`/projects/${projectId}/approvals`),
  decide: (approvalId: string, approve: boolean) => apiFetch<{ status: string; error?: string }>(`/approvals/${approvalId}/${approve ? 'approve' : 'reject'}`, { method: 'POST' }),
};

// ───────── Commerce ─────────
export interface Store { id: string; name: string; slug: string; currency: string; status: 'draft' | 'active' | 'paused'; taxRateBps: number; pricesIncludeTax: boolean; paymentProvider: 'razorpay' | 'stripe' | null; createdAt: string; payments?: { provider: string | null; status: string; webhookUrl: string | null; lastTestedAt: string | null } }
export interface Variant { id: string; title: string; sku: string | null; priceMinor: number; inventory: { onHand: number; reserved: number; tracked: boolean; lowStockThreshold: number } | null }
export interface Product { id: string; title: string; handle: string; status: 'draft' | 'active' | 'archived'; digital: boolean; variants: Variant[] }
export interface OrderItem { id: string; productTitle: string; variantTitle: string; quantity: number; unitPriceMinor: number; totalMinor: number }
export interface Order { id: string; number: number; email: string; status: string; fulfillmentStatus: string; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number; refundedMinor: number; trackingNumber: string | null; createdAt: string; items: OrderItem[]; refunds?: { id: string; amountMinor: number; status: string; reason: string; createdAt: string }[] }
export interface Analytics { currency: string; days: number; grossSalesMinor: number; refundsMinor: number; netSalesMinor: number; orders: number; averageOrderValueMinor: number; pendingPaymentOrders: number; topProducts: { productTitle: string; units: number; revenueMinor: number }[]; lowStock: { variantId: string; productTitle: string; variantTitle: string; available: number }[] }
export interface Shipping { id: string; name: string; rateMinor: number; freeOverMinor: number | null; active: boolean }
export interface Discount { id: string; code: string; type: string; value: number; usageCount: number; usageLimit: number | null; active: boolean }

const j = (b: unknown) => ({ body: JSON.stringify(b) });
export const commerce = {
  stores: () => apiFetch<Store[]>('/stores'),
  createStore: (b: { name: string; currency: string; taxRateBps: number; pricesIncludeTax: boolean }) => apiFetch<Store>('/stores', { method: 'POST', ...j(b) }),
  store: (id: string) => apiFetch<Store>(`/stores/${id}`),
  updateStore: (id: string, b: Partial<Pick<Store, 'status' | 'name' | 'taxRateBps' | 'pricesIncludeTax'>>) => apiFetch<Store>(`/stores/${id}`, { method: 'PATCH', ...j(b) }),
  connectPayments: (id: string, b: Record<string, string>) => apiFetch<Store['payments']>(`/stores/${id}/payments`, { method: 'PUT', ...j(b) }),
  analytics: (id: string, days = 30) => apiFetch<Analytics>(`/stores/${id}/analytics?days=${days}`),
  products: (id: string) => apiFetch<Product[]>(`/stores/${id}/products`),
  createProduct: (id: string, b: unknown) => apiFetch<Product>(`/stores/${id}/products`, { method: 'POST', ...j(b) }),
  updateProduct: (id: string, pid: string, b: unknown) => apiFetch<Product>(`/stores/${id}/products/${pid}`, { method: 'PATCH', ...j(b) }),
  setStock: (id: string, vid: string, set: number, lowStockThreshold?: number) => apiFetch<unknown>(`/stores/${id}/variants/${vid}/inventory`, { method: 'POST', ...j({ set, ...(lowStockThreshold !== undefined ? { lowStockThreshold } : {}) }) }),
  deleteProduct: (id: string, pid: string) => apiFetch<void>(`/stores/${id}/products/${pid}`, { method: 'DELETE' }),
  orders: (id: string, status?: string) => apiFetch<{ items: Order[] }>(`/stores/${id}/orders?limit=100${status ? `&status=${status}` : ''}`),
  customers: (id: string, q = '') => apiFetch<{ id: string; email: string; name: string | null; createdAt: string; orders: number; spentMinor: number; lastOrderAt: string | null }[]>(`/stores/${id}/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  setDiscountActive: (id: string, did: string, active: boolean) => apiFetch<void>(`/stores/${id}/discounts/${did}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  order: (id: string, oid: string) => apiFetch<Order>(`/stores/${id}/orders/${oid}`),
  fulfill: (id: string, oid: string, trackingNumber?: string) => apiFetch<Order>(`/stores/${id}/orders/${oid}/fulfill`, { method: 'POST', ...j({ trackingNumber }) }),
  refund: (id: string, oid: string, b: { amountMinor: number; reason: string; restock: boolean; idempotencyKey: string }) => apiFetch<unknown>(`/stores/${id}/orders/${oid}/refunds`, { method: 'POST', ...j(b) }),
  shipping: (id: string) => apiFetch<Shipping[]>(`/stores/${id}/shipping`),
  createShipping: (id: string, b: unknown) => apiFetch<Shipping>(`/stores/${id}/shipping`, { method: 'POST', ...j(b) }),
  discounts: (id: string) => apiFetch<Discount[]>(`/stores/${id}/discounts`),
  createDiscount: (id: string, b: unknown) => apiFetch<Discount>(`/stores/${id}/discounts`, { method: 'POST', ...j(b) }),
};

export function money(minor: number, currency: string) {
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency }).format(minor / 100);
}

// ───────── Billing ─────────
export interface PlanPrice { id: string; interval: 'monthly' | 'yearly'; currency: string; amountMinor: number }
export interface PublicPlan { id: string; code: string; name: string; description: string; monthlyCredits: number; maxActiveProjects: number; teamSeats: number; dailyCreditLimit: number | null; monthlyBuildCredits: number; featureFlags: string[]; projectTypes: string[]; prices: PlanPrice[] }
export interface Catalogue { plans: PublicPlan[]; creditPacks: { id: string; name: string; credits: number; priceMinor: number; currency: string }[]; providers: { razorpay: boolean; stripe: boolean } }
export interface BillingOverview {
  organizationId: string;
  plan: { code: string; name: string; source: string };
  entitlements: { monthlyCredits: number; maxActiveProjects: number; dailyCreditLimit: number | null; maxCreditsPerRun: number; teamSeats: number; featureFlags: string[]; projectTypes: string[] };
  period: { start: string; end: string | null };
  subscription: { id: string; status: string; provider: string; interval: string | null; amountMinor: number | null; currency: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  credits: { allowanceRemaining: number; purchasedRemaining: number; total: number; usedThisPeriod: number; usedToday: number };
  usage: { activeProjects: number };
  invoices: { id: string; number: string; description: string; currency: string; totalMinor: number; refundedMinor: number; status: string; paidAt: string }[];
}
export type CheckoutParams = { checkoutId: string; provider: 'razorpay' | 'stripe'; keyId?: string; subscriptionId?: string; orderId?: string; amount?: number; currency?: string; description?: string; email?: string; checkoutUrl?: string };

export const billing = {
  catalogue: () => apiFetch<Catalogue>('/billing/plans', {}, async () => null),
  overview: () => apiFetch<BillingOverview>('/billing/overview'),
  subscribe: (planPriceId: string) => apiFetch<CheckoutParams>('/billing/checkout/subscription', { method: 'POST', body: JSON.stringify({ planPriceId }) }),
  topup: (creditPackId: string) => apiFetch<CheckoutParams>('/billing/checkout/topup', { method: 'POST', body: JSON.stringify({ creditPackId }) }),
  checkout: (id: string) => apiFetch<{ id: string; kind: string; status: 'created' | 'completed' | 'expired' | 'failed' }>(`/billing/checkouts/${id}`),
  usage: (limit = 50) => apiFetch<UsageEntry[]>(`/billing/usage?limit=${limit}`),
  cancel: () => apiFetch<{ cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null }>('/billing/subscription/cancel', { method: 'POST', body: '{}' }),
};

// ───────── Owner admin ─────────
export interface AdminOverview { days: number; users: { total: number; new: number; active: number }; subscriptions: { active: number; byPlan: Record<string, number>; cancellationsInPeriod: number; paymentProblems: number }; mrrMinor: Record<string, number>; arrMinor: Record<string, number>; revenue: { currency: string; grossMinor: number; refundsMinor: number; feesMinor: number; invoices: number }[]; ai: { costUsd: number; inputTokens: number; outputTokens: number }; generations: Record<string, number>; projects: number; grossMarginInr: { netRevenueMinor: number; aiCostMinor: number; marginMinor: number } | null; notes: string[] }
export interface AdminPlan { id: string; code: string; name: string; description: string; includedCredits: number; maxProjects: number; maxSeats: number; dailyCreditLimit: number | null; maxCreditsPerRun: number; monthlyBuildCredits: number; active: boolean; public: boolean; projectTypes: string[]; featureFlags: string[]; prices: (PlanPrice & { active: boolean; stripePriceId: string | null; razorpayPlanId: string | null })[]; activeSubscriptions: number }
export interface AdminUser { id: string; email: string; displayName: string | null; status: string; platformRole: string; createdAt: string; organizationId: string | null; plan: string; subscriptionStatus: string | null; projects: number; aiCostUsd: number; revenue: { currency: string; netMinor: number }[] }

export const admin = {
  overview: (days = 30) => apiFetch<AdminOverview>(`/admin/overview?days=${days}`),
  plans: () => apiFetch<AdminPlan[]>('/admin/plans'),
  updatePlan: (id: string, b: Partial<AdminPlan>) => apiFetch<AdminPlan>(`/admin/plans/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  updatePrice: (id: string, b: { active?: boolean; stripePriceId?: string | null }) => apiFetch<unknown>(`/admin/prices/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  users: (q = '') => apiFetch<AdminUser[]>(`/admin/users?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  setStatus: (id: string, suspend: boolean, reason: string) => apiFetch<unknown>(`/admin/users/${id}/${suspend ? 'suspend' : 'restore'}`, { method: 'POST', body: JSON.stringify({ reason }) }),
  credits: (orgId: string, amount: number, reason: string) => apiFetch<unknown>(`/admin/organizations/${orgId}/credits`, { method: 'POST', body: JSON.stringify({ amount, reason, bucket: 'purchased', idempotencyKey: crypto.randomUUID() }) }),
  audit: () => apiFetch<{ id: string; action: string; actor: string | null; targetType: string | null; createdAt: string }[]>('/admin/audit-log?limit=50'),
  aiRouting: () => apiFetch<AiRouting>('/admin/ai/routing'),
  saveRoute: (b: AiRouteInput) => apiFetch<AiRouting>('/admin/ai/routes', { method: 'PUT', body: JSON.stringify(b) }),
  deleteRoute: (id: string) => apiFetch<AiRouting>(`/admin/ai/routes/${id}`, { method: 'DELETE' }),
  setTierRate: (tier: AiTier, b: { inputCostPerMTokMicros: number; outputCostPerMTokMicros: number }) => apiFetch<AiRouting>(`/admin/ai/tier-rates/${tier}`, { method: 'PUT', body: JSON.stringify(b) }),
};

export type AiTier = 'fast' | 'balanced' | 'deep';
export interface AiRouteInput { provider: string; model: string; tier: AiTier; priority: number; enabled: boolean; inputCostPerMTokMicros: number; outputCostPerMTokMicros: number; quality: number; dailyRequestLimit: number | null; dailyTokenLimit: number | null }
export interface AiRoute extends AiRouteInput { id: string; providerConfigured: boolean; circuitOpenUntil: string | null; validity: number; requests24h: number; successes24h: number; requestsToday: number; tokensToday: number; costUsd24h: number; revenueUsd24h: number; marginUsd24h: number }
export interface AiRouting { strategy: 'margin' | 'priority'; creditsPerUsd: number; providers: { name: string; configured: boolean }[]; tierRates: { tier: AiTier; inputCostPerMTokMicros: number; outputCostPerMTokMicros: number }[]; routes: AiRoute[]; totals: { costUsd24h: number; revenueUsd24h: number; marginUsd24h: number } }

// ───────── Growth: showcase, remix, referrals ─────────

export const CATEGORIES = ['business', 'portfolio', 'restaurant', 'ecommerce', 'education', 'health', 'events', 'nonprofit', 'saas', 'personal', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = { business: 'Business', portfolio: 'Portfolio', restaurant: 'Food & drink', ecommerce: 'Shops', education: 'Education', health: 'Health', events: 'Events', nonprofit: 'Non-profit', saas: 'Software', personal: 'Personal', other: 'Other' };

export interface ShowcaseCard {
  slug: string; type: ProjectType; category: Category | null; title: string; description: string; publishedAt: string | null; featured: boolean;
  likes: number; views: number; remixes: number; allowRemix: boolean; pageCount: number; palette: Record<string, string> | null;
  creator: { handle: string | null; name: string | null };
}
export interface ShowcasePage extends ShowcaseCard {
  showAttribution: boolean; summary: string | null; audience: string | null; pages: { route: string; title: string; purpose: string }[];
  fileCount: number; versionNumber: number | null; likedByMe: boolean; isOwner: boolean; projectId: string | null;
  remixedFrom: ShowcaseCard | { private: true } | null; remixList: ShowcaseCard[]; preview: null;
}
export interface Creator { handle: string; name: string; bio: string; joinedAt: string; isMe: boolean; followers: number; following: number; followedByMe: boolean; totals: { projects: number; likes: number; remixes: number }; projects: ShowcaseCard[] }
export interface Publishing {
  visibility: 'private' | 'public'; slug: string | null; publishedAt: string | null; publicTitle: string; publicDescription: string; category: Category | null;
  allowRemix: boolean; commentsEnabled: boolean; showAttribution: boolean; canHideAttribution: boolean; hasVersion: boolean; outdated: boolean; moderated: boolean; moderationNote: string | null; creatorHandle: string | null;
}
export interface ExploreQuery { q?: string; type?: ProjectType; category?: Category; sort?: 'trending' | 'recent' | 'popular' | 'featured'; page?: number; limit?: number }
export interface ReferralDashboard {
  code: string; enabled: boolean; rewards: { referrer: number; referred: number; maxPerMonth: number };
  stats: { invited: number; converted: number; creditsEarned: number };
  referrals: { id: string; who: string; name: string | null; status: 'pending' | 'rewarded' | 'rejected'; rejectReason: string | null; credits: number; joinedAt: string; qualifiedAt: string | null }[];
  referredBy: { name: string; status: string; credits: number } | null;
}
const qs = (o: object) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== null) p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ''; };

export const showcase = {
  explore: (q: ExploreQuery) => apiFetch<{ items: ShowcaseCard[]; page: number; hasMore: boolean }>(`/explore${qs(q)}`),
  page: (slug: string) => apiFetch<ShowcasePage>(`/showcase/${slug}`),
  view: (slug: string) => apiFetch<{ counted: boolean }>(`/showcase/${slug}/view`, { method: 'POST' }),
  like: (slug: string, on: boolean) => apiFetch<{ liked: boolean; likes: number }>(`/showcase/${slug}/like`, { method: on ? 'PUT' : 'DELETE' }),
  remix: (slug: string) => apiFetch<ProjectDto>(`/showcase/${slug}/remix`, { method: 'POST', body: '{}' }),
  report: (slug: string, reason: string, details: string) => apiFetch<{ reported: boolean; duplicate: boolean }>(`/showcase/${slug}/report`, { method: 'POST', body: JSON.stringify({ reason, details }) }),
  creator: (handle: string) => apiFetch<Creator>(`/creators/${handle}`),
  publishing: (projectId: string) => apiFetch<Publishing>(`/projects/${projectId}/publishing`),
  publish: (projectId: string, b: Partial<Omit<Publishing, 'visibility'>> & { visibility: 'private' | 'public' }) =>
    apiFetch<Publishing>(`/projects/${projectId}/publishing`, { method: 'PUT', body: JSON.stringify({ visibility: b.visibility, publicTitle: b.publicTitle, publicDescription: b.publicDescription, category: b.category, allowRemix: b.allowRemix, showAttribution: b.showAttribution }) }),
};

export const referrals = {
  dashboard: () => apiFetch<ReferralDashboard>('/referrals'),
  claim: (code: string) => apiFetch<{ linked: boolean }>('/referrals/claim', { method: 'POST', body: JSON.stringify({ code }) }),
};

export interface GrowthSettings { referralsEnabled: boolean; referrerRewardCredits: number; referredRewardCredits: number; maxRewardsPerMonth: number; claimWindowDays: number }
export interface AdminShowcase {
  reports: { id: string; reason: string; details: string; createdAt: string; reporter: string; project: { id: string; slug: string | null; title: string; hidden: boolean; creator: string } }[];
  published: { id: string; slug: string | null; title: string; featured: boolean; hidden: boolean; note: string | null; likes: number; views: number; remixes: number; publishedAt: string | null; creator: string }[];
}
export const growthAdmin = {
  referrals: () => apiFetch<{ settings: GrowthSettings; counts: Record<string, number>; recent: { id: string; referrer: string; referred: string; status: string; rejectReason: string | null; createdAt: string; qualifiedAt: string | null; credits: number }[] }>('/admin/growth/referrals'),
  updateSettings: (b: Partial<GrowthSettings>) => apiFetch<GrowthSettings>('/admin/growth/settings', { method: 'PATCH', body: JSON.stringify(b) }),
  showcase: () => apiFetch<AdminShowcase>('/admin/growth/showcase'),
  feature: (id: string, featured: boolean) => apiFetch<unknown>(`/admin/growth/projects/${id}/feature`, { method: 'POST', body: JSON.stringify({ featured }) }),
  hide: (id: string, note: string) => apiFetch<unknown>(`/admin/growth/projects/${id}/hide`, { method: 'POST', body: JSON.stringify({ note }) }),
  restore: (id: string) => apiFetch<unknown>(`/admin/growth/projects/${id}/restore`, { method: 'POST' }),
  dismiss: (id: string) => apiFetch<unknown>(`/admin/growth/reports/${id}/dismiss`, { method: 'POST' }),
};

/** Server-side fetch for public pages (metadata, OG images). No auth, short cache. */
export async function publicGet<T>(path: string): Promise<T | null> {
  const base = `${process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1`;
  try {
    const r = await fetch(`${base}${path}`, { next: { revalidate: 60 } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

// ───────── Platform flags, retention ─────────

export type FlagKey = 'ai_generation' | 'plan_first_builder' | 'voice_input' | 'publishing' | 'explore' | 'remix' | 'referrals' | 'hosting' | 'templates' | 'team_workspaces' | 'comments';
export const flags = {
  all: () => apiFetch<Record<FlagKey, boolean>>('/flags', {}, async () => null),
  admin: () => apiFetch<{ key: FlagKey; enabled: boolean; description: string; default: boolean; updatedAt: string | null }[]>('/admin/flags'),
  set: (key: FlagKey, enabled: boolean) => apiFetch<unknown>(`/admin/flags/${key}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
};

export interface Achievements {
  badges: { key: string; title: string; description: string; earnedAt: string | null }[];
  streak: { current: number; longest: number; last30: boolean[] };
}
export interface TimelineItem { id: string; action: string; label: string; at: string; actor: string | null; project: { id: string; name: string } | null; detail: { prompt: string; status: RunStatus } | null }
export const retention = {
  achievements: () => apiFetch<Achievements>('/me/achievements'),
  timeline: (projectId?: string, limit = 20) => apiFetch<TimelineItem[]>(`/timeline?limit=${limit}${projectId ? `&projectId=${projectId}` : ''}`),
};

// ───────── Cloud Studio (hosting) ─────────

export type DeploymentStatus = 'queued' | 'building' | 'deployed_unverified' | 'live' | 'failed' | 'rolled_back';
export interface Deployment { id: string; status: DeploymentStatus; kind: 'deploy' | 'rollback'; url: string | null; versionNumber: number; error: string | null; createdAt: string; readyAt: string | null; current: boolean; health: { ok: boolean; status: number | null; error: string | null } | null }
export interface DnsRecord { type: string; name: string; value: string; reason: string }
export interface HostedDomain { hostname: string; status: 'pending_verification' | 'verified' | 'active' | 'error'; sslStatus: string; records: DnsRecord[] }
export interface HostingStatus {
  configured: boolean; provider: string | null; entitlements: { canDeploy: boolean; canUseCustomDomains: boolean }; headVersion: number | null;
  site: { productionUrl: string | null; siteName: string; liveDeploymentId: string | null } | null;
  deployments: Deployment[]; env: { key: string; updatedAt: string; public: boolean }[]; domains: HostedDomain[];
}
export interface HostingSites { configured: boolean; provider: string | null; entitlements: { canDeploy: boolean; canUseCustomDomains: boolean }; sites: { projectId: string; name: string; type: ProjectType; hasVersion: boolean; productionUrl: string | null; lastDeployment: Deployment | null }[] }
export const hostingApi = {
  sites: () => apiFetch<HostingSites>('/hosting/sites'),
  status: (projectId: string) => apiFetch<HostingStatus>(`/projects/${projectId}/hosting`),
  deploy: (projectId: string) => apiFetch<Deployment>(`/projects/${projectId}/deployments`, { method: 'POST' }),
  rollback: (projectId: string, deploymentId: string) => apiFetch<Deployment>(`/projects/${projectId}/deployments/${deploymentId}/rollback`, { method: 'POST' }),
  logs: (projectId: string, deploymentId: string) => apiFetch<{ at: string; type: 'stdout' | 'stderr' | 'event'; text: string }[]>(`/projects/${projectId}/deployments/${deploymentId}/logs`),
  setEnv: (projectId: string, key: string, value: string) => apiFetch<unknown>(`/projects/${projectId}/env`, { method: 'PUT', body: JSON.stringify({ key, value }) }),
  deleteEnv: (projectId: string, key: string) => apiFetch<void>(`/projects/${projectId}/env/${key}`, { method: 'DELETE' }),
  addDomain: (projectId: string, hostname: string) => apiFetch<HostedDomain>(`/projects/${projectId}/domains`, { method: 'POST', body: JSON.stringify({ hostname }) }),
  checkDomain: (projectId: string, hostname: string) => apiFetch<HostedDomain>(`/projects/${projectId}/domains/${hostname}/check`, { method: 'POST' }),
  removeDomain: (projectId: string, hostname: string) => apiFetch<void>(`/projects/${projectId}/domains/${hostname}`, { method: 'DELETE' }),
};

// ───────── Templates ─────────

export interface TemplateCard {
  slug: string; title: string; description: string; category: Category | null; type: ProjectType; uses: number; featured: boolean; free: boolean;
  pageCount: number; palette: Record<string, string> | null; pages: { route: string; title: string; purpose: string }[]; fileCount: number; summary: string | null;
  creator: { handle: string | null; name: string | null };
}
export interface MyTemplate { status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; slug: string; title: string; reviewNote: string | null; uses: number; submittedAt: string }
export interface TemplateReview extends TemplateCard { id: string; status: MyTemplate['status']; reviewNote: string | null; projectSlug: string | null; submittedAt: string }
export const templatesApi = {
  list: (q: { q?: string; type?: ProjectType; category?: Category; sort?: 'popular' | 'new' | 'featured' }) => apiFetch<TemplateCard[]>(`/templates${qs(q)}`),
  use: (slug: string, name?: string) => apiFetch<ProjectDto>(`/templates/${slug}/use`, { method: 'POST', body: JSON.stringify(name ? { name } : {}) }),
  mine: (projectId: string) => apiFetch<MyTemplate | null>(`/projects/${projectId}/template`),
  submit: (projectId: string, b: { title?: string; description?: string }) => apiFetch<MyTemplate>(`/projects/${projectId}/template`, { method: 'PUT', body: JSON.stringify(b) }),
  withdraw: (projectId: string) => apiFetch<MyTemplate>(`/projects/${projectId}/template`, { method: 'DELETE' }),
  queue: (status?: 'pending' | 'approved' | 'rejected') => apiFetch<TemplateReview[]>(`/admin/templates${status ? `?status=${status}` : ''}`),
  review: (id: string, decision: 'approve' | 'reject' | 'feature' | 'unfeature', note?: string) => apiFetch<unknown>(`/admin/templates/${id}/review`, { method: 'POST', body: JSON.stringify({ decision, ...(note ? { note } : {}) }) }),
};

// ───────── App Studio ─────────

export interface AppConfig { name: string; slug: string; version: string; iosBundleId: string; androidPackage: string; primaryColor: string; splashColor: string; privacyPolicyUrl: string }
export interface AppStudioState {
  generated: boolean; version?: number; config: AppConfig | null;
  checklist: { key: string; label: string; done: boolean; detail: string; blocked?: boolean; manual?: boolean }[];
  builds: { available: boolean; reason: string };
}
export const appStudio = {
  config: (projectId: string) => apiFetch<AppStudioState>(`/projects/${projectId}/app-config`),
  update: (projectId: string, c: AppConfig) => apiFetch<AppStudioState>(`/projects/${projectId}/app-config`, { method: 'PUT', body: JSON.stringify(c) }),
};

/** Downloads the project's current version as a ZIP (authenticated). */
export async function downloadSource(projectId: string) {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  const res = await fetch(`${API_URL}/projects/${projectId}/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { message?: string } | null;
    throw new ApiError(res.status, body?.message ?? `Download failed (${res.status})`, body);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'project.zip';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}


// ───────── Team workspaces ─────────
export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';
export interface TeamOverview { id: string; name: string; personal: boolean; role: OrgRole; seats: { used: number; pending: number; limit: number }; canInvite: boolean; canCreateWorkspace: boolean }
export interface TeamMember { userId: string; email: string; displayName: string | null; role: OrgRole; joinedAt: string; you: boolean }
export interface TeamInvitation { id: string; email: string; role: OrgRole; expiresAt: string; expired?: boolean; createdAt?: string }
export interface InvitationPreview { organizationName: string; role: OrgRole; emailHint: string; expiresAt: string }
const noAuth: TokenSource = async () => null;
export const team = {
  create: (name: string) => apiFetch<{ id: string; name: string }>('/orgs', { method: 'POST', body: JSON.stringify({ name }) }),
  overview: (orgId: string) => apiFetch<TeamOverview>(`/orgs/${orgId}/team`),
  rename: (orgId: string, name: string) => apiFetch<unknown>(`/orgs/${orgId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  members: (orgId: string) => apiFetch<TeamMember[]>(`/orgs/${orgId}/members`),
  setRole: (orgId: string, userId: string, role: OrgRole) => apiFetch<unknown>(`/orgs/${orgId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  remove: (orgId: string, userId: string) => apiFetch<void>(`/orgs/${orgId}/members/${userId}`, { method: 'DELETE' }),
  invitations: (orgId: string) => apiFetch<TeamInvitation[]>(`/orgs/${orgId}/invitations`),
  invite: (orgId: string, email: string, role: OrgRole) => apiFetch<TeamInvitation & { link: string }>(`/orgs/${orgId}/invitations`, { method: 'POST', body: JSON.stringify({ email, role }) }),
  revoke: (orgId: string, invitationId: string) => apiFetch<void>(`/orgs/${orgId}/invitations/${invitationId}`, { method: 'DELETE' }),
  preview: (token: string) => apiFetch<InvitationPreview>(`/invitations/${encodeURIComponent(token)}`, {}, noAuth),
  accept: (token: string) => apiFetch<{ organizationId: string; name: string; role: OrgRole }>(`/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', body: '{}' }),
};

// ───────── Project health & idea validation ─────────
export type AuditSeverity = 'pass' | 'warn' | 'fail';
export interface AuditCheck { id: string; category: 'seo' | 'accessibility' | 'performance' | 'security' | 'mobile'; severity: AuditSeverity; title: string; detail: string; files: string[]; fix?: string }
export interface HealthReport { kind: 'web' | 'mobile' | 'unknown'; score: number; filesScanned: number; checks: AuditCheck[]; summary: Record<AuditSeverity, number>; checkedAt: string }
export interface IdeaReport {
  oneLiner: string; verdict: 'promising' | 'needs_focus' | 'risky'; verdictReason: string; targetUsers: string[]; problem: string; strengths: string[]; risks: string[];
  alternativesToResearch: string[]; mvpFeatures: string[]; monetization: string[]; firstWeekSteps: string[]; recommendedType: string; buildPrompt: string;
}
export interface IdeaValidation { id: string; idea: string; report: IdeaReport; creditsCharged: number; createdAt: string; disclaimer: string }
export const insights = {
  health: (projectId: string) => apiFetch<HealthReport>(`/projects/${projectId}/health`),
  validateIdea: (idea: string) => apiFetch<IdeaValidation>('/ideas/validate', { method: 'POST', body: JSON.stringify({ idea }) }),
  ideas: () => apiFetch<IdeaValidation[]>('/ideas'),
};


// ───────── Community: comments, follows, collections ─────────
export interface Comment { id: string; parentId: string | null; body: string; createdAt: string; author: { handle: string | null; name: string }; byCreator: boolean; mine: boolean; canRemove: boolean }
export interface CollectionSummary { id: string; name: string; description: string; isPublic: boolean; count: number; has?: boolean }
export interface CollectionView { id: string; name: string; description: string; isPublic: boolean; mine: boolean; owner: { handle: string | null; name: string }; items: ShowcaseCard[] }
export interface AdminComment { id: string; body: string; status: 'visible' | 'hidden'; createdAt: string; author: string; project: { slug: string | null; title: string }; reports: string[] }
export const community = {
  comments: (slug: string) => apiFetch<{ enabled: boolean; items: Comment[] }>(`/showcase/${slug}/comments`),
  addComment: (slug: string, body: string, parentId?: string) => apiFetch<Comment>(`/showcase/${slug}/comments`, { method: 'POST', body: JSON.stringify({ body, ...(parentId ? { parentId } : {}) }) }),
  removeComment: (id: string) => apiFetch<void>(`/comments/${id}`, { method: 'DELETE' }),
  reportComment: (id: string, reason: string) => apiFetch<{ reported: boolean; duplicate: boolean }>(`/comments/${id}/report`, { method: 'POST', body: JSON.stringify({ reason }) }),
  follow: (handle: string, on: boolean) => apiFetch<{ following: boolean; followers: number }>(`/creators/${handle}/follow`, { method: on ? 'PUT' : 'DELETE' }),
  feed: (page: number) => apiFetch<{ items: ShowcaseCard[]; page: number; hasMore: boolean; followingCount: number }>(`/feed/following?page=${page}`),
  collections: (slug?: string) => apiFetch<CollectionSummary[]>(`/collections${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`),
  createCollection: (name: string, isPublic = false, description = '') => apiFetch<CollectionSummary>('/collections', { method: 'POST', body: JSON.stringify({ name, isPublic, description }) }),
  updateCollection: (id: string, patch: Partial<{ name: string; description: string; isPublic: boolean }>) => apiFetch<unknown>(`/collections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteCollection: (id: string) => apiFetch<void>(`/collections/${id}`, { method: 'DELETE' }),
  setItem: (id: string, slug: string, on: boolean) => apiFetch<{ in: boolean }>(`/collections/${id}/items/${slug}`, { method: on ? 'PUT' : 'DELETE' }),
  collection: (id: string) => apiFetch<CollectionView>(`/collections/${id}`),
  adminComments: () => apiFetch<AdminComment[]>('/admin/growth/comments'),
  moderateComment: (id: string, action: 'remove' | 'restore') => apiFetch<unknown>(`/admin/growth/comments/${id}/moderate`, { method: 'POST', body: JSON.stringify({ action }) }),
};
