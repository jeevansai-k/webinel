/**
 * Download Reputation Scanner: checks the file name and the source host of
 * every new download. Dangerous downloads are cancelled; risky ones are paused.
 */
import type { ThreatEngine } from '../services/ThreatEngine';
import { settingsStore } from '../storage/SettingsStore';
import { statsStore } from '../storage/StatsStore';
import { timelineStore } from '../storage/TimelineStore';
import { logger } from '../utils/logger';
import { isScannableUrl, parseUrl } from '../utils/url';

const EXECUTABLE_EXTENSIONS = new Set([
  'exe', 'scr', 'msi', 'msix', 'bat', 'cmd', 'com', 'pif', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf',
  'hta', 'jar', 'apk', 'dmg', 'pkg', 'app', 'iso', 'img', 'lnk', 'reg', 'cpl', 'dll', 'appimage', 'deb', 'rpm', 'sh',
]);
const DECOY_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'txt', 'mp4', 'mp3', 'zip']);

export type DownloadRisk = 'none' | 'risky' | 'dangerous';

export interface FileNameAssessment {
  risk: DownloadRisk;
  reason: string | null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Malformed percent-escapes ("%E0%A4%A") must not abort the download check.
    return value;
  }
}

export function fileNameFromDownload(filename: string, url: string): string {
  const fromPath = filename.split(/[\\/]/).pop();
  if (fromPath) return fromPath;
  const parsed = parseUrl(url);
  return safeDecode(parsed?.pathname.split('/').pop() ?? '') || 'download';
}

export function assessFileName(fileName: string): FileNameAssessment {
  const parts = fileName.toLowerCase().split('.');
  const extension = parts.length > 1 ? parts[parts.length - 1]! : '';
  const previous = parts.length > 2 ? parts[parts.length - 2]! : '';
  if (EXECUTABLE_EXTENSIONS.has(extension) && DECOY_EXTENSIONS.has(previous)) {
    return { risk: 'dangerous', reason: `Disguised program: “.${previous}” file is really “.${extension}”` };
  }
  if (/[‮‎‏]/.test(fileName)) {
    return { risk: 'dangerous', reason: 'File name uses hidden characters to fake its type' };
  }
  if (EXECUTABLE_EXTENSIONS.has(extension)) {
    return { risk: 'risky', reason: `Program file (.${extension}) — only run it if you trust the source` };
  }
  return { risk: 'none', reason: null };
}

async function notify(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message,
    });
  } catch (error) {
    logger.warn('Notification failed', error);
  }
}

export class DownloadGuard {
  /** Downloads already paused or cancelled, so a later name update does not act twice. */
  private readonly handled = new Set<number>();

  constructor(private readonly engine: ThreatEngine) {}

  /**
   * Chrome often reports a download before its final file name is known (e.g.
   * "download.php?id=7" that turns out to be "invoice.pdf.exe"). Re-check once the
   * name is decided.
   */
  async onFilenameDetermined(downloadId: number): Promise<void> {
    if (this.handled.has(downloadId)) return;
    const [item] = await chrome.downloads.search({ id: downloadId }).catch(() => [] as chrome.downloads.DownloadItem[]);
    if (item && item.state === 'in_progress') await this.inspect(item);
  }

  async inspect(item: chrome.downloads.DownloadItem): Promise<void> {
    if (this.handled.has(item.id)) return;
    if (!(await settingsStore.get()).downloadScanner) return;
    const sourceUrl = item.finalUrl || item.url;
    const fileName = fileNameFromDownload(item.filename, sourceUrl);
    const nameCheck = assessFileName(fileName);

    let sourceVerdict: 'safe' | 'suspicious' | 'dangerous' | 'unknown' | 'error' = 'unknown';
    let sourceReason: string | null = null;
    // blob: and data: downloads have no hostname of their own.
    let sourceHost = parseUrl(sourceUrl)?.hostname || 'this page';
    if (isScannableUrl(sourceUrl)) {
      try {
        const report = await this.engine.evaluate(sourceUrl, 'domain', { record: false });
        sourceVerdict = report.verdict;
        sourceReason = report.reasons[0] ?? null;
        sourceHost = report.host;
      } catch (error) {
        // Keep checking the file name even if the source lookup fails.
        logger.warn('Download source check failed', error);
        sourceHost = parseUrl(sourceUrl)?.hostname || sourceHost;
      }
    }

    const dangerous = nameCheck.risk === 'dangerous' || sourceVerdict === 'dangerous';
    const risky = !dangerous && (sourceVerdict === 'suspicious' || (nameCheck.risk === 'risky' && sourceVerdict !== 'safe'));
    if (!dangerous && !risky) return;

    const reason =
      (sourceVerdict === 'dangerous' || sourceVerdict === 'suspicious' ? sourceReason : null) ??
      nameCheck.reason ??
      'Unverified source';

    this.handled.add(item.id);
    if (dangerous) {
      await chrome.downloads.cancel(item.id).catch(() => undefined);
      await statsStore.increment('downloadsBlocked');
      await timelineStore.record({ kind: 'download-blocked', subject: fileName, verdict: 'dangerous', detail: `${reason} (from ${sourceHost})` });
      await notify('Webinel blocked a download', `${fileName}\n${reason}`);
      return;
    }

    await chrome.downloads.pause(item.id).catch(() => undefined);
    await timelineStore.record({ kind: 'download-paused', subject: fileName, verdict: 'suspicious', detail: `${reason} (from ${sourceHost})` });
    await notify(
      'Webinel paused a risky download',
      `${fileName}\n${reason}\nResume it from your browser's downloads list if you trust it.`,
    );
  }
}
