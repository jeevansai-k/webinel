import { describe, expect, it, vi } from 'vitest';
import { chromeFake, respondTo } from '../../../tests/setup/chromeMock';
import { mountScreen, setActiveTab, text } from '../../../tests/setup/screen';
import type { Verdict } from '../../shared/verdict';
import { bookmarkStore } from '../../storage/BookmarkStore';
import { mount } from './Bookmarks';

function scanReturns(verdict: Verdict) {
  respondTo({ 'scan:url': () => ({ verdict, host: 'bank.example', reasons: [`${verdict} now`] }) });
}

describe('Bookmarks screen', () => {
  it('bookmarks the current site', async () => {
    setActiveTab('https://bank.example/login', 'My Bank');
    const { root } = await mountScreen(mount);
    root.querySelector<HTMLButtonElement>('[data-action="add-current"]')!.click();
    await vi.waitFor(() => expect(text(root.querySelector('.list-row__title'))).toBe('My Bank'));
    expect(text(root.querySelector('.bookmark-row .chip'))).toBe('New');
  });

  it('re-checks a bookmark before opening it', async () => {
    await bookmarkStore.add('https://bank.example/', 'Bank');
    scanReturns('safe');
    const { root } = await mountScreen(mount);
    root.querySelector<HTMLElement>('.bookmark-row')!.click();
    await vi.waitFor(() => expect(chromeFake().tabs.create).toHaveBeenCalledWith({ url: 'https://bank.example/' }));
    expect((await bookmarkStore.get())[0]?.lastVerdict).toBe('safe');
  });

  it('refuses to open a bookmark that became dangerous', async () => {
    await bookmarkStore.add('https://bank.example/', 'Bank');
    scanReturns('dangerous');
    const { root } = await mountScreen(mount);
    root.querySelector<HTMLElement>('.bookmark-row')!.click();
    await vi.waitFor(async () => expect((await bookmarkStore.get())[0]?.lastVerdict).toBe('dangerous'));
    expect(chromeFake().tabs.create).not.toHaveBeenCalled();
  });

  it('asks in the popup (not window.confirm) before opening a suspicious bookmark', async () => {
    await bookmarkStore.add('https://bank.example/', 'Bank');
    scanReturns('suspicious');
    const nativeConfirm = vi.spyOn(window, 'confirm');
    const { root } = await mountScreen(mount);
    root.querySelector<HTMLElement>('.bookmark-row')!.click();
    const dialog = await vi.waitFor(() => {
      const found = document.querySelector('.confirm-dialog');
      if (!found) throw new Error('dialog not open yet');
      return found;
    });
    expect(text(dialog.querySelector('.confirm-dialog__message'))).toBe('suspicious now');
    expect(chromeFake().tabs.create).not.toHaveBeenCalled();
    dialog.querySelector<HTMLButtonElement>('[data-answer="yes"]')!.click();
    await vi.waitFor(() => expect(chromeFake().tabs.create).toHaveBeenCalledWith({ url: 'https://bank.example/' }));
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('removes bookmarks without opening them', async () => {
    await bookmarkStore.add('https://bank.example/', 'Bank');
    const { root } = await mountScreen(mount);
    root.querySelector<HTMLButtonElement>('[data-remove]')!.click();
    await vi.waitFor(() => expect(text(root.querySelector('[data-role="list"]'))).toContain('No secure bookmarks'));
    expect(chromeFake().runtime.sendMessage).not.toHaveBeenCalled();
  });
});
