import { describe, expect, it } from 'vitest';
import { isSameSite, siteOf } from './sameSite';

describe('content script same-site check', () => {
  it('treats subdomains of one site as the same site', () => {
    expect(isSameSite('www.example.com', 'login.example.com')).toBe(true);
    expect(isSameSite('example.com', 'accounts.example.com')).toBe(true);
    expect(isSameSite('shop.bank.co.uk', 'secure.bank.co.uk')).toBe(true);
  });

  it('flags a different registrable domain', () => {
    expect(isSameSite('paypal.com', 'paypal.com-secure.xyz')).toBe(false);
    expect(isSameSite('login.bank.co.uk', 'evil.co.uk')).toBe(false);
    expect(isSameSite('example.com', 'example.net')).toBe(false);
  });

  it('keeps IP addresses whole', () => {
    expect(siteOf('10.0.0.1')).toBe('10.0.0.1');
    expect(isSameSite('10.0.0.1', '10.0.0.2')).toBe(false);
  });
});
