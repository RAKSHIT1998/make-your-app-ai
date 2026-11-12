'use client';

import { useRouter } from 'next/navigation';
import { use, useEffect } from 'react';
import { REF_KEY } from '@/lib/referral';

/** Invite link: remember the code (claimed after sign-up), then go to sign-up. */
export default function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  useEffect(() => {
    try {
      if (/^[A-Za-z0-9]{4,20}$/.test(code)) localStorage.setItem(REF_KEY, code.toUpperCase());
    } catch { /* storage unavailable: invite simply won't apply */ }
    router.replace('/login?invited=1');
  }, [code, router]);
  return null;
}
