/**
 * Local, synchronous URL heuristics. Never touches the network.
 * Produces a 0–100 score plus human-readable signals the UI can show verbatim.
 */
import type { TabPageSignals } from '../shared/messages';
import type { HeuristicResult, HeuristicSignal } from '../shared/verdict';
import {
  getDomainLabel,
  getRegistrableDomain,
  getSubdomainLabels,
  getTld,
  isIpAddress,
  levenshtein,
} from '../utils/domain';
import { parseUrl } from '../utils/url';

interface ProtectedBrand {
  keyword: string;
  officialDomains: string[];
}

/** Frequently impersonated brands. Official domains are registrable domains. */
export const PROTECTED_BRANDS: ProtectedBrand[] = [
  { keyword: 'paypal', officialDomains: ['paypal.com', 'paypal.me', 'paypalobjects.com'] },
  { keyword: 'google', officialDomains: ['google.com', 'gmail.com', 'youtube.com', 'googleusercontent.com', 'gstatic.com'] },
  { keyword: 'apple', officialDomains: ['apple.com', 'icloud.com', 'apple.news'] },
  { keyword: 'icloud', officialDomains: ['icloud.com', 'apple.com'] },
  { keyword: 'microsoft', officialDomains: ['microsoft.com', 'live.com', 'office.com', 'microsoftonline.com', 'outlook.com'] },
  { keyword: 'outlook', officialDomains: ['outlook.com', 'live.com', 'office.com', 'microsoft.com'] },
  { keyword: 'office365', officialDomains: ['office.com', 'microsoft.com'] },
  { keyword: 'amazon', officialDomains: ['amazon.com', 'amazon.in', 'amazon.co.uk', 'amazon.de', 'amazonaws.com', 'media-amazon.com'] },
  { keyword: 'facebook', officialDomains: ['facebook.com', 'fb.com', 'fbcdn.net', 'meta.com'] },
  { keyword: 'instagram', officialDomains: ['instagram.com', 'cdninstagram.com'] },
  { keyword: 'whatsapp', officialDomains: ['whatsapp.com', 'whatsapp.net', 'wa.me'] },
  { keyword: 'netflix', officialDomains: ['netflix.com', 'nflxext.com', 'nflxvideo.net'] },
  { keyword: 'linkedin', officialDomains: ['linkedin.com', 'licdn.com'] },
  { keyword: 'twitter', officialDomains: ['twitter.com', 'x.com', 'twimg.com', 't.co'] },
  { keyword: 'dropbox', officialDomains: ['dropbox.com', 'dropboxusercontent.com'] },
  { keyword: 'github', officialDomains: ['github.com', 'github.io', 'githubusercontent.com'] },
  { keyword: 'binance', officialDomains: ['binance.com'] },
  { keyword: 'coinbase', officialDomains: ['coinbase.com'] },
  { keyword: 'metamask', officialDomains: ['metamask.io'] },
  { keyword: 'chase', officialDomains: ['chase.com'] },
  { keyword: 'wellsfargo', officialDomains: ['wellsfargo.com'] },
  { keyword: 'bankofamerica', officialDomains: ['bankofamerica.com'] },
  { keyword: 'hdfcbank', officialDomains: ['hdfcbank.com'] },
  { keyword: 'icicibank', officialDomains: ['icicibank.com'] },
  { keyword: 'sbi', officialDomains: ['onlinesbi.sbi', 'sbi.co.in'] },
  { keyword: 'steam', officialDomains: ['steampowered.com', 'steamcommunity.com'] },
  { keyword: 'docusign', officialDomains: ['docusign.com', 'docusign.net'] },
  { keyword: 'adobe', officialDomains: ['adobe.com'] },
];

export const SUSPICIOUS_TLDS = new Set([
  'zip', 'mov', 'xyz', 'top', 'tk', 'ml', 'ga', 'cf', 'gq', 'work', 'click', 'link', 'rest',
  'country', 'kim', 'loan', 'men', 'gdn', 'buzz', 'cam', 'monster', 'icu', 'sbs', 'cfd',
]);

const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 't.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy',
]);

const SENSITIVE_KEYWORDS = [
  'login', 'signin', 'sign-in', 'verify', 'verification', 'account', 'secure', 'update',
  'banking', 'wallet', 'password', 'confirm', 'unlock', 'suspended', 'recover', 'billing',
];

const HOMOGLYPHS: Array<[RegExp, string]> = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/0/g, 'o'],
  [/1/g, 'l'],
  [/3/g, 'e'],
  [/4/g, 'a'],
  [/5/g, 's'],
  [/7/g, 't'],
  [/\$/g, 's'],
];

function normalizeHomoglyphs(label: string): string {
  return HOMOGLYPHS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), label);
}

