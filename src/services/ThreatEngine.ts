/**
 * Threat pipeline: Whitelist → Heuristics → Smart Cache → VirusTotal → Decision.
 */
import { LIMITS } from '../shared/config';
import type { TabPageSignals } from '../shared/messages';
import {
  emptyVerdictCounts,
  type LinkScanItem,
  type LinkScanSummary,
  type ScanScope,
  type ThreatReport,
} from '../shared/verdict';
import { settingsStore } from '../storage/SettingsStore';
import { statsStore } from '../storage/StatsStore';
import { whitelistStore } from '../storage/WhitelistStore';
import { getHost, normalizeUrl } from '../utils/url';
import { decide, verdictFromVirusTotal } from './DecisionEngine';
import { analyzeUrl } from './HeuristicEngine';
import { unwrapTrackingRedirect } from './LinkExtractor';
import type { VirusTotalService } from './VirusTotalService';

export interface EvaluateOptions {
  force?: boolean;
  pageSignals?: TabPageSignals;
  /** Count the result in Statistics (default true). */
  record?: boolean;
}

export class ThreatEngine {
  constructor(private readonly virusTotal: VirusTotalService) {}

  async evaluate(rawUrl: string, scope: ScanScope, options: EvaluateOptions = {}): Promise<ThreatReport> {
    const normalized = normalizeUrl(rawUrl);
    const host = normalized ? getHost(normalized) : null;
    if (!normalized || !host) throw new Error('Only http(s) addresses can be scanned.');

    const target = scope === 'domain' ? host : normalized;
    const heuristics = analyzeUrl(normalized, options.pageSignals);
    const checkedAt = Date.now();

    if (await whitelistStore.contains(host)) {
      return {
        target,
        host,
        scope,
        verdict: 'safe',
        action: 'allow',
        source: 'whitelist',
        heuristics,
        virusTotalStatus: 'ok',
        virusTotal: null,
        reasons: ['You added this site to your whitelist'],
        checkedAt,
      };
    }

    const lookup = await this.virusTotal.lookup(scope, target, { force: options.force });
    const settings = await settingsStore.get();
    // A stale cached copy may keep a threat blocked while offline, but it never vouches for safety.
    const staleVerdict = lookup.stale ? verdictFromVirusTotal(lookup.status, lookup.summary) : null;
    const trustedLookup =
      lookup.stale && staleVerdict !== 'dangerous' && staleVerdict !== 'suspicious'
        ? { status: lookup.failure ?? 'unreachable', summary: null }
        : { status: lookup.status, summary: lookup.summary };
    const decision = decide({
      heuristics,
      virusTotalStatus: trustedLookup.status,
      virusTotal: trustedLookup.summary,
      blockSuspicious: settings.blockSuspicious,
    });

    if (options.record !== false) await statsStore.recordVerdict(decision.verdict, checkedAt);

    return {
      target,
      host,
      scope,
      verdict: decision.verdict,
      action: decision.action,
      source: lookup.fromCache ? 'cache' : lookup.status === 'ok' ? 'virustotal' : 'heuristics',
      heuristics,
      virusTotalStatus: trustedLookup.status,
      virusTotal: trustedLookup.summary,
      reasons: decision.reasons,
      checkedAt,
    };
  }

  /**
   * Email Link Scanner / Document links: URLs only, never page or message bodies.
   * Uses domain-level lookups so one VirusTotal request covers every link on a host.
   */
  async scanLinks(rawUrls: string[]): Promise<LinkScanSummary> {
    const urls = [...new Set(rawUrls.map((url) => normalizeUrl(unwrapTrackingRedirect(url))).filter((url): url is string => url !== null))].slice(
      0,
      LIMITS.linksPerScan,
    );
    const items: LinkScanItem[] = [];
    for (const url of urls) {
      const report = await this.evaluate(url, 'domain', { record: false });
      items.push({ url, host: report.host, verdict: report.verdict, reasons: report.reasons.slice(0, 3) });
    }
    const counts = emptyVerdictCounts();
    for (const item of items) counts[item.verdict] += 1;
    await statsStore.increment('linksScanned', items.length);

    const severity = { dangerous: 0, suspicious: 1, error: 2, unknown: 3, safe: 4 } as const;
    items.sort((a, b) => severity[a.verdict] - severity[b.verdict]);
    return { total: items.length, counts, items };
  }
}
