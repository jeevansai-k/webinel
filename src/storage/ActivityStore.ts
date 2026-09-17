import { LIMITS } from '../shared/config';
import type { ProtectionAction, Verdict } from '../shared/verdict';
import { LocalStore } from './LocalStore';

/** Display status for Recent Activity. `unknown` is deliberately distinct from `safe`. */
export type ActivityStatus = 'safe' | 'warning' | 'blocked' | 'unknown';

export interface ActivityEntry {
  host: string;
  status: ActivityStatus;
  timestamp: number;
}

export function toActivityStatus(verdict: Verdict, action: ProtectionAction): ActivityStatus {
  if (action === 'block') return 'blocked';
  if (verdict === 'safe') return 'safe';
  if (verdict === 'suspicious' || verdict === 'dangerous') return 'warning';
  return 'unknown';
}

class ActivityStore extends LocalStore<ActivityEntry[]> {
  constructor() {
    super('activity', () => []);
  }

  /** Keeps one entry per host (most recent first), capped. */
  record(entry: ActivityEntry): Promise<ActivityEntry[]> {
    return this.update((entries) =>
      [entry, ...entries.filter((existing) => existing.host !== entry.host)].slice(0, LIMITS.activityEntries),
    );
  }
}

export const activityStore = new ActivityStore();
