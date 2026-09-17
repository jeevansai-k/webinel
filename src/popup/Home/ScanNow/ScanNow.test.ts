import { describe, expect, it, vi } from 'vitest';
import { urlReport } from '../../../../tests/fixtures/reports';
import { respondTo } from '../../../../tests/setup/chromeMock';
import { mountScreen, setActiveTab, text } from '../../../../tests/setup/screen';
import { describeScanError } from '../../../shared/scanErrors';
import { handOff, takeHandoff } from '../../handoff';
import { mount } from './ScanNow';

describe('Scan Now screen', () => {
  it('prefills the current tab and scans on submit', async () => {
    setActiveTab('https://evil.test/login');
    const quick = vi.fn(() => ({ kind: 'report', report: urlReport(3) }));
    respondTo({ 'scan:quick': quick });
    const { root } = await mountScreen(mount);
    const input = root.querySelector<HTMLInputElement>('[data-role="url"]')!;
    expect(input.value).toBe('https://evil.test/login');

    root.querySelector<HTMLFormElement>('[data-role="form"]')!.requestSubmit();
    await vi.waitFor(() => expect(root.querySelector('[data-role="result"] .detection-circle')).not.toBeNull());
    expect(quick).toHaveBeenCalledWith({ url: 'https://evil.test/login' });
    expect(text(root.querySelector('.detection-circle'))).toBe('3 / 71');
    expect(root.querySelector('[data-section="vendors"]')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('[data-action="full-analysis"]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-role="timer"]')!.hidden).toBe(true);
  });

  it('auto-starts when launched from Home and shows the 6-second timer meanwhile', async () => {
    let finish!: (value: unknown) => void;
    respondTo({ 'scan:quick': () => new Promise((resolve) => (finish = resolve)) });
    handOff('scanUrl', { url: 'https://pasted.test/', autostart: true });
    const { root } = await mountScreen(mount);
    const timer = root.querySelector<HTMLElement>('[data-role="timer"]')!;
    expect(timer.hidden).toBe(false);
    expect(timer.classList.contains('scan-timer--running')).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-action="scan"]')!.disabled).toBe(true);
    expect(text(root.querySelector('[data-role="result"]'))).toContain('up to 6 seconds');
    finish({ kind: 'report', report: urlReport(0) });
    await vi.waitFor(() => expect(timer.hidden).toBe(true));
  });

  it('validates the URL before sending anything', async () => {
    const quick = vi.fn();
    respondTo({ 'scan:quick': quick });
    const { root } = await mountScreen(mount);
    root.querySelector<HTMLInputElement>('[data-role="url"]')!.value = 'not a link';
    root.querySelector<HTMLFormElement>('[data-role="form"]')!.requestSubmit();
    await vi.waitFor(() => expect(root.querySelector('[data-error="invalid-url"]')).not.toBeNull());
    expect(quick).not.toHaveBeenCalled();
  });

  it('shows the missing-key screen with an Open Settings button', async () => {
    respondTo({ 'scan:quick': () => ({ kind: 'error', error: describeScanError('missing-key') }) });
    handOff('scanUrl', { url: 'https://a.test/', autostart: true });
    const { root, ctx } = await mountScreen(mount);
    await vi.waitFor(() => expect(root.querySelector('[data-error="missing-key"]')).not.toBeNull());
    expect(text(root.querySelector('.error-state__title'))).toBe('VirusTotal API key required.');
    root.querySelector<HTMLButtonElement>('[data-error-action="open-settings"]')!.click();
    expect(ctx.navigate).toHaveBeenCalledWith('settings');
    expect(root.querySelector<HTMLButtonElement>('[data-action="full-analysis"]')!.hidden).toBe(true);
  });

  it('retries from the rate-limit screen', async () => {
    const quick = vi.fn(() => ({ kind: 'error', error: describeScanError('rate-limited') }));
    respondTo({ 'scan:quick': quick });
    handOff('scanUrl', { url: 'https://a.test/', autostart: true });
    const { root } = await mountScreen(mount);
    await vi.waitFor(() => expect(root.querySelector('[data-error="rate-limited"]')).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[data-error-action="retry"]')!.click();
    await vi.waitFor(() => expect(quick).toHaveBeenCalledTimes(2));
  });

  it('hands the URL over to Advanced Analysis', async () => {
    respondTo({ 'scan:quick': () => ({ kind: 'report', report: urlReport(1) }) });
    handOff('scanUrl', { url: 'https://evil.test/login', autostart: true });
    const { root, ctx } = await mountScreen(mount);
    const full = root.querySelector<HTMLButtonElement>('[data-action="full-analysis"]')!;
    await vi.waitFor(() => expect(full.hidden).toBe(false));
    full.click();
    expect(ctx.navigate).toHaveBeenCalledWith('advanced');
    expect(takeHandoff('advancedUrl')).toEqual({ url: 'https://evil.test/login', autostart: true });
  });
});
