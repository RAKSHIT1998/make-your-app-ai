'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import { getActiveOrg, setActiveOrg, subscribeActiveOrg } from './workspace';

const KEEP = new Set(['me', 'flags']);

/** The workspace the app is currently acting in. Falls back to the personal workspace. */
export function useWorkspace() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const stored = useSyncExternalStore(subscribeActiveOrg, getActiveOrg, () => null);
  const orgs = me.data?.organizations ?? [];
  const valid = stored && orgs.some((o) => o.id === stored) ? stored : null;

  // A workspace we've been removed from (or that no longer exists) must not keep being requested.
  useEffect(() => {
    if (me.data && stored && !valid) setActiveOrg(null);
  }, [me.data, stored, valid]);

  const current = orgs.find((o) => o.id === (valid ?? me.data?.personalOrgId)) ?? null;

  const switchTo = useCallback((id: string) => {
    const personal = me.data?.personalOrgId;
    setActiveOrg(id === personal ? null : id);
    // Everything cached belongs to the previous workspace.
    qc.removeQueries({ predicate: (q) => !KEEP.has(String(q.queryKey[0])) });
    void qc.invalidateQueries();
  }, [me.data?.personalOrgId, qc]);

  return { current, organizations: orgs, personalOrgId: me.data?.personalOrgId ?? null, isTeam: !!current && !current.personal, switchTo, ready: !!me.data };
}
