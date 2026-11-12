'use client';

/** Last-resort boundary when the root layout itself fails. Inline styles only: global CSS may not have loaded. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#FAFAF9', color: '#0C0C0B', display: 'grid', placeItems: 'center', minHeight: '100dvh', textAlign: 'center', padding: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: 0 }}>Make Your App AI is having trouble</h1>
          <p style={{ color: '#6F6C64' }}>Please try again in a moment. Your data is safe.{error.digest ? ` Reference: ${error.digest}` : ''}</p>
          <button onClick={reset} style={{ marginTop: 12, height: 40, padding: '0 16px', borderRadius: 8, border: 0, background: '#0C0C0B', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
