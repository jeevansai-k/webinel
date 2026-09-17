import { describe, expect, it, vi } from 'vitest';
import { dispatch, isExtensionPage, listen, type HandlerMap } from '../../src/background/MessageRouter';
import { isEnvelope, sendMessage, type Envelope } from '../../src/shared/messages';
import { chromeFake, onSendMessage } from '../setup/chromeMock';

const extensionSender: chrome.runtime.MessageSender = { id: 'webinel-test', url: 'chrome-extension://webinel-test/popup/index.html' };
const contentSender: chrome.runtime.MessageSender = {
  id: 'webinel-test',
  url: 'https://evil.test/',
  tab: { id: 3, url: 'https://evil.test/' } as chrome.tabs.Tab,
  frameId: 0,
};

function handlers(overrides: Partial<HandlerMap> = {}): HandlerMap {
  return new Proxy(overrides as HandlerMap, {
    get: (target, key: string) => target[key as keyof HandlerMap] ?? vi.fn(async () => ({ handled: key })),
  });
}

const envelope = <T extends Envelope['type']>(type: T, payload: unknown = {}) => ({ channel: 'webinel', type, payload }) as Envelope;

describe('background messaging', () => {
  it('recognises envelopes', () => {
    expect(isEnvelope(envelope('api:health'))).toBe(true);
    expect(isEnvelope({ type: 'api:health' })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
  });

  it('distinguishes extension pages from web pages', () => {
    expect(isExtensionPage(extensionSender)).toBe(true);
    expect(isExtensionPage(contentSender)).toBe(false);
    expect(isExtensionPage({ ...extensionSender, id: 'other-extension' })).toBe(false);
  });

  it('dispatches requests from extension pages', async () => {
    const reply = await dispatch(handlers({ 'apiKey:status': async () => ({ configured: true }) }), envelope('apiKey:status'), extensionSender);
    expect(reply).toEqual({ ok: true, data: { configured: true } });
  });

  it('only lets content scripts report page signals', async () => {
    const map = handlers();
    expect(await dispatch(map, envelope('apiKey:set', { key: 'x' }), contentSender)).toEqual({ ok: false, error: 'Not permitted from this context.' });
    expect(await dispatch(map, envelope('warning:continue', { id: 'x' }), contentSender)).toMatchObject({ ok: false });
    expect(await dispatch(map, envelope('page:signals', {}), contentSender)).toMatchObject({ ok: true });
  });

  it('rejects messages from other extensions', async () => {
    const reply = await dispatch(handlers(), envelope('page:signals', {}), { ...contentSender, id: 'intruder' });
    expect(reply).toMatchObject({ ok: false });
  });

  it('turns handler errors into error replies', async () => {
    const reply = await dispatch(
      handlers({ 'api:health': async () => Promise.reject(new Error('boom')) }),
      envelope('api:health'),
      extensionSender,
    );
    expect(reply).toEqual({ ok: false, error: 'boom' });
  });

  it('wires onMessage and replies asynchronously', async () => {
    listen(handlers({ 'apiKey:status': async () => ({ configured: false }) }));
    const [listener] = chromeFake().runtime.onMessage.addListener.mock.calls.at(-1) as [
      (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => boolean,
    ];
    const respond = vi.fn();
    expect(listener({ unrelated: true }, extensionSender, respond)).toBe(false);
    expect(listener(envelope('apiKey:status'), extensionSender, respond)).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true, data: { configured: false } }));
  });

  it('sendMessage unwraps replies and surfaces errors', async () => {
    onSendMessage(async (message: Envelope) =>
      message.type === 'api:health' ? { ok: true, data: { state: 'online' } } : { ok: false, error: 'nope' },
    );
    await expect(sendMessage('api:health', {})).resolves.toEqual({ state: 'online' });
    await expect(sendMessage('cache:clear', {})).rejects.toThrow('nope');
    onSendMessage(() => undefined);
    await expect(sendMessage('cache:clear', {})).rejects.toThrow(/did not respond/);
  });
});
