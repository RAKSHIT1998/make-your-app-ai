import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: ['/', '/explore', '/p/', '/c/', '/pricing', '/legal/'], disallow: ['/home', '/create', '/projects', '/studio', '/stores', '/hosting', '/templates', '/billing', '/settings', '/admin', '/invite', '/r/', '/login'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
