import { describe, expect, it } from 'vitest';
import { analyzeUrl } from './HeuristicEngine';

const ids = (url: string) => analyzeUrl(url).signals.map((signal) => signal.id);

describe('HeuristicEngine', () => {
  it('scores ordinary sites as low risk', () => {
    for (const url of ['https://www.wikipedia.org/', 'https://github.com/login', 'https://www.google.de/', 'https://news.ycombinator.com/']) {
      expect(analyzeUrl(url).score, url).toBeLessThan(40);
    }
  });

  it('does not flag official brand domains', () => {
    expect(ids('https://www.paypal.com/signin')).not.toContain('lookalike-domain');
    expect(ids('https://accounts.google.com/')).toEqual([]);
    expect(ids('https://www.amazon.co.uk/')).toEqual([]);
  });

  it('flags look-alike and homoglyph domains', () => {
    expect(ids('https://paypa1.com/')).toContain('lookalike-domain');
    expect(ids('https://g00gle.com/')).toContain('lookalike-domain');
    expect(ids('https://rnicrosoft.com/')).toContain('lookalike-domain');
  });

  it('flags brand names used on foreign domains', () => {
    expect(ids('https://paypal.com.account-verify.xyz/login')).toContain('brand-in-subdomain');
    expect(ids('https://paypal-secure-login.com/')).toContain('brand-in-domain');
  });

  it('rates a classic phishing URL as dangerous', () => {
    expect(analyzeUrl('http://paypal.com.secure-login.verify-account.xyz/signin/update').score).toBeGreaterThanOrEqual(75);
  });

  it('blocks the documented manual-test URL on heuristics alone', () => {
    expect(analyzeUrl('http://paypal.com.secure-login.verify-account.invalid/signin').score).toBeGreaterThanOrEqual(75);
  });

  it('detects structural red flags', () => {
    expect(ids('http://192.168.4.20/login')).toContain('ip-host');
    expect(ids('https://xn--pypal-4ve.com/')).toContain('punycode');
    expect(ids('https://google.com@evil.test/')).toContain('credentials-in-url');
    expect(ids('https://example.com:8443/')).toContain('unusual-port');
    expect(ids('https://bit.ly/abc')).toContain('url-shortener');
    expect(ids('https://files.example.zip/')).toContain('suspicious-tld');
  });

  it('uses page signals from the content script', () => {
    const result = analyzeUrl('https://example.com/', {
      hasPasswordField: true,
      passwordFormPostsToOtherHost: true,
      passwordFieldOnInsecurePage: false,
      metaRefreshTarget: null,
    });
    expect(result.signals.map((signal) => signal.id)).toContain('password-offsite');
  });

  it('caps the score at 100 and tolerates invalid input', () => {
    expect(analyzeUrl('http://user:pw@paypa1.com.login.verify.update.secure.account.tk:8080/' + 'a'.repeat(200)).score).toBe(100);
    expect(analyzeUrl('not a url')).toEqual({ score: 0, signals: [] });
  });
});
