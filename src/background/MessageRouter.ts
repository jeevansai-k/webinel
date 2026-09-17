/**
 * Routes typed runtime messages to background handlers.
 * Only extension pages may call privileged handlers; content scripts may only
 * report page signals.
 */
import {
  isEnvelope,
  type Envelope,
  type MessageType,
  type Reply,
  type RequestOf,
  type ResponseOf,
} from '../shared/messages';
import { logger } from '../utils/logger';

export type Handler<T extends MessageType> = (
  payload: RequestOf<T>,
  sender: chrome.runtime.MessageSender,
) => Promise<ResponseOf<T>>;

export type HandlerMap = { [T in MessageType]: Handler<T> };

const CONTENT_SCRIPT_MESSAGES: ReadonlySet<MessageType> = new Set(['page:signals']);

export function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  // Compare against the base URL string: URL#origin is "null" for extension schemes in some engines.
  const extensionBase = chrome.runtime.getURL('');
  const senderUrl = sender.url ?? '';
  return senderUrl.startsWith(extensionBase);
}

export async function dispatch(
  handlers: HandlerMap,
  message: Envelope,
  sender: chrome.runtime.MessageSender,
): Promise<Reply<MessageType>> {
  const handler = handlers[message.type] as Handler<MessageType> | undefined;
  if (!handler) return { ok: false, error: `Unknown request: ${message.type}` };

  const fromContentScript = !isExtensionPage(sender);
  if (fromContentScript && !CONTENT_SCRIPT_MESSAGES.has(message.type)) {
    return { ok: false, error: 'Not permitted from this context.' };
  }
  if (sender.id !== chrome.runtime.id) return { ok: false, error: 'Not permitted from this context.' };

  try {
    return { ok: true, data: await handler(message.payload, sender) };
  } catch (error) {
    logger.warn(`Request ${message.type} failed`, error);
    return { ok: false, error: error instanceof Error ? error.message : 'Unexpected error' };
  }
}

export function listen(handlers: HandlerMap): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isEnvelope(message)) return false;
    void dispatch(handlers, message, sender).then(sendResponse);
    return true; // keep the channel open for the async reply
  });
}
