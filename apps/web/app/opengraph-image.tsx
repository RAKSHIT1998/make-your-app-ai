import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Make Your App AI — Build anything. From anywhere.';

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#0C0C0B', color: '#F3F2EF', padding: 72 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 30, fontWeight: 600 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#F3F2EF', color: '#0C0C0B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>M</div>
          Make Your App AI
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
          <span>Your idea deserves to exist.</span>
          <span style={{ color: '#FF6A33' }}>Build it with AI.</span>
        </div>
        <div style={{ fontSize: 28, color: '#F3F2EFAA' }}>Websites · Mobile apps · Online stores — real code you own</div>
      </div>
    ),
    size,
  );
}
