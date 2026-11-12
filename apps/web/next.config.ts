import path from 'node:path';
import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';
const origin = (u: string | undefined) => {
  try {
    return u ? new URL(u).origin : '';
  } catch {
    return '';
  }
};
const api = origin(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000');
const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseWs = supabase.replace(/^http/, 'ws');

/**
 * Content Security Policy. Inline scripts are needed for Next.js bootstrapping and the theme boot script;
 * everything else is an explicit allow-list (API, Supabase, Razorpay Checkout). Stripe Checkout is a redirect.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"} https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${api} ${supabase} ${supabaseWs} https://api.razorpay.com https://lumberjack.razorpay.com`.replace(/\s+/g, ' ').trim(),
  'frame-src https://api.razorpay.com https://checkout.razorpay.com',
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProd ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Microphone is used by voice input on our own pages only.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=(self "https://checkout.razorpay.com"), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : []),
];

const nextConfig: NextConfig = {
  transpilePackages: ['@mya/shared', '@mya/design-tokens'],
  // Self-contained server bundle for the Docker image.
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
