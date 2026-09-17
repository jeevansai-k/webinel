/**
 * Webinel background service worker — the only context that holds the API key
 * or talks to VirusTotal.
 */
import { toScanErrorInfo } from '../shared/scanErrors';
import { SecretStore } from '../storage/SecretStore';
import { FileScanner } from '../services/FileScanner';
import { ThreatEngine } from '../services/ThreatEngine';
import { indexedDbStaging } from '../services/UploadStaging';
import { UrlScanner } from '../services/UrlScanner';
import { VirusTotalService } from '../services/VirusTotalService';
import { statsStore } from '../storage/StatsStore';
import { timelineStore } from '../storage/TimelineStore';
import { normalizeWhitelistEntry, whitelistStore } from '../storage/WhitelistStore';
import { AnalysisJobs } from './AnalysisJobs';
import { DownloadGuard } from './DownloadGuard';
import { listen, type HandlerMap } from './MessageRouter';
import { ProtectionController } from './ProtectionController';
import { RedirectTracker } from './RedirectTracker';

const secrets = new SecretStore();
const virusTotal = new VirusTotalService({ secrets });
const engine = new ThreatEngine(virusTotal);
const protection = new ProtectionController(engine);
const downloads = new DownloadGuard(engine);
const redirects = new RedirectTracker();
const urlScanner = new UrlScanner(virusTotal);
const fileScanner = new FileScanner(virusTotal);
const jobs = new AnalysisJobs(urlScanner, fileScanner, indexedDbStaging);
void jobs.recoverInterrupted();

/** Starts a job, turning validation failures into a friendly error outcome. */
async function startJob(start: () => Promise<string>) {
  try {
    return { kind: 'job' as const, jobId: await start() };
  } catch (error) {
    return { kind: 'error' as const, error: toScanErrorInfo(error) };
  }
}

const handlers: HandlerMap = {
  'scan:url': async ({ url, scope, force }) => {
    const report = await engine.evaluate(url, scope, { force });
    await timelineStore.record({
      kind: 'manual-scan',
      subject: report.host,
      verdict: report.verdict,
      detail: scope === 'url' ? 'Full URL report' : 'Site scan',
    });
    return report;
  },
  'scan:links': async ({ urls }) => {
    const summary = await engine.scanLinks(urls);
    await timelineStore.record({
      kind: 'links-scanned',
      subject: `${summary.total} link${summary.total === 1 ? '' : 's'}`,
      verdict: summary.counts.dangerous ? 'dangerous' : summary.counts.suspicious ? 'suspicious' : null,
      detail: `${summary.counts.dangerous} dangerous · ${summary.counts.suspicious} suspicious · ${summary.counts.unknown} unknown`,
    });
    return summary;
  },
  'scan:quick': async ({ url }) => {
    const outcome = await urlScanner.quickScan(url);
    if (outcome.kind === 'report') {
      const { report } = outcome;
      await statsStore.increment('quickScans');
      await timelineStore.record({
        kind: 'manual-scan',
        subject: report.url?.domain ?? 'URL',
        verdict: report.verdict,
        detail: `Scan Now · ${report.ratio.detected}/${report.ratio.total} flagged${report.state === 'complete' ? '' : ' (analysis still running)'}`,
      });
    }
    return outcome;
  },
  'analysis:start-url': ({ url }) => startJob(() => jobs.startUrl(url)),
  'analysis:cancel': async ({ jobId }) => ({ cancelled: await jobs.cancel(jobId) }),
  'file:lookup': async (meta) => {
    const outcome = await fileScanner.lookup(meta);
    await statsStore.increment('filesScanned');
    if (outcome.kind !== 'error') {
      await timelineStore.record({
        kind: 'file-scanned',
        subject: meta.fileName.slice(0, 80),
        verdict: outcome.kind === 'report' ? outcome.report.verdict : 'unknown',
        detail: outcome.kind === 'report' ? 'Fingerprint matched on VirusTotal' : 'Fingerprint unknown to VirusTotal',
      });
    }
    return outcome;
  },
  'file:upload': ({ meta, stagingId, consent }) => startJob(() => jobs.startFileUpload(meta, stagingId, consent)),
  'tab:current-report': ({ tabId }) => protection.currentReport(tabId),
  'tab:redirects': ({ tabId }) => redirects.chainFor(tabId),
  'page:signals': async (signals, sender) => {
    if (sender.tab?.id !== undefined && sender.tab.url && sender.frameId === 0) {
      await protection.handlePageSignals(sender.tab.id, sender.tab.url, signals);
    }
    return { received: true };
  },
  'whitelist:add': async ({ host }) => {
    const entries = await whitelistStore.add(host);
    const added = normalizeWhitelistEntry(host) ?? host;
    await timelineStore.record({ kind: 'whitelisted', subject: added, verdict: null, detail: 'Added to whitelist' });
    return entries;
  },
  'whitelist:remove': async ({ host }) => {
    const entries = await whitelistStore.remove(host);
    await timelineStore.record({ kind: 'unwhitelisted', subject: host, verdict: null, detail: 'Removed from whitelist' });
    return entries;
  },
  'warning:details': ({ id }) => protection.warningDetails(id),
  'warning:continue': async ({ id }) => ({ url: await protection.continueAnyway(id) }),
  'warning:whitelist': async ({ id }) => ({ url: await protection.whitelistFromWarning(id) }),
  'apiKey:status': async () => ({ configured: await secrets.hasApiKey() }),
  'apiKey:set': async ({ key }) => {
    try {
      await secrets.saveApiKey(key);
      await virusTotal.cache.clear();
      await timelineStore.record({ kind: 'api-key-changed', subject: 'VirusTotal', verdict: null, detail: 'API key updated' });
      return { saved: true };
    } catch (error) {
      return { saved: false, error: error instanceof Error ? error.message : 'Could not save the key.' };
    }
  },
  'apiKey:clear': async () => {
    await secrets.clearApiKey();
    await timelineStore.record({ kind: 'api-key-changed', subject: 'VirusTotal', verdict: null, detail: 'API key removed' });
    return { configured: false };
  },
  'api:health': () => virusTotal.checkHealth(),
  'cache:clear': async () => ({ cleared: await virusTotal.cache.clear() }),
};

listen(handlers);

// Real-time protection. Several events report the same navigation; the controller
// evaluates each navigation once. The later events catch navigations Chrome reports
// late or without onBeforeNavigate (e.g. prerendered pages, history changes).
chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
  if (frameId === 0 && tabId >= 0) void protection.handleNavigation(tabId, url);
});
chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, url }) => {
  if (frameId === 0 && tabId >= 0) void protection.handleNavigation(tabId, url);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) void protection.handleNavigation(tabId, changeInfo.url);
});
chrome.webNavigation.onTabReplaced.addListener(({ replacedTabId }) => void protection.forget(replacedTabId));

chrome.tabs.onRemoved.addListener((tabId) => void protection.forget(tabId));

chrome.webRequest.onBeforeRedirect.addListener(
  ({ requestId, url, redirectUrl, statusCode }) => redirects.onRedirect(requestId, url, redirectUrl, statusCode),
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
);
chrome.webRequest.onCompleted.addListener(
  ({ requestId, tabId }) => void redirects.onRequestFinished(requestId, tabId),
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
);
chrome.webRequest.onErrorOccurred.addListener(
  ({ requestId, tabId }) => void redirects.onRequestFinished(requestId, tabId),
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
);

chrome.downloads.onCreated.addListener((item) => void downloads.inspect(item));
