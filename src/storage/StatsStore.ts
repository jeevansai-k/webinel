import { LIMITS } from '../shared/config';
import type { Verdict } from '../shared/verdict';
import { dayKey } from '../utils/time';
import { LocalStore } from './LocalStore';

export type CounterName =
  | 'blocked'
  | 'warned'
  | 'bypassed'
  | 'cacheHits'
  | 'virusTotalRequests'
  | 'downloadsBlocked'
  | 'linksScanned'
  | 'filesScanned'
  | 'quickScans'
  | 'fullAnalyses'
  | 'filesUploaded';

export interface DailyStats {
  scanned: number;
  threats: number;
}

export interface Statistics {
  scanned: number;
  verdicts: Record<Verdict, number>;
  counters: Record<CounterName, number>;
  daily: Record<string, DailyStats>;
  since: number;
}

export function createEmptyStatistics(now = Date.now()): Statistics {
  return {
    scanned: 0,
    verdicts: { safe: 0, suspicious: 0, dangerous: 0, unknown: 0, error: 0 },
    counters: {
      blocked: 0,
      warned: 0,
      bypassed: 0,
      cacheHits: 0,
      virusTotalRequests: 0,
      downloadsBlocked: 0,
      linksScanned: 0,
      filesScanned: 0,
      quickScans: 0,
      fullAnalyses: 0,
      filesUploaded: 0,
    },
    daily: {},
    since: now,
  };
}

function pruneDaily(daily: Record<string, DailyStats>, now: number): Record<string, DailyStats> {
  const oldest = dayKey(now - LIMITS.statsRetentionMs);
  return Object.fromEntries(Object.entries(daily).filter(([key]) => key >= oldest));
}

class StatsStore extends LocalStore<Statistics> {
  constructor() {
    super('stats', () => createEmptyStatistics());
  }

  recordVerdict(verdict: Verdict, now = Date.now()): Promise<Statistics> {
    return this.update((stats) => {
      const key = dayKey(now);
      const today = stats.daily[key] ?? { scanned: 0, threats: 0 };
      const isThreat = verdict === 'suspicious' || verdict === 'dangerous';
      return {
        ...stats,
        scanned: stats.scanned + 1,
        verdicts: { ...stats.verdicts, [verdict]: stats.verdicts[verdict] + 1 },
        daily: pruneDaily(
          { ...stats.daily, [key]: { scanned: today.scanned + 1, threats: today.threats + (isThreat ? 1 : 0) } },
          now,
        ),
      };
    });
  }

  increment(counter: CounterName, amount = 1): Promise<Statistics> {
    return this.update((stats) => ({
      ...stats,
      counters: { ...stats.counters, [counter]: (stats.counters[counter] ?? 0) + amount },
    }));
  }
}

/** Last `days` calendar days, oldest first, including empty days. */
export function lastDays(stats: Statistics, days: number, now = Date.now()): Array<{ day: string } & DailyStats> {
  return Array.from({ length: days }, (_, index) => {
    const key = dayKey(now - (days - 1 - index) * 86_400_000);
    return { day: key, ...(stats.daily[key] ?? { scanned: 0, threats: 0 }) };
  });
}

export const statsStore = new StatsStore();
