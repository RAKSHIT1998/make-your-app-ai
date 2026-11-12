'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LogoMark } from '@/components/logo';
import { AppShell } from '@/components/shell';
import { useAuth } from '@/lib/auth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [loading, session, router]);
  if (loading || !session) {
    return <div className="flex min-h-dvh items-center justify-center"><LogoMark className="size-9 animate-pulse" /></div>;
  }
  return <AppShell>{children}</AppShell>;
}
