import type { BillingInterval } from '@mya/db';

/**
 * Initial plan catalogue from the founder spec (v3 Part 12). Prices are the spec's proposals; credit allowances are
 * conservative proposals sized so AI cost stays well under price (see docs/BUSINESS_MODEL.md). Seeded once, then
 * owned by the admin console — editing this file does not change existing plans.
 * Yearly prices are proposals (10× monthly ≈ two months free).
 */
export const DEFAULT_PLANS = (freeCredits: number) => [
  {
    code: 'free', name: 'Free', sortOrder: 0, description: 'Try Make Your App AI with one project.',
    includedCredits: freeCredits, maxProjects: 1, maxSeats: 1, dailyCreditLimit: 60, maxCreditsPerRun: 80, monthlyBuildCredits: 0,
    featureFlags: ['website_generation', 'preview'], projectTypes: ['website', 'business_website'],
    prices: [] as { interval: BillingInterval; currency: string; amountMinor: number }[],
  },
  {
    code: 'creator', name: 'Creator', sortOrder: 1, description: 'For creators launching websites.',
    includedCredits: 480, maxProjects: 3, maxSeats: 1, dailyCreditLimit: 200, maxCreditsPerRun: 150, monthlyBuildCredits: 0,
    featureFlags: ['website_generation', 'preview', 'hosting_basic'], projectTypes: ['website', 'business_website', 'ecommerce'],
    prices: [
      { interval: 'monthly' as BillingInterval, currency: 'INR', amountMinor: 99_900 },
      { interval: 'yearly' as BillingInterval, currency: 'INR', amountMinor: 999_000 },
    ],
  },
  {
    code: 'pro', name: 'Pro', sortOrder: 2, description: 'Full-stack apps, mobile builds and deployment.',
    includedCredits: 1200, maxProjects: 10, maxSeats: 1, dailyCreditLimit: 400, maxCreditsPerRun: 300, monthlyBuildCredits: 10,
    featureFlags: ['website_generation', 'preview', 'full_stack', 'mobile_builds', 'hosting', 'advanced_integrations'],
    projectTypes: ['website', 'business_website', 'ecommerce', 'mobile_app', 'saas', 'custom_software'],
    prices: [
      { interval: 'monthly' as BillingInterval, currency: 'INR', amountMinor: 249_900 },
      { interval: 'yearly' as BillingInterval, currency: 'INR', amountMinor: 2_499_000 },
    ],
  },
  {
    code: 'studio', name: 'Studio', sortOrder: 3, description: 'Agencies: client projects and team members.',
    includedCredits: 3800, maxProjects: 40, maxSeats: 5, maxOrgs: 10, dailyCreditLimit: 1200, maxCreditsPerRun: 500, monthlyBuildCredits: 40,
    featureFlags: ['website_generation', 'preview', 'full_stack', 'mobile_builds', 'hosting', 'advanced_integrations', 'team_workspace'],
    projectTypes: ['website', 'business_website', 'ecommerce', 'mobile_app', 'saas', 'custom_software'],
    prices: [
      { interval: 'monthly' as BillingInterval, currency: 'INR', amountMinor: 799_900 },
      { interval: 'yearly' as BillingInterval, currency: 'INR', amountMinor: 7_999_000 },
    ],
  },
];
