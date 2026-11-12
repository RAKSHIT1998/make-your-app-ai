import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** null when Supabase env vars are missing — the UI shows a setup notice instead of failing. */
export const supabase: SupabaseClient | null = url && anon ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
