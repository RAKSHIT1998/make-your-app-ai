'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorNotice, Input } from '@/components/ui';
import { Logo } from '@/components/logo';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

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
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo className="text-lg" />
          <p className="mt-2 text-sm text-muted">Build Anything. From Anywhere.</p>
        </div>
        <Card className="p-6">
          {!configured ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Sign-in isn&apos;t configured yet.</p>
              <p className="text-muted">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment and restart the web app.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <h1 className="text-xl font-semibold">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Email</span>
                <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Password</span>
                <Input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              {error ? <ErrorNotice error={error} /> : null}
              {notice && <p className="rounded-[var(--radius-md)] bg-brand-soft px-3 py-2 text-sm text-brand">{notice}</p>}
              <Button type="submit" className="w-full" loading={busy}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
              <Button type="button" variant="secondary" className="w-full" onClick={google}>Continue with Google</Button>
              <p className="text-center text-sm text-muted">
                {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
                <button type="button" className="font-medium text-brand hover:underline" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
                  {mode === 'signin' ? 'Create an account' : 'Sign in'}
                </button>
              </p>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}
