/**
 * Pure parsers that turn VirusTotal v3 JSON into Webinel's scan model.
 * No network, no storage — easy to test with recorded payloads.
 */
import { VIRUSTOTAL } from '../shared/config';
import type {
  CertificateInfo,
  DetectionRatio,
  DnsRecord,
  DomainIntel,
  ScanCore,
  VendorResult,
  VendorVerdict,
  Votes,
  WhoisField,
} from '../shared/scan';
import type { VirusTotalStats, VirusTotalSummary } from '../shared/verdict';
import { getRegistrableDomain } from '../utils/domain';
import { getHost } from '../utils/url';

type Json = Record<string, unknown>;

export interface EngineResult {
  category?: string;
  engine_name?: string;
  result?: string | null;
}

const asRecord = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {});
const asString = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const asSeconds = (value: unknown): number | null => {
  const seconds = asNumber(value);
  return seconds === null ? null : seconds * 1000;
};

// ---------------------------------------------------------------- vendors

const VENDOR_ORDER: Record<VendorVerdict, number> = { malicious: 0, suspicious: 1, clean: 2, undetected: 3 };

export function vendorVerdict(category: string | undefined): VendorVerdict {
  switch (category) {
    case 'malicious':
      return 'malicious';
    case 'suspicious':
      return 'suspicious';
    case 'harmless':
      return 'clean';
    default:
      return 'undetected'; // undetected, timeout, type-unsupported, failure…
  }
}

/** Builds the vendor table dynamically — no vendor names are hard-coded. */
export function parseVendors(results: unknown): VendorResult[] {
  return Object.entries(asRecord(results))
    .map(([key, value]) => {
      const result = asRecord(value) as EngineResult;
      const category = typeof result.category === 'string' ? result.category : 'undetected';
      const label = asString(result.result);
      return {
        engine: asString(result.engine_name) ?? key,
        verdict: vendorVerdict(category),
        category,
        // "clean"/"unrated" labels add nothing; keep only meaningful vendor labels.
        label: label && !/^(clean|unrated|harmless|undetected)$/i.test(label) ? label : null,
      };
    })
    .sort((a, b) => VENDOR_ORDER[a.verdict] - VENDOR_ORDER[b.verdict] || a.engine.localeCompare(b.engine));
}

export function parseStats(value: unknown): VirusTotalStats {
  const stats = asRecord(value);
  return {
    malicious: asNumber(stats.malicious) ?? 0,
    suspicious: asNumber(stats.suspicious) ?? 0,
    harmless: asNumber(stats.harmless) ?? 0,
    undetected: asNumber(stats.undetected) ?? 0,
  };
}

/** "5 / 93": engines that flagged it as malicious out of engines that gave a verdict. */
export function detectionRatio(stats: VirusTotalStats): DetectionRatio {
  return {
    detected: stats.malicious,
    total: stats.malicious + stats.suspicious + stats.harmless + stats.undetected,
  };
}

function parseVotes(value: unknown): Votes | null {
  const votes = asRecord(value);
  const harmless = asNumber(votes.harmless);
  const malicious = asNumber(votes.malicious);
  return harmless === null && malicious === null ? null : { harmless: harmless ?? 0, malicious: malicious ?? 0 };
}

function uniqueCategories(value: unknown): string[] {
  const values = Object.values(asRecord(value)).filter((item): item is string => typeof item === 'string');
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .slice(0, 12);
}

// ---------------------------------------------------------------- threats

const THREAT_KEYWORDS: Array<[RegExp, string]> = [
  [/phish/i, 'Phishing'],
  [/ransom/i, 'Ransomware'],
  [/trojan/i, 'Trojan'],
  [/(steal|credential|password|banker|infostealer)/i, 'Credential Theft'],
  [/(backdoor|\brat\b)/i, 'Backdoor'],
  [/spy/i, 'Spyware'],
  [/worm/i, 'Worm'],
  [/(miner|coinmin|cryptojack)/i, 'Cryptominer'],
  [/exploit/i, 'Exploit'],
  [/adware/i, 'Adware'],
  [/(\bpua\b|\bpup\b|unwanted)/i, 'Potentially Unwanted'],
  [/spam/i, 'Spam'],
  [/(malware|malicious|virus)/i, 'Malware'],
  [/suspicious/i, 'Suspicious'],
];

