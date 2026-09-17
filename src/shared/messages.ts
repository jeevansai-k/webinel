/**
 * Typed request/response contract between UI contexts and the background.
 * The background is the only context that reads the API key or calls the network.
 */
import type { FileMeta, ScanOutcome } from './scan';
import type {
  ApiHealth,
  LinkScanSummary,
  RedirectHop,
  ScanScope,
  ThreatReport,
  Verdict,
} from './verdict';

export interface TabPageSignals {
  hasPasswordField: boolean;
  passwordFormPostsToOtherHost: boolean;
  passwordFieldOnInsecurePage: boolean;
  metaRefreshTarget: string | null;
}

/** A pending interception, stored in session storage and referenced by an opaque id. */
export interface WarningDetails {
  id: string;
  tabId: number;
  url: string;
  host: string;
  verdict: Verdict;
  reasons: string[];
  createdAt: number;
}

export interface MessageMap {
  'scan:url': { request: { url: string; scope: ScanScope; force?: boolean }; response: ThreatReport };
  'scan:links': { request: { urls: string[] }; response: LinkScanSummary };
  /** Scan Now: returns within ~6 seconds, partial results allowed. */
  'scan:quick': { request: { url: string }; response: ScanOutcome };
  /** Advanced Analysis: starts a background job; progress lives in session storage. */
  'analysis:start-url': { request: { url: string }; response: ScanOutcome | { kind: 'job'; jobId: string } };
  'analysis:cancel': { request: { jobId: string }; response: { cancelled: boolean } };
  /** Document Scanner: SHA-256 lookup only. */
  'file:lookup': { request: FileMeta; response: ScanOutcome };
  /** Document Scanner: upload a staged file. `consent` must be true. */
  'file:upload': { request: { meta: FileMeta; stagingId: string; consent: boolean }; response: ScanOutcome | { kind: 'job'; jobId: string } };
  'tab:current-report': { request: { tabId: number }; response: ThreatReport | null };
  'tab:redirects': { request: { tabId: number }; response: RedirectHop[] };
  'page:signals': { request: TabPageSignals; response: { received: true } };
  'whitelist:add': { request: { host: string }; response: string[] };
  'whitelist:remove': { request: { host: string }; response: string[] };
  'warning:details': { request: { id: string }; response: WarningDetails | null };
  'warning:continue': { request: { id: string }; response: { url: string } };
  'warning:whitelist': { request: { id: string }; response: { url: string } };
  'apiKey:status': { request: Record<string, never>; response: { configured: boolean } };
  'apiKey:set': { request: { key: string }; response: { saved: boolean; error?: string } };
  'apiKey:clear': { request: Record<string, never>; response: { configured: false } };
  'api:health': { request: Record<string, never>; response: ApiHealth };
  'cache:clear': { request: Record<string, never>; response: { cleared: number } };
}

export type MessageType = keyof MessageMap;
export type RequestOf<T extends MessageType> = MessageMap[T]['request'];
export type ResponseOf<T extends MessageType> = MessageMap[T]['response'];

export interface Envelope<T extends MessageType = MessageType> {
  channel: 'webinel';
  type: T;
  payload: RequestOf<T>;
}

export type Reply<T extends MessageType> =
  | { ok: true; data: ResponseOf<T> }
  | { ok: false; error: string };

export function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Envelope).channel === 'webinel' &&
    typeof (value as Envelope).type === 'string'
  );
}

/** Sends a typed message to the background and unwraps the reply. */
export async function sendMessage<T extends MessageType>(type: T, payload: RequestOf<T>): Promise<ResponseOf<T>> {
  const envelope: Envelope<T> = { channel: 'webinel', type, payload };
  const reply = (await chrome.runtime.sendMessage(envelope)) as Reply<T> | undefined;
  if (!reply) throw new Error('Webinel background did not respond.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
