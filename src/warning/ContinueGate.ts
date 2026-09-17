/**
 * Continue Anyway gate — mandatory interaction (spec §10):
 *   1. button disabled on start
 *   2. a white glass overlay covers the whole button
 *   3. over exactly 3 s the overlay's right edge moves RIGHT → LEFT
 *      (width 100 % → 0 %, anchored left), depleting like a health bar
 *   4. the overlay disappears and only then is the button enabled
 * No spinner, countdown text or percentage — the overlay *is* the feedback.
 * Clicks before the gate opens are swallowed even if `disabled` is tampered with.
 */
import { CONTINUE_GATE_DURATION_MS } from '../shared/config';

export interface GateClock {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, delayMs: number): number;
  clearTimer(handle: number): void;
}

export const browserClock: GateClock = {
  now: () => performance.now(),
  requestFrame: (callback) => window.requestAnimationFrame(() => callback()),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimer: (handle) => window.clearTimeout(handle),
};

export type GateState = 'idle' | 'locked' | 'ready';

export class ContinueGate {
  private state: GateState = 'idle';
  private startedAt = 0;
  private frame: number | null = null;
  private timer: number | null = null;

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly overlay: HTMLElement,
    private readonly durationMs: number = CONTINUE_GATE_DURATION_MS,
    private readonly clock: GateClock = browserClock,
  ) {
    // Capture phase: runs before any other click handler on the button.
    this.button.addEventListener('click', this.guardClick, true);
  }

  get currentState(): GateState {
    return this.state;
  }

  isReady(): boolean {
    return this.state === 'ready';
  }

  /** Fraction of the overlay still covering the button (1 → 0). */
  remaining(): number {
    if (this.state === 'ready') return 0;
    if (this.state === 'idle') return 1;
    return Math.max(0, 1 - (this.clock.now() - this.startedAt) / this.durationMs);
  }

  start(): void {
    this.stopTimers();
    this.state = 'locked';
    this.startedAt = this.clock.now();

    this.button.disabled = true;
    this.button.setAttribute('aria-disabled', 'true');
    this.button.dataset.gate = 'locked';
    this.overlay.hidden = false;
    this.renderOverlay(1);

    this.frame = this.clock.requestFrame(this.tick);
    this.timer = this.clock.setTimer(this.tryUnlock, this.durationMs);
  }

  /** Restart for a new warning. */
  reset(): void {
    this.start();
  }

  destroy(): void {
    this.stopTimers();
    this.button.removeEventListener('click', this.guardClick, true);
  }

  private readonly tick = (): void => {
    if (this.state !== 'locked') return;
    this.renderOverlay(this.remaining());
    this.frame = this.clock.requestFrame(this.tick);
  };

  private readonly tryUnlock = (): void => {
    this.timer = null;
    if (this.state !== 'locked') return;
    const elapsed = this.clock.now() - this.startedAt;
    if (elapsed < this.durationMs) {
      // Timers can fire early; never open the gate before the full duration.
      this.timer = this.clock.setTimer(this.tryUnlock, this.durationMs - elapsed);
      return;
    }
    this.stopTimers();
    this.state = 'ready';
    this.renderOverlay(0);
    this.overlay.hidden = true;
    this.button.disabled = false;
    this.button.removeAttribute('aria-disabled');
    this.button.dataset.gate = 'ready';
  };

  private readonly guardClick = (event: Event): void => {
    if (this.isReady()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private renderOverlay(fraction: number): void {
    // Anchored at the left edge, so shrinking the width moves the right edge leftwards.
    this.overlay.style.left = '0';
    this.overlay.style.right = 'auto';
    this.overlay.style.width = `${(fraction * 100).toFixed(3)}%`;
  }

  private stopTimers(): void {
    if (this.frame !== null) this.clock.cancelFrame(this.frame);
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    this.frame = null;
    this.timer = null;
  }
}
