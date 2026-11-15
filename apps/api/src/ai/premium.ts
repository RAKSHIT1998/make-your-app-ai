import type { ProviderRouter } from '@mya/ai';

/**
 * Premium AI for pay-as-you-go workspaces: every step that would use the balanced tier uses the deep tier
 * (the strongest models, charged at the deep tier's rate). Fast-tier steps stay fast. If no deep route is
 * configured the router is returned unchanged, so a build never fails because Premium AI is on.
 */
export function premiumRouter(router: ProviderRouter): ProviderRouter {
  if (router.candidates('deep').length === 0) return router;
  return new Proxy(router, {
    get(target, prop) {
      if (prop === 'complete') {
        const complete: ProviderRouter['complete'] = (req, opts) => target.complete(req, opts.tier === 'balanced' ? { ...opts, tier: 'deep' } : opts);
        return complete;
      }
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
