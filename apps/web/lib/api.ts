import type { CreateProjectInput, ProjectDto, ProjectType } from '@mya/shared';
import { supabase } from './supabase';

export const API_URL = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1`;

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
  }
}

export type TokenSource = () => Promise<string | null>;

const sessionToken: TokenSource = async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null;

export async function apiFetch<T>(path: string, init: RequestInit = {}, getToken: TokenSource = sessionToken): Promise<T> {
  const token = await getToken();
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
  platformRole: 'user' | 'support' | 'admin' | 'superadmin';
  personalOrgId: string;
  organizations: { id: string; name: string; role: string; personal: boolean }[];
}
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'canceled';
export interface Run { id: string; projectId: string; kind: 'create' | 'edit' | 'repair'; status: RunStatus; prompt: string; error: string | null; creditsUsed: number; createdAt: string; finishedAt: string | null }
export interface RunEvent { id: string; type: string; agent: string | null; message: string; data?: Record<string, unknown>; createdAt: string }
export interface Version { id: string; number: number; commitSha: string; message: string; createdAt: string; isHead: boolean }
export interface Approval { id: string; action: string; status: string; summary: string; createdAt: string; expiresAt: string }

export interface ActivityItem extends Run { project: { id: string; name: string; type: string } }
export interface Estimate { balance: number; maxCreditsPerRun: number; typical: { create: { median: number; p90: number; sample: number } | null; edit: { median: number; p90: number; sample: number } | null } }
export interface UsageEntry { id: string; amount: number; reason: string; bucket: 'allowance' | 'purchased'; createdAt: string; detail: string | null }

export const api = {
  activity: (limit = 12) => apiFetch<ActivityItem[]>(`/activity?limit=${limit}`),
  estimate: () => apiFetch<Estimate>('/generations/estimate'),
  updateMe: (b: { displayName?: string | null }) => apiFetch<Me>('/me', { method: 'PATCH', body: JSON.stringify(b) }),
  archiveProject: (id: string) => apiFetch<ProjectDto>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) }),
  renameProject: (id: string, name: string) => apiFetch<ProjectDto>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  me: () => apiFetch<Me>('/me'),
  credits: () => apiFetch<{ balance: number }>('/credits'),
  projects: () => apiFetch<{ items: ProjectDto[]; nextCursor: string | null }>('/projects?limit=50'),
  project: (id: string) => apiFetch<ProjectDto>(`/projects/${id}`),
  createProject: (input: Omit<CreateProjectInput, 'description'> & { description?: string; type: ProjectType }) => apiFetch<ProjectDto>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  deleteProject: (id: string) => apiFetch<void>(`/projects/${id}`, { method: 'DELETE' }),
  generate: (projectId: string, prompt: string) => apiFetch<Run>(`/projects/${projectId}/generations`, { method: 'POST', body: JSON.stringify({ prompt }) }),
  runs: (projectId: string) => apiFetch<Run[]>(`/projects/${projectId}/generations`),
  events: (runId: string, after = '0') => apiFetch<RunEvent[]>(`/generations/${runId}/events?after=${after}`),
  files: (projectId: string) => apiFetch<{ path: string; sizeBytes: number }[]>(`/projects/${projectId}/files`),
  file: (projectId: string, path: string) => apiFetch<{ path: string; content: string | null }>(`/projects/${projectId}/file?path=${encodeURIComponent(path)}`),
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
  users: (q = '') => apiFetch<AdminUser[]>(`/admin/users?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  setStatus: (id: string, suspend: boolean, reason: string) => apiFetch<unknown>(`/admin/users/${id}/${suspend ? 'suspend' : 'restore'}`, { method: 'POST', body: JSON.stringify({ reason }) }),
  credits: (orgId: string, amount: number, reason: string) => apiFetch<unknown>(`/admin/organizations/${orgId}/credits`, { method: 'POST', body: JSON.stringify({ amount, reason, bucket: 'purchased', idempotencyKey: crypto.randomUUID() }) }),
  audit: () => apiFetch<{ id: string; action: string; actor: string | null; targetType: string | null; createdAt: string }[]>('/admin/audit-log?limit=50'),
};
