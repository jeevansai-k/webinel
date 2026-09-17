/** DEV ONLY — realistic sample reports for the preview harness. */
import type { AnalysisJob, ScanReport, VendorResult } from '../src/shared/scan';

const engines = ['Abusix', 'Acronis', 'ADMINUSLabs', 'AlienVault', 'Antiy-AVL', 'Avira', 'BitDefender', 'Certego', 'Cluster25', 'CRDF', 'CyRadar', 'Dr.Web', 'Emsisoft', 'ESET', 'Fortinet', 'G-Data', 'Google Safebrowsing', 'Kaspersky', 'Lionic', 'Malwared', 'Netcraft', 'OpenPhish', 'Phishtank', 'Quttera', 'Sophos', 'Spamhaus', 'Trustwave', 'URLhaus', 'VIPRE', 'Webroot', 'Yandex Safebrowsing', 'ZeroCERT'];

function vendors(bad: Record<string, [VendorResult['verdict'], string]>): VendorResult[] {
  const order = { malicious: 0, suspicious: 1, clean: 2, undetected: 3 };
  return engines
    .map((engine, index) => {
      const flagged = bad[engine];
      if (flagged) return { engine, verdict: flagged[0], category: flagged[0], label: flagged[1] };
      return index % 3 === 0
        ? { engine, verdict: 'undetected' as const, category: 'undetected', label: null }
        : { engine, verdict: 'clean' as const, category: 'harmless', label: null };
    })
    .sort((a, b) => order[a.verdict] - order[b.verdict] || a.engine.localeCompare(b.engine));
}

const now = Date.now();

export const phishingReport: ScanReport = {
  kind: 'url',
  verdict: 'dangerous',
  state: 'complete',
  stats: { malicious: 5, suspicious: 1, harmless: 17, undetected: 9 },
  ratio: { detected: 5, total: 32 },
  vendors: vendors({
    BitDefender: ['malicious', 'Phishing'],
    ESET: ['malicious', 'Phishing'],
    Kaspersky: ['malicious', 'Phishing'],
    Sophos: ['malicious', 'Malware'],
    'Google Safebrowsing': ['malicious', 'Phishing'],
    Fortinet: ['suspicious', 'Suspicious'],
  }),
  reputation: -42,
  votes: { harmless: 1, malicious: 14 },
  firstSeen: now - 3 * 86_400_000,
  lastAnalysisDate: now - 25 * 60_000,
  analysisId: 'u-demo',
  permalink: 'https://www.virustotal.com/gui/url/demo',
  categories: ['Phishing', 'Finance'],
  threats: ['Phishing', 'Credential Theft', 'Malware'],
  url: {
    url: 'https://paypa1-secure-login.xyz/signin/verify',
    finalUrl: 'https://secure-login.io/account/confirm',
    domain: 'paypa1-secure-login.xyz',
    title: 'Log in to your PayPal account',
    httpStatus: 200,
    contentType: 'text/html; charset=UTF-8',
    ipAddresses: ['185.199.110.42', '2606:4700:3033::6815:1a2b'],
    redirectChain: ['https://paypa1-secure-login.xyz/signin/verify', 'https://redirect1.net/r?id=77', 'https://secure-login.io/account/confirm'],
  },
  file: null,
  domain: {
    domain: 'paypa1-secure-login.xyz',
    ipAddresses: ['185.199.110.42', '2606:4700:3033::6815:1a2b'],
    dns: [
      { type: 'A', value: '185.199.110.42', ttl: 300 },
      { type: 'AAAA', value: '2606:4700:3033::6815:1a2b', ttl: 300 },
      { type: 'MX', value: '10 mail.paypa1-secure-login.xyz', ttl: 3600 },
      { type: 'NS', value: 'ns1.cheap-dns.example', ttl: 86400 },
      { type: 'NS', value: 'ns2.cheap-dns.example', ttl: 86400 },
    ],
    certificate: {
      issuer: "Let's Encrypt (R11)",
      subject: 'paypa1-secure-login.xyz',
      validFrom: now - 4 * 86_400_000,
      validTo: now + 86 * 86_400_000,
      fingerprint: '3f1c9a0b8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a3928170f6e5d4c',
    },
    whois: [
      { label: 'Registrar', value: 'NameSilo, LLC' },
      { label: 'Created', value: '2026-09-14' },
      { label: 'Expires', value: '2027-09-14' },
      { label: 'Country', value: 'IS' },
      { label: 'Name servers', value: 'ns1.cheap-dns.example, ns2.cheap-dns.example' },
    ],
    categories: [],
    reputation: -30,
  },
  source: 'virustotal',
  stale: false,
  cachedAt: null,
  checkedAt: now,
  raw: JSON.stringify({ last_http_response_code: 200, tags: ['external-resources'], times_submitted: 18 }, null, 2),
};

export const partialReport: ScanReport = {
  ...phishingReport,
  verdict: 'unknown',
  state: 'partial',
  stats: { malicious: 0, suspicious: 0, harmless: 9, undetected: 4 },
  ratio: { detected: 0, total: 13 },
  vendors: vendors({}).slice(0, 13),
  url: { ...phishingReport.url!, url: 'https://brand-new-startup.io/', domain: 'brand-new-startup.io', title: null, httpStatus: null, contentType: null, ipAddresses: [], redirectChain: [] },
  domain: null,
  threats: [],
  lastAnalysisDate: null,
};

export const fileReport: ScanReport = {
  ...phishingReport,
  kind: 'file',
  verdict: 'dangerous',
  stats: { malicious: 3, suspicious: 0, harmless: 0, undetected: 29 },
  ratio: { detected: 3, total: 32 },
  vendors: vendors({ ESET: ['malicious', 'Win32/Agent.TJS trojan'], Kaspersky: ['malicious', 'Trojan.Win32.Agent'], Sophos: ['malicious', 'Troj/Agent-BDX'] }),
  threats: ['Trojan'],
  url: null,
  domain: null,
  file: {
    fileName: 'invoice_2026.exe',
    sha256: '9b74c9897bac770ffc029102a200c5de2f1d1b3c8f5e1f3a0a2b3c4d5e6f7a8b',
    mimeType: 'application/vnd.microsoft.portable-executable',
    fileType: 'Win32 EXE',
    size: 1_482_240,
  },
  categories: [],
  permalink: 'https://www.virustotal.com/gui/file/demo',
};

export const completedJob: AnalysisJob = {
  id: 'job-demo',
  kind: 'url',
  target: phishingReport.url!.url,
  phase: 'completed',
  startedAt: now - 70_000,
  updatedAt: now - 5_000,
  polls: 4,
  analysisId: 'u-demo',
  report: phishingReport,
  error: null,
};

export const runningJob: AnalysisJob = {
  ...completedJob,
  id: 'job-running',
  phase: 'in-progress',
  startedAt: now - 23_000,
  polls: 2,
  report: partialReport,
};
