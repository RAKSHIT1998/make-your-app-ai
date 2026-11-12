import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import { API_CONFIGURED } from './api';
import { supabase } from './supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
  configured: boolean;
}
const Ctx = createContext<AuthState>({ session: null, loading: true, configured: false });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: !!supabase, configured: !!supabase });
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false, configured: true }));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setState({ session, loading: false, configured: true }));
    return () => data.subscription.unsubscribe();
  }, []);
  // Sign-in is only offered when both Supabase and the API URL are configured.
  return <Ctx.Provider value={{ ...state, configured: state.configured && API_CONFIGURED }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
