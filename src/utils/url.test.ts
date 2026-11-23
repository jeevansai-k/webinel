import { describe, expect, it } from 'vitest';
import { displayUrl, extractUrlsFromText, getHost, isScannableUrl, normalizeUrl } from './url';

describe('normalizeUrl', () => {
  it('lower-cases the host and drops the fragment', () => {
    expect(normalizeUrl('HTTPS://Example.COM/Path#section')).toBe('https://example.com/Path');
  });

  it('removes default ports and trailing host dots', () => {
    expect(normalizeUrl('https://example.com.:443/')).toBe('https://example.com/');
    expect(normalizeUrl('http://example.com:80')).toBe('http://example.com/');
  });

  it('strips tracking parameters but keeps meaningful ones', () => {
    expect(normalizeUrl('https://shop.test/item?id=7&utm_source=mail&fbclid=abc')).toBe('https://shop.test/item?id=7');
    expect(normalizeUrl('https://shop.test/?utm_campaign=x')).toBe('https://shop.test/');
  });

  it('treats host:port input as an address, not a URL scheme', () => {
    expect(normalizeUrl('localhost:8080')).toBe('https://localhost:8080/');
    expect(normalizeUrl('example.com:8443/admin')).toBe('https://example.com:8443/admin');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('mailto:someone@example.com')).toBeNull();
  });

  it('assumes https for bare domains', () => {
    expect(normalizeUrl('example.org/login')).toBe('https://example.org/login');
  });

  it('rejects non-web schemes and garbage', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('chrome://settings')).toBeNull();
    expect(normalizeUrl('http://')).toBeNull();
  });

  it('converts internationalized hosts to punycode', () => {
    expect(normalizeUrl('https://pаypal.com/')).toBe('https://xn--pypal-4ve.com/');
  });
});

describe('url helpers', () => {
  it('detects scannable URLs', () => {
    expect(isScannableUrl('https://a.b')).toBe(true);
    expect(isScannableUrl('about:blank')).toBe(false);
    expect(isScannableUrl('chrome-extension://id/popup.html')).toBe(false);
  });

  it('extracts the host', () => {
    expect(getHost('https://Sub.Example.com./x')).toBe('sub.example.com');
    expect(getHost('not a url')).toBeNull();
  });

  it('extracts and deduplicates URLs from text without trailing punctuation', () => {
    const text = 'Visit https://a.test/x, then http://b.test. Again: https://a.test/x!';
    expect(extractUrlsFromText(text)).toEqual(['https://a.test/x', 'http://b.test/']);
  });

  it('hides query strings in display URLs and truncates', () => {
    expect(displayUrl('https://a.test/path?token=secret')).toBe('a.test/path');
    expect(displayUrl(`https://a.test/${'x'.repeat(80)}`, 20)).toHaveLength(20);
  });
});
