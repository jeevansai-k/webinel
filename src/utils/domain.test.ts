import { describe, expect, it } from 'vitest';
import {
  getDomainLabel,
  getRegistrableDomain,
  getSubdomainLabels,
  hostMatchesDomain,
  isIpAddress,
  levenshtein,
} from './domain';

describe('domain parsing', () => {
  it('finds the registrable domain, including multi-part suffixes', () => {
    expect(getRegistrableDomain('login.paypal.com.evil.net')).toBe('evil.net');
    expect(getRegistrableDomain('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(getRegistrableDomain('user.github.io')).toBe('user.github.io');
    expect(getRegistrableDomain('example.com')).toBe('example.com');
  });

  it('returns labels and subdomains', () => {
    expect(getDomainLabel('secure.amazon.co.uk')).toBe('amazon');
    expect(getSubdomainLabels('a.b.example.com')).toEqual(['a', 'b']);
    expect(getSubdomainLabels('example.com')).toEqual([]);
  });

  it('recognises IP addresses', () => {
    expect(isIpAddress('192.168.0.1')).toBe(true);
    expect(isIpAddress('[::1]')).toBe(true);
    expect(isIpAddress('999.1.1.1')).toBe(false);
    expect(isIpAddress('example.com')).toBe(false);
  });

  it('matches hosts against domains without suffix confusion', () => {
    expect(hostMatchesDomain('mail.example.com', 'example.com')).toBe(true);
    expect(hostMatchesDomain('example.com', '*.example.com')).toBe(true);
    expect(hostMatchesDomain('badexample.com', 'example.com')).toBe(false);
    expect(hostMatchesDomain('example.com.evil.net', 'example.com')).toBe(false);
  });

  it('computes edit distance', () => {
    expect(levenshtein('paypal', 'paypa1')).toBe(1);
    expect(levenshtein('google', 'google')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});
