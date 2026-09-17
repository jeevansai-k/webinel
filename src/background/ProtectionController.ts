/**
 * Real-time protection: evaluates top-level navigations and applies
 * Allow / Warn / Block. Blocking redirects the tab to the warning page.
 */
import type { TabPageSignals, WarningDetails } from '../shared/messages';
import type { ThreatReport } from '../shared/verdict';
import type { ThreatEngine } from '../services/ThreatEngine';
import { activityStore, toActivityStatus } from '../storage/ActivityStore';
import { settingsStore } from '../storage/SettingsStore';
import { statsStore } from '../storage/StatsStore';
import { timelineStore } from '../storage/TimelineStore';
import { whitelistStore } from '../storage/WhitelistStore';
import { logger } from '../utils/logger';
import { getHost, isScannableUrl } from '../utils/url';
import { clearBadge, showVerdictBadge } from './Badge';
import {
  forgetTab,
  getTabEntry,
  grantTemporaryBypass,
  hasTemporaryBypass,
  pendingWarnings,
  setTabEntry,
  tabReports,
  tabSignals,
} from './SessionState';

export const WARNING_PAGE_PATH = 'warning/Warning.html';

/** Repeated events for the same navigation within this window are handled once. */
const DUPLICATE_WINDOW_MS = 10_000;

interface TabNavigation {
  url: string;
  seq: number;
  startedAt: number;
  pending: Promise<ThreatReport | null>;
}

export class ProtectionController {
  /**
   * The latest navigation per tab, tracked from navigation events themselves.
   * `chrome.tabs.get()` is not used for this: right after navigation starts it can
   * still report the previous page (e.g. chrome://newtab), which used to cancel blocks.
   */
  private readonly navigations = new Map<number, TabNavigation>();
  private sequence = 0;

  constructor(
    private readonly engine: ThreatEngine,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Called from several browser events (before-navigate, committed, tab URL change);
   * the same navigation is evaluated once. `force` re-evaluates (new page signals).
   */
  handleNavigation(tabId: number, url: string, options: { force?: boolean } = {}): Promise<ThreatReport | null> {
    const current = this.navigations.get(tabId);
    if (!options.force && current && current.url === url && this.now() - current.startedAt < DUPLICATE_WINDOW_MS) {
      return current.pending;
    }
    const seq = ++this.sequence;
    const navigation: TabNavigation = { url, seq, startedAt: this.now(), pending: Promise.resolve(null) };
    this.navigations.set(tabId, navigation);
    navigation.pending = this.evaluateNavigation(tabId, url, seq);
    return navigation.pending;
  }

  private isCurrent(tabId: number, seq: number): boolean {
    return this.navigations.get(tabId)?.seq === seq;
  }

  private async evaluateNavigation(tabId: number, url: string, seq: number): Promise<ThreatReport | null> {
    if (!isScannableUrl(url)) {
      await clearBadge(tabId);
      return null;
    }
    const settings = await settingsStore.get();
    if (!settings.realTimeProtection) {
      await clearBadge(tabId);
      return null;
    }
    try {
      const signals = (await getTabEntry(tabSignals, tabId)) ?? undefined;
      const report = await this.engine.evaluate(url, 'domain', { pageSignals: signals });
      // The user may have navigated elsewhere while the scan was running.
      if (!this.isCurrent(tabId, seq)) return report;
      await this.apply(tabId, url, report, seq);
      return report;
    } catch (error) {
      logger.warn('Navigation scan failed', error);
      return null;
    }
  }

  /** Content-script signals can escalate a verdict after the page has loaded. */
  async handlePageSignals(tabId: number, url: string, signals: TabPageSignals): Promise<void> {
    await setTabEntry(tabSignals, tabId, signals);
    const previous = await getTabEntry(tabReports, tabId);
    const escalates = signals.passwordFieldOnInsecurePage || signals.passwordFormPostsToOtherHost;
    if (escalates && previous?.host === getHost(url)) await this.handleNavigation(tabId, url, { force: true });
  }

  async currentReport(tabId: number): Promise<ThreatReport | null> {
    return getTabEntry(tabReports, tabId);
  }

  async forget(tabId: number): Promise<void> {
    this.navigations.delete(tabId);
    await forgetTab(tabId);
  }

  async continueAnyway(warningId: string): Promise<string> {
    const warning = await this.takeWarning(warningId);
    await grantTemporaryBypass(warning.host);
    await statsStore.increment('bypassed');
    await timelineStore.record({
      kind: 'bypassed',
      subject: warning.host,
      verdict: warning.verdict,
      detail: 'Continued past the warning (allowed for 30 minutes)',
    });
    return warning.url;
  }

  async whitelistFromWarning(warningId: string): Promise<string> {
    const warning = await this.takeWarning(warningId);
    await whitelistStore.add(warning.host);
    await timelineStore.record({
      kind: 'whitelisted',
      subject: warning.host,
      verdict: warning.verdict,
      detail: 'Whitelisted from the warning page',
    });
    return warning.url;
  }

  async warningDetails(warningId: string): Promise<WarningDetails | null> {
    return (await pendingWarnings.get())[warningId] ?? null;
  }

  private async takeWarning(warningId: string): Promise<WarningDetails> {
    const warning = await this.warningDetails(warningId);
    if (!warning) throw new Error('This warning has expired. Reload the page to try again.');
    await pendingWarnings.update((entries) => {
      const { [warningId]: _used, ...rest } = entries;
      return rest;
    });
    return warning;
  }

  private async apply(tabId: number, url: string, report: ThreatReport, seq: number): Promise<void> {
    await setTabEntry(tabReports, tabId, report);
    await showVerdictBadge(tabId, report.verdict, report.action);

    const bypassed = report.action !== 'allow' && (await hasTemporaryBypass(report.host));
    const action = bypassed ? 'allow' : report.action;
    await activityStore.record({ host: report.host, status: toActivityStatus(report.verdict, action), timestamp: report.checkedAt });

    if (action === 'warn') {
      await statsStore.increment('warned');
      await timelineStore.record({
        kind: 'warned',
        subject: report.host,
        verdict: report.verdict,
        detail: report.reasons[0] ?? 'Suspicious site',
      });
    }
    if (action === 'block') await this.block(tabId, url, report, seq);
  }

  private async block(tabId: number, url: string, report: ThreatReport, seq: number): Promise<void> {
    if (!this.isCurrent(tabId, seq)) return;

    const warning: WarningDetails = {
      id: crypto.randomUUID(),
      tabId,
      url,
      host: report.host,
      verdict: report.verdict,
      reasons: report.reasons.slice(0, 5),
      createdAt: Date.now(),
    };
    await pendingWarnings.update((entries) => ({ ...entries, [warning.id]: warning }));
    if (!this.isCurrent(tabId, seq)) return;
    const warningUrl = `${chrome.runtime.getURL(WARNING_PAGE_PATH)}?id=${encodeURIComponent(warning.id)}`;
    // Mark the tab as moving to the warning page, so returning to the blocked URL is checked again.
    this.navigations.set(tabId, { url: warningUrl, seq: ++this.sequence, startedAt: this.now(), pending: Promise.resolve(null) });
    try {
      await chrome.tabs.update(tabId, { url: warningUrl });
    } catch (error) {
      logger.warn('Could not show the warning page', error);
      return;
    }
    await statsStore.increment('blocked');
    await timelineStore.record({
      kind: 'blocked',
      subject: report.host,
      verdict: report.verdict,
      detail: report.reasons[0] ?? 'Dangerous site blocked',
    });
  }
}