/** Turns vendor labels / threat names into a short, ranked classification list. */
export function classifyThreats(labels: Array<string | null | undefined>): string[] {
  const counts = new Map<string, number>();
  for (const label of labels) {
    if (!label) continue;
    for (const [pattern, name] of THREAT_KEYWORDS) {
      if (pattern.test(label)) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        break;
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 6);
}

// ---------------------------------------------------------------- summaries

export function summaryFrom(stats: VirusTotalStats, vendors: VendorResult[], reputation: number | null, lastAnalysisDate: number | null, permalink: string): VirusTotalSummary {
  return {
    stats,
    reputation: reputation ?? 0,
    flaggedBy: vendors.filter((vendor) => vendor.verdict === 'malicious' || vendor.verdict === 'suspicious').map((vendor) => vendor.engine).slice(0, 12),
    lastAnalysisDate,
    permalink,
  };
}

// ---------------------------------------------------------------- objects

function headerValue(headers: unknown, name: string): string | null {
  for (const [key, value] of Object.entries(asRecord(headers))) {
    if (key.toLowerCase() === name) return asString(value);
  }
  return null;
}

export function parseUrlObject(body: unknown, requestedUrl: string): ScanCore {
  const data = asRecord(asRecord(body).data);
  const attributes = asRecord(data.attributes);
  const id = asString(data.id);
  const stats = parseStats(attributes.last_analysis_stats);
  const vendors = parseVendors(attributes.last_analysis_results);
  const url = asString(attributes.url) ?? requestedUrl;
  const finalUrl = asString(attributes.last_final_url);
  const hops = Array.isArray(attributes.redirection_chain)
    ? attributes.redirection_chain.filter((item): item is string => typeof item === 'string')
    : [];
  if (finalUrl && hops.at(-1) !== finalUrl) hops.push(finalUrl);
  return {
    stats,
    vendors,
    ratio: detectionRatio(stats),
    reputation: asNumber(attributes.reputation),
    votes: parseVotes(attributes.total_votes),
    firstSeen: asSeconds(attributes.first_submission_date),
    lastAnalysisDate: asSeconds(attributes.last_analysis_date),
    permalink: id ? `${VIRUSTOTAL.guiUrl}/url/${id}` : null,
    categories: uniqueCategories(attributes.categories),
    threats: classifyThreats([
      ...(Array.isArray(attributes.threat_names) ? (attributes.threat_names as string[]) : []),
      ...vendors.map((vendor) => vendor.label),
    ]),
    url: {
      url,
      finalUrl: finalUrl && finalUrl !== url ? finalUrl : null,
      domain: getHost(url) ?? '',
      title: asString(attributes.title),
      httpStatus: asNumber(attributes.last_http_response_code),
      contentType: headerValue(attributes.last_http_response_headers, 'content-type'),
      ipAddresses: [],
      redirectChain: hops.length > 1 ? hops.slice(0, 20) : [],
    },
    file: null,
  };
}

export function parseFileObject(body: unknown, sha256: string, fileName: string): ScanCore {
  const data = asRecord(asRecord(body).data);
  const attributes = asRecord(data.attributes);
  const stats = parseStats(attributes.last_analysis_stats);
  const vendors = parseVendors(attributes.last_analysis_results);
  const classification = asRecord(attributes.popular_threat_classification);
  const categories = Array.isArray(classification.popular_threat_category)
    ? (classification.popular_threat_category as unknown[]).map((item) => asString(asRecord(item).value))
    : [];
  return {
    stats,
    vendors,
    ratio: detectionRatio(stats),
    reputation: asNumber(attributes.reputation),
    votes: parseVotes(attributes.total_votes),
    firstSeen: asSeconds(attributes.first_submission_date),
    lastAnalysisDate: asSeconds(attributes.last_analysis_date),
    permalink: `${VIRUSTOTAL.guiUrl}/file/${sha256}`,
    categories: [],
    threats: classifyThreats([asString(classification.suggested_threat_label), ...categories, ...vendors.map((vendor) => vendor.label)]),
    url: null,
    file: {
      fileName,
      sha256,
      mimeType: asString(asRecord(attributes.exiftool).MIMEType),
      fileType: asString(attributes.type_description) ?? asString(attributes.type_tag),
      size: asNumber(attributes.size),
    },
  };
}

function formatDn(value: unknown): string | null {
  const dn = asRecord(value);
  const organisation = asString(dn.O);
  const common = asString(dn.CN);
  if (organisation && common && organisation !== common) return `${organisation} (${common})`;
  return organisation ?? common;
}

function parseCertDate(value: unknown): number | null {
  const text = asString(value);
  if (!text) return null;
  const time = Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(time) ? null : time;
}

export function parseCertificate(value: unknown): CertificateInfo | null {
  const cert = asRecord(value);
  if (Object.keys(cert).length === 0) return null;
  const validity = asRecord(cert.validity);
  return {
    issuer: formatDn(cert.issuer) ?? 'Unknown issuer',
    subject: formatDn(cert.subject),
    validFrom: parseCertDate(validity.not_before),
    validTo: parseCertDate(validity.not_after),
    fingerprint: asString(cert.thumbprint_sha256) ?? asString(cert.thumbprint),
  };
}

const DNS_TYPES = new Set(['A', 'AAAA', 'MX', 'NS']);

export function parseDnsRecords(value: unknown): DnsRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .filter((record) => DNS_TYPES.has(String(record.type)))
    .map((record) => {
      const priority = asNumber(record.priority);
      const raw = asString(record.value) ?? '';
      return { type: String(record.type), value: priority !== null ? `${priority} ${raw}` : raw, ttl: asNumber(record.ttl) };
    })
    .filter((record) => record.value)
    .slice(0, 40);
}

