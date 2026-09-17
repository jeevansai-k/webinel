import type { DetectionRatio, ReportState } from '../scan';
import type { Verdict } from '../verdict';
import { verdictTone } from './VerdictChip';

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Large circular detection ratio ("5 / 93"). The arc shows the flagged share,
 * tinted by verdict. Used by Scan Now, Advanced Analysis and the file scanner.
 */
export function detectionCircle(ratio: DetectionRatio, verdict: Verdict, state: ReportState, size = 112): string {
  const share = ratio.total > 0 ? ratio.detected / ratio.total : 0;
  // Any detection stays visible even on a 1/95 ratio.
  const arc = ratio.detected > 0 ? Math.max(share * CIRCUMFERENCE, 10) : 0;
  const tone = verdictTone(verdict);
  const label =
    state === 'processing' && ratio.total === 0
      ? 'Analysis in progress, no vendor results yet'
      : `${ratio.detected} of ${ratio.total} security vendors flagged this${state === 'complete' ? '' : ' so far'}`;
  return `<div class="detection-circle" data-tone="${tone}" data-state="${state}" role="img" aria-label="${label}">
    <svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
      <circle class="detection-circle__track" cx="50" cy="50" r="${RADIUS}" fill="none" stroke-width="7"/>
      <circle class="detection-circle__arc" cx="50" cy="50" r="${RADIUS}" fill="none" stroke-width="7" stroke-linecap="round"
        stroke-dasharray="${arc.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}" transform="rotate(-90 50 50)"/>
    </svg>
    <div class="detection-circle__text">
      <strong class="detection-circle__detected">${ratio.detected}</strong>
      <span class="detection-circle__total">/ ${ratio.total}</span>
    </div>
  </div>`;
}
