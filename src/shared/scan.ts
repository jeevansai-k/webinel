/**
 * Types for the VirusTotal URL & file scanning engine (Scan Now, Advanced
 * Analysis, Document Scanner). Shared by background and popup.
 */
import type { ScanErrorInfo } from './scanErrors';
import type { Verdict, VirusTotalStats } from './verdict';

/** A vendor's opinion, normalized to the four colours the UI uses. */
export type VendorVerdict = 'malicious' | 'suspicious' | 'clean' | 'undetected';

export interface VendorResult {
  engine: string;
  verdict: VendorVerdict;
  /** Raw VirusTotal category, e.g. "harmless", "timeout", "type-unsupported". */
  category: string;
  /** Vendor's own label, e.g. "Phishing" or "Trojan.GenericKD". */
  label: string | null;
}

export interface DetectionRatio {
  detected: number;
  total: number;
}

/** complete = VirusTotal finished; partial = some vendors reported; processing = nothing yet. */
export type ReportState = 'complete' | 'partial' | 'processing';

export interface Votes {
  harmless: number;
  malicious: number;
}

export interface DnsRecord {
  type: string;
  value: string;
  ttl: number | null;
}

export interface CertificateInfo {
  issuer: string;
  subject: string | null;
  validFrom: number | null;
  validTo: number | null;
  fingerprint: string | null;
}

export interface WhoisField {
  label: string;
  value: string;
}

export interface DomainIntel {
  domain: string;
  ipAddresses: string[];
  dns: DnsRecord[];
  certificate: CertificateInfo | null;
  whois: WhoisField[];
  categories: string[];
  reputation: number | null;
}

export interface UrlDetails {
  url: string;
  finalUrl: string | null;
  domain: string;
  title: string | null;
  httpStatus: number | null;
  contentType: string | null;
  ipAddresses: string[];
  redirectChain: string[];
}

export interface FileDetails {
  fileName: string;
  sha256: string;
  mimeType: string | null;
  fileType: string | null;
  size: number | null;
}

/** Everything VirusTotal told us about one URL or file object (cacheable). */
export interface ScanCore {
  stats: VirusTotalStats;
  vendors: VendorResult[];
  ratio: DetectionRatio;
  reputation: number | null;
  votes: Votes | null;
  firstSeen: number | null;
  lastAnalysisDate: number | null;
  permalink: string | null;
  categories: string[];
  threats: string[];
  url: UrlDetails | null;
  file: FileDetails | null;
}

export interface ScanReport extends ScanCore {
  kind: 'url' | 'file';
  verdict: Verdict;
  state: ReportState;
  analysisId: string | null;
  domain: DomainIntel | null;
  source: 'virustotal' | 'cache';
  /** True when VirusTotal was unreachable and an expired cache entry is shown instead. */
  stale: boolean;
  cachedAt: number | null;
  checkedAt: number;
  /** Trimmed raw VirusTotal attributes as pretty JSON (Advanced Analysis only). */
  raw: string | null;
}

export interface FileMeta {
  fileName: string;
  sha256: string;
  size: number;
  mimeType: string | null;
}

export type ScanOutcome =
  | { kind: 'report'; report: ScanReport }
  | { kind: 'needs-upload'; sha256: string }
  | { kind: 'error'; error: ScanErrorInfo };

export type AnalysisPhase =
  | 'uploading'
  | 'submitting'
  | 'queued'
  | 'in-progress'
  | 'fetching-report'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const ACTIVE_PHASES: ReadonlySet<AnalysisPhase> = new Set([
  'uploading',
  'submitting',
  'queued',
  'in-progress',
  'fetching-report',
]);

export interface AnalysisJob {
  id: string;
  kind: 'url' | 'file';
  /** Normalized URL or file name. */
  target: string;
  phase: AnalysisPhase;
  startedAt: number;
  updatedAt: number;
  polls: number;
  analysisId: string | null;
  /** Partial results while polling, the final report once completed. */
  report: ScanReport | null;
  error: ScanErrorInfo | null;
}
