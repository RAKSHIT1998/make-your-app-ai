import { ImageResponse } from 'next/og';
import { publicGet, type ShowcasePage } from '@/lib/api';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Project built with Make Your App AI';

/** Open Graph card generated from the project's real published title, creator and design palette. */
export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await publicGet<ShowcasePage>(`/showcase/${slug}`);
  const pal = p?.palette ?? { background: '#F4F3F0', primary: '#0C0C0B', text: '#0C0C0B', muted: '#6F6C64', accent: '#F2541B', surface: '#FFFFFF', border: '#E4E2DD' };
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#0C0C0B', padding: 56 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: '#F3F2EF', paddingRight: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 26, fontWeight: 600 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#F3F2EF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0C0C0B', fontSize: 24, fontWeight: 800 }}>M</div>
            Make Your App AI
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>{(p?.title ?? 'Project').slice(0, 60)}</div>
            <div style={{ fontSize: 28, color: '#F3F2EFAA' }}>{p ? `by @${p.creator.handle}` : ''}</div>
          </div>
          <div style={{ fontSize: 24, color: '#FF6A33' }}>Build anything. From anywhere.</div>
        </div>
        <div style={{ width: 430, display: 'flex', flexDirection: 'column', borderRadius: 24, background: pal.background, padding: 32, gap: 18 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 90, height: 12, borderRadius: 6, background: pal.text }} />
            <div style={{ flex: 1 }} />
            <div style={{ width: 70, height: 26, borderRadius: 6, background: pal.primary }} />
          </div>
          <div style={{ width: 300, height: 22, borderRadius: 11, background: pal.text, marginTop: 40 }} />
          <div style={{ width: 220, height: 22, borderRadius: 11, background: pal.text }} />
          <div style={{ width: 260, height: 12, borderRadius: 6, background: pal.muted }} />
          <div style={{ width: 110, height: 34, borderRadius: 8, background: pal.accent, marginTop: 10 }} />
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 12 }}>
            {[0, 1, 2].map((i) => <div key={i} style={{ flex: 1, height: 80, borderRadius: 12, background: pal.surface, border: `2px solid ${pal.border}` }} />)}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