function isOfficialDomain(brand: ProtectedBrand, registrable: string): boolean {
  if (brand.officialDomains.includes(registrable)) return true;
  // Country-code variants such as google.de or amazon.co.uk.
  const label = registrable.split('.')[0];
  return label === brand.keyword && !SUSPICIOUS_TLDS.has(getTld(registrable));
}

function detectBrandAbuse(host: string, signals: HeuristicSignal[]): void {
  const registrable = getRegistrableDomain(host);
  const domainLabel = getDomainLabel(host);
  const subdomainText = getSubdomainLabels(host).join('.');
  const normalizedLabel = normalizeHomoglyphs(domainLabel.replace(/-/g, ''));

  for (const brand of PROTECTED_BRANDS) {
    if (isOfficialDomain(brand, registrable)) continue;
    const brandName = brand.keyword;
    const distance = levenshtein(normalizedLabel, brandName);
    const allowedDistance = brandName.length >= 8 ? 2 : brandName.length >= 6 ? 1 : 0;

    if (domainLabel !== brandName && (normalizedLabel === brandName || (distance > 0 && distance <= allowedDistance))) {
      signals.push({ id: 'lookalike-domain', label: `Looks like ${brandName} but is not an official ${brandName} domain`, weight: 55 });
      return;
    }
    if (brandName.length >= 4 && domainLabel.includes(brandName)) {
      signals.push({ id: 'brand-in-domain', label: `Uses the ${brandName} name on an unofficial domain (${registrable})`, weight: 35 });
      return;
    }
    if (brandName.length >= 4 && subdomainText.includes(brandName)) {
      signals.push({ id: 'brand-in-subdomain', label: `Mentions ${brandName} but actually belongs to ${registrable}`, weight: 45 });
      return;
    }
  }
}

function detectPageSignals(page: TabPageSignals | undefined, signals: HeuristicSignal[]): void {
  if (!page) return;
  if (page.passwordFieldOnInsecurePage) {
    signals.push({ id: 'insecure-password', label: 'Asks for a password over an unencrypted connection', weight: 30 });
  }
  if (page.passwordFormPostsToOtherHost) {
    signals.push({ id: 'password-offsite', label: 'Sends your password to a different website', weight: 30 });
  }
}

export function analyzeUrl(rawUrl: string, page?: TabPageSignals): HeuristicResult {
  const url = parseUrl(rawUrl);
  if (!url) return { score: 0, signals: [] };

  const host = url.hostname.toLowerCase();
  const signals: HeuristicSignal[] = [];
  const pathAndQuery = `${url.pathname}${url.search}`.toLowerCase();

  if (isIpAddress(host)) {
    signals.push({ id: 'ip-host', label: 'Uses a raw IP address instead of a domain name', weight: 30 });
  } else {
    if (host.split('.').some((label) => label.startsWith('xn--'))) {
      signals.push({ id: 'punycode', label: 'Uses international characters that can imitate other sites', weight: 25 });
    }
    detectBrandAbuse(host, signals);
    if (SUSPICIOUS_TLDS.has(getTld(host))) {
      signals.push({ id: 'suspicious-tld', label: `Uses the .${getTld(host)} extension, common in abuse`, weight: 15 });
    }
    if (getSubdomainLabels(host).length >= 4) {
      signals.push({ id: 'deep-subdomains', label: 'Has an unusually deep chain of subdomains', weight: 15 });
    }
    const label = getDomainLabel(host);
    if ((label.match(/-/g) ?? []).length >= 3) {
      signals.push({ id: 'many-hyphens', label: 'Domain name contains many hyphens', weight: 10 });
    }
    if ((label.match(/\d/g) ?? []).length >= 5) {
      signals.push({ id: 'many-digits', label: 'Domain name contains many digits', weight: 10 });
    }
    if (URL_SHORTENERS.has(getRegistrableDomain(host))) {
      signals.push({ id: 'url-shortener', label: 'Shortened link hides the final destination', weight: 10 });
    }
  }

  if (url.username || url.password) {
    signals.push({ id: 'credentials-in-url', label: 'Hides the real destination behind an @ symbol', weight: 30 });
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    signals.push({ id: 'unusual-port', label: `Uses the unusual network port ${url.port}`, weight: 10 });
  }
  if (rawUrl.length > 150) {
    signals.push({ id: 'long-url', label: 'Address is unusually long', weight: 10 });
  }

  const keywordHits = SENSITIVE_KEYWORDS.filter((word) => host.includes(word) || pathAndQuery.includes(word));
  if (keywordHits.length >= 2) {
    signals.push({ id: 'sensitive-keywords', label: 'Address uses account/login bait words', weight: 10 });
  }
  if (url.protocol === 'http:' && keywordHits.length > 0) {
    signals.push({ id: 'insecure-login-path', label: 'Login-style page without HTTPS encryption', weight: 25 });
  }

  detectPageSignals(page, signals);

  const score = Math.min(100, signals.reduce((total, signal) => total + signal.weight, 0));
  return { score, signals };
}
