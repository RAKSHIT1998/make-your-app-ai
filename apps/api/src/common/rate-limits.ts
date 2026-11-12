import type { AppConfig } from '../config.js';

/** Per-route limits (requests/minute/client), resolved at request time so they follow configuration. */
export const rateLimits = { checkout: 15, generation: 20 };

export function configureRateLimits(c: AppConfig) {
  rateLimits.checkout = c.CHECKOUT_RATE_LIMIT_PER_MINUTE;
  rateLimits.generation = c.GENERATION_RATE_LIMIT_PER_MINUTE;
}
