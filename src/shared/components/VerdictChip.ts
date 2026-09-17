import type { ActivityStatus } from '../../storage/ActivityStore';
import { escapeHtml } from '../dom';
import type { Verdict } from '../verdict';

/** Verdict labels. `unknown` reads "Unverified" so it can never be mistaken for Safe. */
const VERDICT_TEXT: Record<Verdict, string> = {
  safe: 'Safe',
  suspicious: 'Suspicious',
  dangerous: 'Dangerous',
  unknown: 'Unverified',
  error: 'Check failed',
};

const ACTIVITY_TEXT: Record<ActivityStatus, string> = {
  safe: 'Safe',
  warning: 'Warning',
  blocked: 'Blocked',
  unknown: 'Unverified',
};

const ACTIVITY_TONE: Record<ActivityStatus, string> = {
  safe: 'safe',
  warning: 'warn',
  blocked: 'danger',
  unknown: 'unknown',
};

const VERDICT_TONE: Record<Verdict, string> = {
  safe: 'safe',
  suspicious: 'warn',
  dangerous: 'danger',
  unknown: 'unknown',
  error: 'unknown',
};

export function verdictText(verdict: Verdict): string {
  return VERDICT_TEXT[verdict];
}

export function verdictTone(verdict: Verdict): string {
  return VERDICT_TONE[verdict];
}

export function verdictChip(verdict: Verdict | null, fallback = 'Not checked'): string {
  if (!verdict) return `<span class="chip chip--unknown">${escapeHtml(fallback)}</span>`;
  return `<span class="chip chip--${VERDICT_TONE[verdict]}" data-verdict="${verdict}"><i class="chip__dot"></i>${VERDICT_TEXT[verdict]}</span>`;
}

export function activityChip(status: ActivityStatus): string {
  return `<span class="chip chip--${ACTIVITY_TONE[status]}" data-status="${status}"><i class="chip__dot"></i>${ACTIVITY_TEXT[status]}</span>`;
}