const WHOIS_FIELDS: Array<[RegExp, string]> = [
  [/^registrar$/i, 'Registrar'],
  [/^(creation date|created|registered on|domain registration date)$/i, 'Created'],
  [/^(updated date|last updated|changed)$/i, 'Updated'],
  [/^(registry expiry date|registrar registration expiration date|expiration date|expiry date|expires on|paid-till)$/i, 'Expires'],
  [/^(registrant organization|registrant organisation|org)$/i, 'Registrant'],
  [/^(registrant country|country)$/i, 'Country'],
  [/^(name server|nserver)$/i, 'Name servers'],
  [/^dnssec$/i, 'DNSSEC'],
];

/** Keeps only meaningful WHOIS fields; privacy-redaction noise is dropped. */
export function parseWhois(text: unknown): WhoisField[] {
  const raw = asString(text);
  if (!raw) return [];
  const fields = new Map<string, string[]>();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([^:]{2,60}):\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (/redacted|privacy|not disclosed|data protected/i.test(value!)) continue;
    const entry = WHOIS_FIELDS.find(([pattern]) => pattern.test(key!.trim()));
    if (!entry) continue;
    const values = fields.get(entry[1]) ?? [];
    const cleaned = value!.toLowerCase().startsWith('http') ? value! : value!.replace(/T00:00:00(\.0+)?Z$/, '');
    if (!values.includes(cleaned)) values.push(cleaned);
    fields.set(entry[1], values);
  }
  return WHOIS_FIELDS.map(([, label]) => label)
    .filter((label) => fields.has(label))
    .map((label) => ({ label, value: fields.get(label)!.slice(0, label === 'Name servers' ? 4 : 1).join(', ') }));
}

export function parseDomainObject(body: unknown, host: string): DomainIntel {
  const attributes = asRecord(asRecord(asRecord(body).data).attributes);
  const dns = parseDnsRecords(attributes.last_dns_records);
  return {
    domain: getRegistrableDomain(host),
    ipAddresses: dns.filter((record) => record.type === 'A' || record.type === 'AAAA').map((record) => record.value).slice(0, 6),
    dns,
    certificate: parseCertificate(attributes.last_https_certificate),
    whois: parseWhois(attributes.whois),
    categories: uniqueCategories(attributes.categories),
    reputation: asNumber(attributes.reputation),
  };
}

export interface AnalysisSnapshot {
  status: 'queued' | 'in-progress' | 'completed';
  stats: VirusTotalStats;
  vendors: VendorResult[];
  date: number | null;
  url: string | null;
  sha256: string | null;
}

export function parseAnalysis(body: unknown): AnalysisSnapshot {
  const root = asRecord(body);
  const attributes = asRecord(asRecord(root.data).attributes);
  const meta = asRecord(root.meta);
  const status = asString(attributes.status);
  return {
    status: status === 'completed' ? 'completed' : status === 'in-progress' ? 'in-progress' : 'queued',
    stats: parseStats(attributes.stats),
    vendors: parseVendors(attributes.results),
    date: asSeconds(attributes.date),
    url: asString(asRecord(meta.url_info).url),
    sha256: asString(asRecord(meta.file_info).sha256),
  };
}

export function analysisIdFrom(body: unknown): string | null {
  return asString(asRecord(asRecord(body).data).id);
}

const RAW_OMIT = new Set(['last_analysis_results', 'results', 'html_meta', 'outgoing_links', 'trackers', 'favicon']);
const RAW_LIMIT = 20_000;

/** Trimmed raw attributes for the collapsed "Raw metadata" section. */
export function trimRaw(body: unknown): string | null {
  const attributes = asRecord(asRecord(asRecord(body).data).attributes);
  if (Object.keys(attributes).length === 0) return null;
  const trimmed = Object.fromEntries(Object.entries(attributes).filter(([key]) => !RAW_OMIT.has(key)));
  const text = JSON.stringify(trimmed, null, 2);
  return text.length > RAW_LIMIT ? `${text.slice(0, RAW_LIMIT)}\n… (truncated)` : text;
}
