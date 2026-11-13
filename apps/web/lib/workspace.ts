/**
 * Active workspace (organization). Module-level so the API client can read it without React.
 * The server re-checks membership on every request; this value only chooses *which* of the
 * caller's workspaces a request is about, never what they may do.
 */
const KEY = 'mya-workspace';
let active: string | null = null;
const listeners = new Set<() => void>();

export function getActiveOrg(): string | null {
  if (active === null && typeof window !== 'undefined') {
    try {
      active = localStorage.getItem(KEY) || '';
    } catch {
      active = '';
    }
  }
  return active || null;
}

export function setActiveOrg(id: string | null) {
  active = id ?? '';
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the choice lasts for this page load only */
  }
  listeners.forEach((l) => l());
}

export function subscribeActiveOrg(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

const GET_ORG_PATHS = /^\/(ideas|activity|generations\/estimate|credits|timeline|hosting\/sites|stores|billing\/overview|billing\/usage|projects)$/;
const POST_ORG_PATHS = /^\/(projects|ideas\/validate|stores|billing\/checkout\/subscription|billing\/checkout\/topup|billing\/subscription\/cancel|templates\/[^/]+\/use|showcase\/[^/]+\/remix)$/;

/** Adds the active workspace to the org-aware requests that don't already name one. */
export function withWorkspace(path: string, init: RequestInit): { path: string; init: RequestInit } {
  const org = getActiveOrg();
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
      /* not JSON: leave as is */
    }
  }
  return { path, init };
}
