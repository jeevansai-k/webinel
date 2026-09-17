import { getHost, isScannableUrl } from '../utils/url';

export interface ActiveTabInfo {
  id: number;
  url: string;
  title: string;
  host: string | null;
  scannable: boolean;
}

export async function getActiveTab(): Promise<ActiveTabInfo | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  const url = tab.url ?? '';
  const scannable = isScannableUrl(url);
  return { id: tab.id, url, title: tab.title ?? '', host: scannable ? getHost(url) : null, scannable };
}
