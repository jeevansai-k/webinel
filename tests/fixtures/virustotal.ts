/** Trimmed-down VirusTotal v3 payloads in the shape the real API returns. */

export const urlObject = {
  data: {
    type: 'url',
    id: 'c0ffee'.padEnd(64, '0'),
    attributes: {
      url: 'https://evil.test/login',
      last_final_url: 'https://landing.evil.test/confirm',
      title: 'Sign in',
      last_http_response_code: 200,
      last_http_response_headers: { 'Content-Type': 'text/html; charset=utf-8', Server: 'nginx' },
      first_submission_date: 1_700_000_000,
      last_analysis_date: 1_700_050_000,
      reputation: -12,
      total_votes: { harmless: 1, malicious: 7 },
      categories: { EngineA: 'phishing', EngineB: 'phishing', EngineC: 'finance' },
      threat_names: ['Phishing.Generic'],
      redirection_chain: ['https://evil.test/login', 'https://hop.evil.test/r'],
      last_analysis_stats: { malicious: 3, suspicious: 1, harmless: 50, undetected: 10, timeout: 2 },
      last_analysis_results: {
        EngineA: { category: 'malicious', engine_name: 'EngineA', result: 'phishing' },
        EngineB: { category: 'harmless', engine_name: 'EngineB', result: 'clean' },
        EngineC: { category: 'suspicious', engine_name: 'EngineC', result: 'suspicious' },
        EngineD: { category: 'malicious', engine_name: 'EngineD', result: 'malware' },
        EngineE: { category: 'undetected', engine_name: 'EngineE', result: 'unrated' },
        EngineF: { category: 'timeout', engine_name: 'EngineF', result: null },
        Zulu: { category: 'malicious', engine_name: 'Zulu', result: 'phishing site' },
      },
      html_meta: { description: ['very long'] },
      outgoing_links: ['https://x.test/'],
    },
  },
};

export const fileObject = {
  data: {
    type: 'file',
    id: 'a'.repeat(64),
    attributes: {
      size: 4096,
      type_description: 'Win32 EXE',
      type_tag: 'peexe',
      exiftool: { MIMEType: 'application/octet-stream' },
      last_analysis_date: 1_700_000_500,
      first_submission_date: 1_690_000_000,
      popular_threat_classification: {
        suggested_threat_label: 'trojan.agent/generic',
        popular_threat_category: [{ value: 'trojan', count: 12 }, { value: 'ransomware', count: 2 }],
      },
      last_analysis_stats: { malicious: 20, suspicious: 0, harmless: 0, undetected: 50, 'type-unsupported': 4 },
      last_analysis_results: {
        Kaspersky: { category: 'malicious', engine_name: 'Kaspersky', result: 'Trojan.Win32.Agent' },
        Avast: { category: 'undetected', engine_name: 'Avast', result: null },
        Old: { category: 'type-unsupported', engine_name: 'Old', result: null },
      },
    },
  },
};

export const domainObject = {
  data: {
    type: 'domain',
    id: 'evil.test',
    attributes: {
      reputation: -30,
      categories: { EngineA: 'phishing' },
      last_analysis_stats: { malicious: 4, suspicious: 0, harmless: 60, undetected: 20 },
      last_analysis_results: { EngineA: { category: 'malicious', engine_name: 'EngineA', result: 'phishing' } },
      last_dns_records: [
        { type: 'A', value: '203.0.113.9', ttl: 300 },
        { type: 'AAAA', value: '2001:db8::9', ttl: 300 },
        { type: 'MX', value: 'mail.evil.test', ttl: 3600, priority: 10 },
        { type: 'NS', value: 'ns1.host.test', ttl: 86400 },
        { type: 'TXT', value: 'v=spf1 -all', ttl: 300 },
        { type: 'SOA', value: 'ns1.host.test', ttl: 300 },
      ],
      last_https_certificate: {
        issuer: { C: 'US', O: "Let's Encrypt", CN: 'R11' },
        subject: { CN: 'evil.test' },
        validity: { not_before: '2026-09-01 00:00:00', not_after: '2026-11-30 23:59:59' },
        thumbprint_sha256: 'ab'.repeat(32),
      },
      whois: [
        'Domain Name: EVIL.TEST',
        'Registrar: Example Registrar, Inc.',
        'Creation Date: 2026-09-10T00:00:00Z',
        'Registry Expiry Date: 2027-09-10T00:00:00Z',
        'Registrant Organization: REDACTED FOR PRIVACY',
        'Registrant Country: IS',
        'Name Server: NS1.HOST.TEST',
        'Name Server: NS2.HOST.TEST',
        'DNSSEC: unsigned',
        'Registrar Abuse Contact Email: abuse@example.test',
      ].join('\n'),
    },
  },
};

export function analysisObject(status: 'queued' | 'in-progress' | 'completed', results: Record<string, { category: string; engine_name: string; result: string | null }> = {}) {
  const stats = { malicious: 0, suspicious: 0, harmless: 0, undetected: 0 };
  for (const result of Object.values(results)) {
    const key = result.category as keyof typeof stats;
    if (key in stats) stats[key] += 1;
  }
  return {
    data: { type: 'analysis', id: 'u-abc-123', attributes: { status, stats, results, date: 1_700_000_900 } },
    meta: { url_info: { id: 'x', url: 'https://new.test/' } },
  };
}
