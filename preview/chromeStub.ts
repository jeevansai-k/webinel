import { completedJob, fileReport, partialReport, phishingReport, runningJob } from './sampleReports';
/**
 * DEV ONLY — fake `chrome` so extension pages can be previewed in a normal
 * browser tab. Never bundled into the extension.
 */
const store = new Map<string, unknown>();
const params0 = () => new URLSearchParams(location.search);
const listeners = new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>();
const area = (name: string) => ({
  get: async (key: string) => (store.has(`${name}:${key}`) ? { [key]: structuredClone(store.get(`${name}:${key}`)) } : {}),
  set: async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) store.set(`${name}:${key}`, structuredClone(value));
    const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]));
    listeners.forEach((listener) => listener(changes, name));
  },
  remove: async (key: string) => void store.delete(`${name}:${key}`),
});

const now = Date.now();
const day = 86_400_000;
const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const scanned = [34, 52, 41, 67, 29, 58, 46];
store.set('local:activity', [
  { host: 'paypa1-secure-login.xyz', status: 'blocked', timestamp: now - 4 * 60_000 },
  { host: 'github.com', status: 'safe', timestamp: now - 12 * 60_000 },
  { host: 'bit.ly', status: 'warning', timestamp: now - 45 * 60_000 },
  { host: 'docs.python.org', status: 'safe', timestamp: now - 2 * 3_600_000 },
  { host: 'new-startup.io', status: 'unknown', timestamp: now - 5 * 3_600_000 },
]);
store.set('local:stats', {
  scanned: 327,
  verdicts: { safe: 281, suspicious: 14, dangerous: 6, unknown: 24, error: 2 },
  counters: { blocked: 6, warned: 14, bypassed: 1, cacheHits: 212, virusTotalRequests: 115, downloadsBlocked: 2, linksScanned: 48, filesScanned: 5 },
  daily: Object.fromEntries(scanned.map((n, i) => [dayKey(now - (6 - i) * day), { scanned: n, threats: i % 3 }])),
  since: now - 30 * day,
});
store.set('local:whitelist', ['intranet.corp.example', 'localhost']);
store.set('local:bookmarks', [
  { id: 'b1', title: 'Online Banking', url: 'https://bank.example/', host: 'bank.example', createdAt: now, lastVerdict: 'safe', lastCheckedAt: now - 3_600_000 },
  { id: 'b2', title: 'Tax portal', url: 'https://tax.example/', host: 'tax.example', createdAt: now, lastVerdict: null, lastCheckedAt: null },
]);
store.set('local:timeline', [
  { id: 't1', kind: 'blocked', subject: 'paypa1-secure-login.xyz', verdict: 'dangerous', detail: 'Looks like paypal but is not an official paypal domain', timestamp: now - 4 * 60_000 },
  { id: 't2', kind: 'download-paused', subject: 'setup.exe', verdict: 'suspicious', detail: 'Program file (.exe) — only run it if you trust the source', timestamp: now - 30 * 60_000 },
  { id: 't3', kind: 'manual-scan', subject: 'github.com', verdict: 'safe', detail: 'Full URL report', timestamp: now - 3_600_000 },
  { id: 't4', kind: 'whitelisted', subject: 'intranet.corp.example', verdict: null, detail: 'Added to whitelist', timestamp: now - day },
]);
store.set('local:settings', { theme: params0().get('theme') ?? 'dark', emailLinkScanner: true, clipboardScanner: true });

const report = {
  target: 'https://github.com/',
  host: 'github.com',
  scope: 'url',
  verdict: 'safe',
  action: 'allow',
  source: 'virustotal',
  heuristics: { score: 0, signals: [] },
  virusTotalStatus: 'ok',
  virusTotal: { stats: { malicious: 0, suspicious: 0, harmless: 67, undetected: 25 }, reputation: 1532, flaggedBy: [], lastAnalysisDate: now - day, permalink: 'https://www.virustotal.com/gui/url/x' },
  reasons: ['No security vendor flagged this on VirusTotal'],
  checkedAt: now,
};

const params = new URLSearchParams(location.search);
const variant = params.get('variant');
store.set('session:analysis.jobs', { [variant === 'running' ? runningJob.id : completedJob.id]: variant === 'running' ? runningJob : completedJob });

const responses: Record<string, (payload: any) => unknown> = {
  'scan:quick': async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (variant === 'nokey') return { kind: 'error', error: { code: 'missing-key', title: 'VirusTotal API key required.', message: 'Add your free VirusTotal API key in Settings to scan links and files. It stays on this device.', action: 'open-settings' } };
    return { kind: 'report', report: variant === 'partial' ? partialReport : phishingReport };
  },
  'file:lookup': async () => (variant === 'upload' ? { kind: 'needs-upload', sha256: fileReport.file!.sha256 } : { kind: 'report', report: fileReport }),
  'tab:current-report': () => (variant === 'danger' ? { ...report, verdict: 'dangerous', action: 'block' } : variant === 'warn' ? { ...report, verdict: 'suspicious', action: 'warn' } : report),
  'tab:redirects': () => [
    { from: 'bit.ly/3xYz', to: 't.co/abc', statusCode: 301, timestamp: now },
    { from: 't.co/abc', to: 'github.com/', statusCode: 302, timestamp: now },
  ],
  'scan:url': () => report,
  'apiKey:status': () => ({ configured: variant !== 'nokey' }),
  'api:health': () => ({ state: 'online', checkedAt: now, latencyMs: 184 }),
  'warning:details': () => ({
    id: 'demo',
    tabId: 1,
    url: 'https://paypa1-secure-login.xyz/signin',
    host: 'paypa1-secure-login.xyz',
    verdict: 'dangerous',
    reasons: ['Flagged by 11 security vendors on VirusTotal', 'Looks like paypal but is not an official paypal domain', 'Uses the .xyz extension, common in abuse'],
    createdAt: now,
  }),
};

(globalThis as any).chrome = {
  storage: { local: area('local'), session: area('session'), onChanged: { addListener: (l: any) => listeners.add(l), removeListener: (l: any) => listeners.delete(l) } },
  runtime: {
    id: 'preview',
    getURL: (path: string) => `/${path}`,
    getManifest: () => ({ version: '1.0.0' }),
    getPlatformInfo: async () => ({ os: 'linux' }),
    sendMessage: async (message: any) => ({ ok: true, data: await responses[message.type]?.(message.payload) }),
  },
  tabs: {
    query: async (filter: Record<string, unknown> = {}) => (Object.keys(filter).length ? [{ id: 1, url: 'https://github.com/', title: 'GitHub' }] : []),
    getCurrent: async () => undefined,
    create: async (options: unknown) => console.info('[preview] tabs.create', options),
    update: async (id: number, options: unknown) => console.info('[preview] tabs.update', id, options),
  },
  permissions: { request: async () => true },
  windows: {
    create: async (options: unknown) => console.info('[preview] windows.create', options),
    update: async () => undefined,
    getCurrent: async () => ({ id: 1 }),
  },
};
