import { describe, expect, it, vi } from 'vitest';
import { respondTo } from '../../../tests/setup/chromeMock';
import { mountScreen, setActiveTab, text } from '../../../tests/setup/screen';
import { whitelistStore } from '../../storage/WhitelistStore';
import { mount } from './Whitelist';

function backend() {
  respondTo({
    'whitelist:add': ({ host }: { host: string }) => whitelistStore.add(host),
    'whitelist:remove': ({ host }: { host: string }) => whitelistStore.remove(host),
  });
}

describe('Whitelist screen', () => {
  it('adds a typed domain and lists it', async () => {
    backend();
    const { root } = await mountScreen(mount);
    expect(text(root.querySelector('[data-role="list"]'))).toContain('No trusted sites yet');
    root.querySelector<HTMLInputElement>('[data-role="input"]')!.value = 'https://Intranet.example.com/x';
    root.querySelector<HTMLFormElement>('[data-role="form"]')!.requestSubmit();
    await vi.waitFor(() => expect(text(root.querySelector('[data-role="list"]'))).toBe('intranet.example.com'));
    expect(text(root.querySelector('[data-role="count"]'))).toBe('1');
  });

  it('removes entries', async () => {
    backend();
    await whitelistStore.add('keep.test');
    await whitelistStore.add('drop.test');
    const { root } = await mountScreen(mount);
    root.querySelector<HTMLButtonElement>('[data-remove="drop.test"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('[data-remove="drop.test"]')).toBeNull());
    expect(await whitelistStore.get()).toEqual(['keep.test']);
  });

  it('offers to trust the current site', async () => {
    backend();
    setActiveTab('https://portal.example/');
    const { root } = await mountScreen(mount);
    const button = root.querySelector<HTMLButtonElement>('[data-action="add-current"]')!;
    expect(button.hidden).toBe(false);
    expect(text(button)).toBe('Trust portal.example');
    button.click();
    await vi.waitFor(() => expect(button.hidden).toBe(true));
    expect(await whitelistStore.contains('portal.example')).toBe(true);
  });
});
