'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { Button, ErrorNotice, Field, Input, Notice, Skeleton } from '@/components/ui';
import { supabase } from '@/lib/supabase';

/** Landing page of the password-reset email: the link signs the person in for this one purpose. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'ready' | 'invalid' | 'done'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!supabase) return setState('invalid');
    const fromLink = /type=recovery/.test(window.location.hash) || new URLSearchParams(window.location.search).has('code');
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (fromLink && session)) setState('ready');
    });
    // Give the client a moment to read the link; an expired or reused link leaves no session.
    const t = setTimeout(async () => {
      const { data: s } = await supabase!.auth.getSession();
      setState((cur) => (cur === 'checking' ? (fromLink && s.session ? 'ready' : 'invalid') : cur));
    }, 1500);
    return () => { clearTimeout(t); data.subscription.unsubscribe(); };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error);
    setState('done');
    setTimeout(() => router.replace('/home'), 1200);
  }

  return (
    <main className="flex min-h-dvh flex-col px-5 py-8 sm:px-10">
      <Link href="/" className="w-fit"><Logo /></Link>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        {state === 'checking' ? <Skeleton className="h-40" /> : state === 'invalid' ? (
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">This link has expired</h1>
            <p className="text-sm text-muted">Reset links work once and only for a short time. Ask for a new one from the sign-in page.</p>
            <Link href="/login" className="text-sm font-medium underline-offset-4 hover:underline">Back to sign in</Link>
          </div>
        ) : state === 'done' ? (
          <Notice tone="success">Your password has been changed. Taking you to your projects…</Notice>
        ) : (
          <form onSubmit={save} className="space-y-5">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.02em]">Choose a new password</h1>
              <p className="mt-1.5 text-sm text-muted">At least 8 characters.</p>
            </div>
            <Field label="New password"><Input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Repeat it" error={confirm && confirm !== password ? 'The two passwords don’t match.' : null}>
              <Input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {error ? <ErrorNotice error={error} /> : null}
            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={password.length < 8 || password !== confirm}>Save new password</Button>
          </form>
        )}
      </div>
    </main>
  );
}
