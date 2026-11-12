import type { Metadata } from 'next';
import { publicGet, type ShowcasePage } from '@/lib/api';
import { ProjectPublic } from './project-public';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await publicGet<ShowcasePage>(`/showcase/${slug}`);
  if (!p) return { title: 'Project not found · Make Your App AI', robots: { index: false } };
  const title = `${p.title} by @${p.creator.handle} · Make Your App AI`;
  const description = p.description || p.summary || 'Built with Make Your App AI.';
  return {
    title,
    description,
    openGraph: { title: p.title, description, type: 'website', siteName: 'Make Your App AI' },
    twitter: { card: 'summary_large_image', title: p.title, description },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ProjectPublic slug={slug} />;
}
