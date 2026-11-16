import { PROJECT_TYPE_LABELS } from '@mya/shared';
import type { ChallengePhase, ChallengeSummary } from '@/lib/api';
import { Badge } from '../ui';

export const PHASE: Record<ChallengePhase, { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' | 'accent' }> = {
  open: { label: 'Open for entries', tone: 'success' },
  voting: { label: 'Voting', tone: 'accent' },
  upcoming: { label: 'Starts soon', tone: 'info' },
  ended: { label: 'Ended', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
  draft: { label: 'Draft', tone: 'neutral' },
};

export const PhaseBadge = ({ phase }: { phase: ChallengePhase }) => <Badge tone={PHASE[phase].tone} dot={phase === 'open' || phase === 'voting'}>{PHASE[phase].label}</Badge>;

export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** The one date that matters right now, in words. */
export function nextDeadline(c: Pick<ChallengeSummary, 'phase' | 'startsAt' | 'submissionsCloseAt' | 'votingClosesAt'>) {
  switch (c.phase) {
    case 'upcoming': return `Opens ${when(c.startsAt)}`;
    case 'open': return `Entries close ${when(c.submissionsCloseAt)}`;
    case 'voting': return `Voting closes ${when(c.votingClosesAt)}`;
    case 'ended': return `Ended ${when(c.votingClosesAt)}`;
    default: return '';
  }
}

export const typesText = (types: ChallengeSummary['projectTypes']) => (types.length ? types.map((t) => PROJECT_TYPE_LABELS[t]).join(', ') : 'Any project type');
