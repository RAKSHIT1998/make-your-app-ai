'use client';

import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
  configured: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true, configured: false });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: !!supabase, configured: !!supabase });
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false, configured: true }));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setState({ session, loading: false, configured: true }));
    return () => data.subscription.unsubscribe();
  }, []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
