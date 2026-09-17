/**
 * Mandatory security tests (spec §18) for the Continue Anyway interaction.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CONTINUE_GATE_DURATION_MS } from '../../src/shared/config';
import { ContinueGate } from '../../src/warning/ContinueGate';
import { FakeClock } from '../setup/fakeClock';

const warningHtml = readFileSync(resolve(import.meta.dirname, '../../src/warning/Warning.html'), 'utf8');
const warningCss = readFileSync(resolve(import.meta.dirname, '../../src/warning/Warning.css'), 'utf8');

let clock: FakeClock;
let button: HTMLButtonElement;
let overlay: HTMLElement;
let onContinue: Mock<() => void>;
let gate: ContinueGate;

function overlayWidth(): number {
  return Number.parseFloat(overlay.style.width);
}

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(warningHtml, 'text/html').body.innerHTML;
  button = document.querySelector<HTMLButtonElement>('[data-action="continue"]')!;
  overlay = document.querySelector<HTMLElement>('[data-role="gate-overlay"]')!;
  onContinue = vi.fn<() => void>();
  clock = new FakeClock();
  gate = new ContinueGate(button, overlay, CONTINUE_GATE_DURATION_MS, clock);
  button.addEventListener('click', () => {
    if (gate.isReady()) onContinue();
  });
});

describe('Continue Anyway gate', () => {
  it('uses a 3-second delay', () => {
    expect(CONTINUE_GATE_DURATION_MS).toBe(3000);
  });

  it('is disabled in the markup before any script runs', () => {
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('is disabled and fully covered by the glass overlay when the warning appears', () => {
    gate.start();
    expect(button.disabled).toBe(true);
    expect(gate.currentState).toBe('locked');
    expect(overlay.hidden).toBe(false);
    expect(overlayWidth()).toBe(100);
    expect(button.contains(overlay)).toBe(true);
  });

  it('stays disabled for the full 3 seconds', () => {
    gate.start();
    clock.advance(2_990);
    expect(button.disabled).toBe(true);
    expect(gate.isReady()).toBe(false);
    clock.advance(10);
    expect(button.disabled).toBe(false);
  });

  it('depletes the overlay right → left, anchored to the left edge', () => {
    gate.start();
    const widths: number[] = [];
    for (let i = 0; i < 6; i++) {
      clock.advance(480);
      widths.push(overlayWidth());
    }
    // strictly shrinking…
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeLessThan(widths[i - 1]!);
    // …proportionally to elapsed time…
    expect(widths[2]).toBeCloseTo(100 * (1 - 1440 / 3000), 0);
    // …with the left edge fixed, so the right edge is what moves leftwards.
    expect(overlay.style.left).toBe('0px');
    expect(overlay.style.right).toBe('auto');
    expect(warningCss).toMatch(/\.continue-gate__overlay\s*{[^}]*left:\s*0;[^}]*right:\s*auto;/s);
  });

  it('uses no spinner, countdown text or percentage', () => {
    gate.start();
    clock.advance(1_000);
    expect(button.textContent?.trim()).toBe('Continue Anyway');
    expect(button.textContent).not.toMatch(/\d/);
    expect(button.querySelector('[role="progressbar"], .spinner, .spin, progress')).toBeNull();
    expect(overlay.textContent).toBe('');
  });

  it('prevents early clicks', () => {
    gate.start();
    clock.advance(1_500);
    button.click();
    // Even if someone strips the disabled attribute, the gate still swallows the click.
    button.disabled = false;
    button.click();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('ignores timers that fire early', () => {
    gate.start();
    clock.advance(500);
    clock.fireTimersEarly();
    expect(button.disabled).toBe(true);
    expect(gate.isReady()).toBe(false);
    clock.advance(2_500);
    expect(gate.isReady()).toBe(true);
  });

  it('enables the button correctly once the overlay is gone', () => {
    gate.start();
    clock.advance(3_000);
    expect(overlay.hidden).toBe(true);
    expect(overlayWidth()).toBe(0);
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.dataset.gate).toBe('ready');
    button.click();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('resets on a new warning', () => {
    gate.start();
    clock.advance(3_000);
    expect(gate.isReady()).toBe(true);

    gate.reset();
    expect(button.disabled).toBe(true);
    expect(overlay.hidden).toBe(false);
    expect(overlayWidth()).toBe(100);
    button.click();
    expect(onContinue).not.toHaveBeenCalled();

    clock.advance(2_000);
    gate.reset(); // a second new warning mid-way restarts the full delay
    clock.advance(2_000);
    expect(gate.isReady()).toBe(false);
    clock.advance(1_000);
    expect(gate.isReady()).toBe(true);
  });
});
