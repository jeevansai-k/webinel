import { describe, expect, it, vi } from 'vitest';
import { chromeFake } from '../../tests/setup/chromeMock';
import type { ThreatReport, Verdict } from '../shared/verdict';
import type { ThreatEngine } from '../services/ThreatEngine';
import { settingsStore } from '../storage/SettingsStore';
import { timelineStore } from '../storage/TimelineStore';
import { assessFileName, DownloadGuard, fileNameFromDownload } from './DownloadGuard';

function engineReturning(verdict: Verdict): ThreatEngine {
  return {
    evaluate: vi.fn(async () => ({ verdict, host: 'files.test', reasons: [`${verdict} source`] }) as unknown as ThreatReport),
  } as unknown as ThreatEngine;
}

const item = (filename: string, url = 'https://files.test/download') =>
  ({ id: 7, filename, url, finalUrl: url }) as chrome.downloads.DownloadItem;

describe('assessFileName', () => {
  it('flags disguised executables as dangerous', () => {
    expect(assessFileName('invoice.pdf.exe').risk).toBe('dangerous');
    expect(assessFileName('photo‮gpj.exe').risk).toBe('dangerous');
  });

  it('flags plain executables as risky and documents as fine', () => {
    expect(assessFileName('setup.msi').risk).toBe('risky');
    expect(assessFileName('report.pdf').risk).toBe('none');
    expect(assessFileName('archive.tar.gz').risk).toBe('none');
  });

  it('derives a name from the URL when the browser has none yet', () => {
    expect(fileNameFromDownload('', 'https://x.test/files/My%20File.zip?x=1')).toBe('My File.zip');
    expect(fileNameFromDownload('/home/u/Downloads/a.exe', '')).toBe('a.exe');
  });
});

describe('DownloadGuard', () => {
  it('cancels downloads from dangerous sources', async () => {
    await new DownloadGuard(engineReturning('dangerous')).inspect(item('notes.txt'));
    expect(chromeFake().downloads.cancel).toHaveBeenCalledWith(7);
    expect((await timelineStore.get())[0]?.kind).toBe('download-blocked');
  });

  it('pauses unverified executables', async () => {
    await new DownloadGuard(engineReturning('unknown')).inspect(item('tool.exe'));
    expect(chromeFake().downloads.pause).toHaveBeenCalledWith(7);
    expect(chromeFake().downloads.cancel).not.toHaveBeenCalled();
  });

  it('lets verified-safe executables and ordinary files through', async () => {
    await new DownloadGuard(engineReturning('safe')).inspect(item('tool.exe'));
    await new DownloadGuard(engineReturning('unknown')).inspect(item('report.pdf'));
    expect(chromeFake().downloads.pause).not.toHaveBeenCalled();
    expect(chromeFake().downloads.cancel).not.toHaveBeenCalled();
  });

  it('does nothing when the scanner is switched off', async () => {
    await settingsStore.patch({ downloadScanner: false });
    await new DownloadGuard(engineReturning('dangerous')).inspect(item('invoice.pdf.exe'));
    expect(chromeFake().downloads.cancel).not.toHaveBeenCalled();
  });
});
