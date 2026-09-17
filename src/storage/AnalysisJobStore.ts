/**
 * Advanced Analysis and file-upload jobs. Session storage: survives the popup
 * closing (polling runs in the background) but not a browser restart.
 */
import { SCANNING } from '../shared/config';
import type { AnalysisJob } from '../shared/scan';
import { LocalStore } from './LocalStore';

class AnalysisJobStore extends LocalStore<Record<string, AnalysisJob>> {
  constructor() {
    super('analysis.jobs', () => ({}), chrome.storage.session);
  }

  async put(job: AnalysisJob): Promise<void> {
    await this.update((jobs) => {
      const next = { ...jobs, [job.id]: job };
      const ids = Object.keys(next).sort((a, b) => next[b]!.startedAt - next[a]!.startedAt);
      return Object.fromEntries(ids.slice(0, SCANNING.maxJobs).map((id) => [id, next[id]!]));
    });
  }

  async patch(id: string, changes: Partial<AnalysisJob>): Promise<AnalysisJob | null> {
    let result: AnalysisJob | null = null;
    await this.update((jobs) => {
      const job = jobs[id];
      if (!job) return jobs;
      result = { ...job, ...changes, updatedAt: Date.now() };
      return { ...jobs, [id]: result };
    });
    return result;
  }

  async find(id: string): Promise<AnalysisJob | null> {
    return (await this.get())[id] ?? null;
  }

  /** Most recent job of a kind (the popup reopens onto it). */
  async latest(kind: AnalysisJob['kind']): Promise<AnalysisJob | null> {
    const jobs = Object.values(await this.get()).filter((job) => job.kind === kind);
    return jobs.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
  }
}

export const analysisJobStore = new AnalysisJobStore();
