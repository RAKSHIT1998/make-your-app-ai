/** Canonical public URL of the web app (used for metadata, sitemap and share links rendered on the server). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
