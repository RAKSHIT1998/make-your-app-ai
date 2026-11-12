'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';

export default function Index() {
  const { session, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading) router.replace(session ? '/home' : '/login');
  }, [loading, session, router]);
  return null;
}
