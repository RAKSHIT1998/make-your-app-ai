'use client';

import { useQuery } from '@tanstack/react-query';
import { flags, type FlagKey } from './api';

/** Platform switches. Defaults to "on" while loading; the server enforces the real value either way. */
export function useFlag(key: FlagKey) {
  const q = useQuery({ queryKey: ['flags'], queryFn: flags.all, staleTime: 60_000 });
  return q.data ? q.data[key] : true;
}
