import type { GateClock } from '../../src/warning/ContinueGate';

/** Deterministic clock for ContinueGate: frames run every 16 ms, timers when due. */
export class FakeClock implements GateClock {
  time = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; callback: () => void }>();
  private frames = new Map<number, () => void>();

  now = () => this.time;

  requestFrame = (callback: () => void) => {
    const id = this.nextId++;
    this.frames.set(id, callback);
    return id;
  };

  cancelFrame = (id: number) => void this.frames.delete(id);

  setTimer = (callback: () => void, delayMs: number) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delayMs, callback });
    return id;
  };

  clearTimer = (id: number) => void this.timers.delete(id);

  /** Advances time in 16 ms steps, running animation frames and due timers. */
  advance(ms: number): void {
    const end = this.time + ms;
    while (this.time < end) {
      this.time = Math.min(end, this.time + 16);
      const frames = [...this.frames.values()];
      this.frames.clear();
      frames.forEach((frame) => frame());
      for (const [id, timer] of [...this.timers]) {
        if (timer.at <= this.time) {
          this.timers.delete(id);
          timer.callback();
        }
      }
    }
  }

  /** Simulates a browser timer firing before its scheduled time. */
  fireTimersEarly(): void {
    for (const [id, timer] of [...this.timers]) {
      this.timers.delete(id);
      timer.callback();
    }
  }
}
