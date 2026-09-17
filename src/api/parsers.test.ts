import { describe, expect, it } from 'vitest';
import { analysisObject, domainObject, fileObject, urlObject } from '../../tests/fixtures/virustotal';
import {
  classifyThreats,
  detectionRatio,
  parseAnalysis,
  parseDomainObject,
  parseFileObject,
  parseUrlObject,
  parseVendors,
  parseWhois,
  trimRaw,
  vendorVerdict,
} from './parsers';

describe('vendor parsing', () => {
  it('maps VirusTotal categories to the four colour verdicts', () => {
    expect(vendorVerdict('malicious')).toBe('malicious');
    expect(vendorVerdict('suspicious')).toBe('suspicious');
    expect(vendorVerdict('harmless')).toBe('clean');
    expect(vendorVerdict('undetected')).toBe('undetected');
    expect(vendorVerdict('timeout')).toBe('undetected');
    expect(vendorVerdict('type-unsupported')).toBe('undetected');
    expect(vendorVerdict(undefined)).toBe('undetected');
  });

  it('builds the vendor list dynamically, worst first then alphabetical', () => {
    const vendors = parseVendors(urlObject.data.attributes.last_analysis_results);
    expect(vendors.map((vendor) => `${vendor.engine}:${vendor.verdict}`)).toEqual([
      'EngineA:malicious',
      'EngineD:malicious',
      'Zulu:malicious',
      'EngineC:suspicious',
      'EngineB:clean',
      'EngineE:undetected',
      'EngineF:undetected',
    ]);
    expect(vendors[0]!.label).toBe('phishing');
    expect(vendors.find((vendor) => vendor.engine === 'EngineB')!.label).toBeNull();
    expect(vendors.find((vendor) => vendor.engine === 'EngineF')!.category).toBe('timeout');
  });

  it('tolerates junk', () => {
    expect(parseVendors(null)).toEqual([]);
    expect(parseVendors('nope')).toEqual([]);
  });

  it('computes the detection ratio from verdict-bearing engines', () => {
    expect(detectionRatio({ malicious: 5, suspicious: 1, harmless: 60, undetected: 27 })).toEqual({ detected: 5, total: 93 });
  });
});

describe('object parsing', () => {
  it('parses URL metadata, reputation, categories and threats', () => {
    const core = parseUrlObject(urlObject, 'https://evil.test/login');
    expect(core.ratio).toEqual({ detected: 3, total: 64 });
    expect(core.url).toEqual({
      url: 'https://evil.test/login',
      finalUrl: 'https://landing.evil.test/confirm',
      domain: 'evil.test',
      title: 'Sign in',
      httpStatus: 200,
      contentType: 'text/html; charset=utf-8',
      ipAddresses: [],
      redirectChain: ['https://evil.test/login', 'https://hop.evil.test/r', 'https://landing.evil.test/confirm'],
    });
    expect(core).toMatchObject({
      reputation: -12,
      votes: { harmless: 1, malicious: 7 },
      firstSeen: 1_700_000_000_000,
      lastAnalysisDate: 1_700_050_000_000,
      categories: ['Phishing', 'Finance'],
      permalink: `https://www.virustotal.com/gui/url/${urlObject.data.id}`,
    });
    expect(core.threats[0]).toBe('Phishing');
    expect(core.threats).toContain('Malware');
  });

  it('parses file metadata and threat classification', () => {
    const core = parseFileObject(fileObject, 'a'.repeat(64), 'setup.exe');
    expect(core.file).toEqual({ fileName: 'setup.exe', sha256: 'a'.repeat(64), mimeType: 'application/octet-stream', fileType: 'Win32 EXE', size: 4096 });
    expect(core.ratio).toEqual({ detected: 20, total: 70 });
    expect(core.threats).toEqual(['Trojan', 'Ransomware']);
    expect(core.permalink).toBe(`https://www.virustotal.com/gui/file/${'a'.repeat(64)}`);
  });

  it('parses DNS, certificate and WHOIS for a domain', () => {
    const intel = parseDomainObject(domainObject, 'www.evil.test');
    expect(intel.domain).toBe('evil.test');
    expect(intel.ipAddresses).toEqual(['203.0.113.9', '2001:db8::9']);
    expect(intel.dns.map((record) => `${record.type} ${record.value}`)).toEqual([
      'A 203.0.113.9',
      'AAAA 2001:db8::9',
      'MX 10 mail.evil.test',
      'NS ns1.host.test',
    ]);
    expect(intel.certificate).toEqual({
      issuer: "Let's Encrypt (R11)",
      subject: 'evil.test',
      validFrom: Date.UTC(2026, 8, 1),
      validTo: Date.UTC(2026, 10, 30, 23, 59, 59),
      fingerprint: 'ab'.repeat(32),
    });
    expect(intel.reputation).toBe(-30);
  });

  it('keeps only meaningful WHOIS fields and drops redacted values', () => {
    expect(parseWhois(domainObject.data.attributes.whois)).toEqual([
      { label: 'Registrar', value: 'Example Registrar, Inc.' },
      { label: 'Created', value: '2026-09-10' },
      { label: 'Expires', value: '2027-09-10' },
      { label: 'Country', value: 'IS' },
      { label: 'Name servers', value: 'NS1.HOST.TEST, NS2.HOST.TEST' },
      { label: 'DNSSEC', value: 'unsigned' },
    ]);
    expect(parseWhois(undefined)).toEqual([]);
  });

  it('parses analysis snapshots', () => {
    const queued = parseAnalysis(analysisObject('queued'));
    expect(queued).toMatchObject({ status: 'queued', vendors: [], url: 'https://new.test/' });
    const done = parseAnalysis(
      analysisObject('completed', { A: { category: 'malicious', engine_name: 'A', result: 'phishing' }, B: { category: 'harmless', engine_name: 'B', result: 'clean' } }),
    );
    expect(done.status).toBe('completed');
    expect(done.stats).toEqual({ malicious: 1, suspicious: 0, harmless: 1, undetected: 0 });
    expect(done.date).toBe(1_700_000_900_000);
  });

  it('classifies threats by frequency', () => {
    expect(classifyThreats(['Trojan.X', 'phishing', 'Phish.Kit', null, 'clean', 'HEUR:Trojan.Script', 'Trojan-Spy'])).toEqual(['Trojan', 'Phishing']);
    expect(classifyThreats(['PasswordStealer', 'Adware.Toolbar', 'CoinMiner'])).toEqual(['Credential Theft', 'Adware', 'Cryptominer']);
  });

  it('trims raw metadata and drops bulky fields', () => {
    const raw = trimRaw(urlObject)!;
    expect(raw).toContain('last_http_response_code');
    expect(raw).not.toContain('last_analysis_results');
    expect(raw).not.toContain('outgoing_links');
    expect(trimRaw({})).toBeNull();
  });
});
