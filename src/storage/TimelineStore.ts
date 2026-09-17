import { LIMITS } from '../shared/config';
import type { Verdict } from '../shared/verdict';
import { LocalStore } from './LocalStore';

/** Security events only — Webinel does not keep a browsing history. */
export type TimelineEventKind =
  | 'blocked'
  | 'warned'
  | 'bypassed'
  | 'whitelisted'
  | 'unwhitelisted'
  | 'manual-scan'
  | 'download-blocked'
  | 'download-paused'
  | 'links-scanned'
  | 'file-scanned'
  | 'full-analysis'
  | 'file-uploaded'
  | 'api-key-changed';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  /** Domain or file name — never a full URL. */
  subject: string;
  verdict: Verdict | null;
  detail: string;
  timestamp: number;
}

export type NewTimelineEvent = Omit<TimelineEvent, 'id' | 'timestamp'> & { timestamp?: number };

class TimelineStore extends LocalStore<TimelineEvent[]> {
  constructor() {
    super('timeline', () => []);
  }

  record(event: NewTimelineEvent): Promise<TimelineEvent[]> {
    const entry: TimelineEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: event.timestamp ?? Date.now(),
    };
    return this.update((events) => [entry, ...events].slice(0, LIMITS.timelineEntries));
  }
}

export const timelineStore = new TimelineStore();
