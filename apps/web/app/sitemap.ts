import type { MetadataRoute } from 'next';
import { publicGet, type ShowcaseCard } from '@/lib/api';
import { LEGAL_SLUGS } from '@/lib/legal';
import { SITE_URL } from '@/lib/site';

export const revalidate = 3600;

/** Public pages plus published projects and their creators (only what Explore already shows publicly). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixed: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/explore`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/pricing`, changeFrequency: 'monthly', priority: 0.7 },
    ...LEGAL_SLUGS.map((s) => ({ url: `${SITE_URL}/legal/${s}`, changeFrequency: 'yearly' as const, priority: 0.2 })),
  ];
  const items: ShowcaseCard[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await publicGet<{ items: ShowcaseCard[]; hasMore: boolean }>(`/explore?sort=recent&limit=48&page=${page}`);
    if (!r) break;
    items.push(...r.items);
    if (!r.hasMore) break;
  }
  const creators = [...new Set(items.map((i) => i.creator.handle).filter(Boolean))];
  return [
    ...fixed,
    ...items.map((i) => ({ url: `${SITE_URL}/p/${i.slug}`, lastModified: i.publishedAt ?? undefined, changeFrequency: 'weekly' as const, priority: 0.6 })),
    ...creators.map((h) => ({ url: `${SITE_URL}/c/${h}`, changeFrequency: 'weekly' as const, priority: 0.4 })),
  ];
}
