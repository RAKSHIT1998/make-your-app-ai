'use client';

import { useEffect, useRef } from 'react';
import { toast } from '@/components/ui';
import { ApiError, referrals } from './api';
import { useAuth } from './auth';

export const REF_KEY = 'mya-ref';

/** After sign-in, links a remembered invite code to the account once. Rewards only follow a verified payment. */
export function useClaimReferral() {
  const { session } = useAuth();
  const done = useRef(false);
  useEffect(() => {
    if (!session || done.current) return;
    let code: string | null = null;
    try { code = localStorage.getItem(REF_KEY); } catch { /* ignore */ }
    if (!code) return;
    done.current = true;
    const forget = () => { try { localStorage.removeItem(REF_KEY); } catch { /* ignore */ } };
    referrals.claim(code)
      .then(() => { forget(); toast.success('Invite applied — you’ll both get bonus credits after your first purchase'); })
      .catch((e) => {
        if (e instanceof ApiError && e.status < 500) forget(); // invalid/expired/own code: drop it quietly
        else done.current = false; // transient: retry on the next visit
      });
  }, [session]);
}
