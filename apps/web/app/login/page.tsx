'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { Button, ErrorNotice, Field, Input, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const POINTS = ['Describe a website — get real, editable code', 'Refine it by chatting, with every change versioned', 'Run a store with products, orders and payments'];

export default function LoginPage() {
  const { session, configured } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session) router.replace('/home');
  }, [session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error } = mode === 'signin' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setError(error);
    if (mode === 'signup' && !data.session) setNotice('Check your inbox to confirm your email, then sign in.');
  }

  async function google() {
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/home` } });
    if (error) setError(error);
  }

  return (
    <main className="grid grid-cols-1 min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/pricing" className="w-fit"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {!configured ? (
            <div className="space-y-2 text-sm">
              <h1 className="text-2xl font-semibold tracking-[-0.02em]">Sign-in isn&apos;t configured</h1>
              <p className="text-muted">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment and restart the web app.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <div>
                <h1 className="text-2xl font-semibold tracking-[-0.02em]">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
                <p className="mt-1.5 text-sm text-muted">{mode === 'signin' ? 'Sign in to continue building.' : 'Start free — no card required.'}</p>
              </div>
              <Button type="button" variant="secondary" size="lg" className="w-full" onClick={google}>
                <svg viewBox="0 0 24 24" className="size-4" aria-hidden><path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8Z" /><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23Z" /><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8Z" /><path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.2 1.6l3.1-3.1A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4Z" /></svg>
                Continue with Google
              </Button>
              <div className="flex items-center gap-3 text-xs text-subtle"><span className="h-px flex-1 bg-border" />or with email<span className="h-px flex-1 bg-border" /></div>
              <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></Field>
              <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}><Input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              {error ? <ErrorNotice error={error} /> : null}
              {notice && <Notice tone="success">{notice}</Notice>}
              <Button type="submit" size="lg" className="w-full" loading={busy}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
              <p className="text-center text-sm text-muted">
                {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
                <button type="button" className="font-medium text-fg underline-offset-4 hover:underline" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setNotice(null); }}>
                  {mode === 'signin' ? 'Create an account' : 'Sign in'}
                </button>
              </p>
            </form>
          )}
        </div>
        <p className="text-center text-xs text-subtle">By continuing you agree to the <Link href="/legal/terms" className="underline-offset-4 hover:underline">Terms</Link> and <Link href="/legal/privacy" className="underline-offset-4 hover:underline">Privacy Policy</Link>.</p>
      </div>
      <aside className="relative hidden overflow-hidden bg-[#0C0C0B] p-12 text-[#F3F2EF] lg:flex lg:flex-col lg:justify-between">
        <span className="flex items-center gap-2.5 text-sm font-semibold"><svg viewBox="0 0 28 28" className="size-8" aria-hidden><rect width="28" height="28" rx="8" fill="#F3F2EF" /><path d="M7.5 19.5V9.2c0-.5.6-.8 1-.4l5.5 5.6 5.5-5.6c.4-.4 1-.1 1 .4v10.3" fill="none" stroke="#0C0C0B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="21.6" cy="6.4" r="2.4" fill="#FF6A33" /></svg>Make Your App AI</span>
        <div className="max-w-md">
          <h2 className="text-4xl font-semibold leading-[1.1] tracking-[-0.03em]">Build anything.<br /><span className="text-[#FF6A33]">From anywhere.</span></h2>
          <ul className="mt-8 space-y-3 text-[15px] text-[#F3F2EF]/75">
            {POINTS.map((p) => <li key={p} className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-[#FF6A33]" />{p}</li>)}
          </ul>
        </div>
        <div className="text-xs text-[#F3F2EF]/45">Websites and stores today · apps coming next</div>
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-40 size-[520px] rounded-full border border-[#F3F2EF]/[0.06]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 -right-20 size-[320px] rounded-full border border-[#F3F2EF]/[0.08]" />
      </aside>
    </main>
  );
}
