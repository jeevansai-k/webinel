import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWarning, start } from '../../src/warning/Warning';
import { chromeFake, respondTo } from '../setup/chromeMock';
import { text } from '../setup/screen';

const html = readFileSync(resolve(import.meta.dirname, '../../src/warning/Warning.html'), 'utf8');

const details = {
  id: 'w1',
  tabId: 3,
  url: 'https://evil.test/login',
  host: 'evil.test',
  verdict: 'dangerous' as const,
  reasons: ['Looks like paypal', '<b>Flagged</b> by 9 vendors'],
  createdAt: 0,
};

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  window.history.replaceState(null, '', '/warning/Warning.html?id=w1');
});

describe('Warning page', () => {
  it('shows the red shield, blocked message, actions and branding', async () => {
    respondTo({ 'warning:details': () => details });
    const gate = await start();
    expect(document.querySelector('[data-slot="shield"] svg')).not.toBeNull();
    expect(document.querySelector('.warning__shield-icon')).not.toBeNull();
    expect(text(document.querySelector('[data-role="title"]'))).toBe('Dangerous site blocked');
    expect(text(document.querySelector('[data-role="host"]'))).toBe('evil.test');
    expect(text(document.querySelector('[data-action="continue"]'))).toBe('Continue Anyway');
    expect(text(document.querySelector('[data-action="whitelist"]'))).toBe('Whitelist this Site');
    expect(text(document.querySelector('.warning__brand'))).toContain('Webinel');
    expect(text(document.querySelector('.warning__footer'))).toContain('Webinel');
    expect(gate.currentState).toBe('locked');
    gate.destroy();
  });

  it('escapes reasons and keeps the blocked URL out of the page address', async () => {
    respondTo({ 'warning:details': () => details });
    const gate = await start();
    expect(document.querySelector('[data-role="reasons"] b')).toBeNull();
    expect(text(document.querySelector('[data-role="reasons"]'))).toContain('<b>Flagged</b>');
    expect(location.search).toBe('?id=w1');
    gate.destroy();
  });

  it('asks the background to whitelist, after confirmation', async () => {
    const whitelist = vi.fn(() => ({ url: 'https://evil.test/login' }));
    respondTo({ 'warning:details': () => details, 'warning:whitelist': whitelist });
    const gate = await start();
    const replace = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, search: '?id=w1', replace } as Location);
    const answer = async (choice: 'yes' | 'no') => {
      document.querySelector<HTMLButtonElement>('[data-action="whitelist"]')!.click();
      const button = await vi.waitFor(() => {
        const found = document.querySelector<HTMLButtonElement>(`.confirm-dialog [data-answer="${choice}"]`);
        if (!found) throw new Error('dialog not open yet');
        return found;
      });
      expect(text(document.querySelector('.confirm-dialog__title'))).toBe('Always trust evil.test?');
      button.click();
    };
    await answer('no');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(whitelist).not.toHaveBeenCalled();
    await answer('yes');
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('https://evil.test/login'));
    expect(whitelist).toHaveBeenCalledWith({ id: 'w1' });
    gate.destroy();
  });

  it('handles expired warnings safely', () => {
    renderWarning(document, null);
    expect(text(document.querySelector('[data-role="host"]'))).toBe('This warning has expired');
    expect(document.querySelector<HTMLButtonElement>('[data-action="continue"]')!.hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[data-action="whitelist"]')!.hidden).toBe(true);
  });

  it('Back to safety leaves the page', async () => {
    respondTo({ 'warning:details': () => details });
    chromeFake().tabs.getCurrent.mockResolvedValue({ id: 3 } as never);
    const gate = await start();
    document.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    await vi.waitFor(() => expect(chromeFake().tabs.update).toHaveBeenCalledWith(3, { url: 'chrome://newtab/' }));
    gate.destroy();
  });

  it('restarts the gate when the page is restored from the back/forward cache', async () => {
    respondTo({ 'warning:details': () => details });
    const gate = await start();
    const reset = vi.spyOn(gate, 'reset');
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(reset).toHaveBeenCalled();
    gate.destroy();
  });
});
