import type { AppConfig } from '../config.js';

/** Per-route limits (requests/minute/client), resolved at request time so they follow configuration. */
export const rateLimits = { checkout: 15, generation: 20, deploy: 10, billing: 10, appData: 120, appAuth: 10 };

export function configureRateLimits(c: AppConfig) {
  rateLimits.checkout = c.CHECKOUT_RATE_LIMIT_PER_MINUTE;
  rateLimits.generation = c.GENERATION_RATE_LIMIT_PER_MINUTE;
  rateLimits.deploy = c.DEPLOY_RATE_LIMIT_PER_MINUTE;
  rateLimits.billing = c.BILLING_RATE_LIMIT_PER_MINUTE;
  rateLimits.appData = c.APP_DATA_RATE_LIMIT_PER_MINUTE;
  rateLimits.appAuth = c.APP_AUTH_RATE_LIMIT_PER_MINUTE;
}
