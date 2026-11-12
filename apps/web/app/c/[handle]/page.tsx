import type { Metadata } from 'next';
import { publicGet, type Creator } from '@/lib/api';
import { CreatorProfile } from './creator-profile';

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const c = await publicGet<Creator>(`/creators/${handle}`);
  if (!c) return { title: 'Creator not found · Make Your App AI', robots: { index: false } };
  const description = c.bio || `${c.totals.projects} project${c.totals.projects === 1 ? '' : 's'} built with Make Your App AI.`;
  return { title: `${c.name} (@${c.handle}) · Make Your App AI`, description, openGraph: { title: `${c.name} on Make Your App AI`, description } };
}

export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <CreatorProfile handle={handle} />;
}
