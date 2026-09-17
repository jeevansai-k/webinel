import { formatDuration } from '../../utils/format';
import { escapeHtml } from '../dom';
import type { AnalysisJob, AnalysisPhase } from '../scan';

interface Step {
  label: string;
  phases: AnalysisPhase[];
}

function stepsFor(kind: AnalysisJob['kind']): Step[] {
  return [
    kind === 'file'
      ? { label: 'Uploading file', phases: ['uploading'] }
      : { label: 'Submitting URL', phases: ['submitting'] },
    { label: 'Queued at VirusTotal', phases: ['queued'] },
    { label: 'Vendors analyzing', phases: ['in-progress'] },
    { label: 'Building full report', phases: ['fetching-report'] },
  ];
}

/** Polling state for Advanced Analysis and file uploads, with a Cancel button. */
export function analysisProgress(job: AnalysisJob, now = Date.now()): string {
  const steps = stepsFor(job.kind);
  const current = steps.findIndex((step) => step.phases.includes(job.phase));
  const vendors = job.report?.vendors.length ?? 0;
  const items = steps
    .map((step, index) => {
      const state = index < current ? 'done' : index === current ? 'active' : 'pending';
      return `<li class="analysis-progress__step" data-state="${state}"><i class="analysis-progress__dot"></i>${step.label}</li>`;
    })
    .join('');
  const detail = [
    `Elapsed ${formatDuration(now - job.startedAt)}`,
    job.polls > 0 ? `${job.polls} check${job.polls === 1 ? '' : 's'}` : null,
    vendors > 0 ? `${vendors} vendors reported` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `<section class="analysis-progress glass" data-phase="${job.phase}" aria-live="polite">
    <div class="analysis-progress__head">
      <div>
        <h3 class="analysis-progress__title">Analyzing ${escapeHtml(job.target)}</h3>
        <p class="analysis-progress__detail" data-role="elapsed">${escapeHtml(detail)}</p>
      </div>
      <button class="btn" type="button" data-action="cancel-analysis" data-job="${job.id}">Cancel</button>
    </div>
    <div class="analysis-progress__bar"><span></span></div>
    <ol class="analysis-progress__steps">${items}</ol>
    <p class="analysis-progress__hint">You can close this popup — polling continues in the background and respects VirusTotal’s rate limit.</p>
  </section>`;
}
