/** Pure helper bundled into the content script. No browser APIs. */

/**
 * Approximate "same site" test without the Public Suffix List: hosts match when
 * one is a subdomain of the other or they share their last two labels (three for
 * short country second-levels such as co.uk). www.example.com posting to
 * login.example.com is normal and must not look like a phishing form.
 */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1]!)) return labels.join('.');
  const take = labels[labels.length - 1]!.length === 2 && labels[labels.length - 2]!.length <= 3 ? 3 : 2;
  return labels.slice(-take).join('.');
}

export function isSameSite(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`) || siteOf(x) === siteOf(y);
}
