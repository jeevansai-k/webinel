import { describe, expect, it } from 'vitest';
import { FileScanner, validateFile } from '../../src/services/FileScanner';
import { sha256OfBlob } from '../../src/services/HashService';
import type { FileMeta } from '../../src/shared/scan';
import { createService, fakeClient, sampleCore, snapshot, TEST_KEY, VirtualClock } from './helpers';

async function fileFixture(name = 'report.pdf', content = 'hello world') {
  const blob = new Blob([content]);
  const meta: FileMeta = { fileName: name, sha256: await sha256OfBlob(blob), size: blob.size, mimeType: null };
  return { blob, meta };
}

function setup(client = fakeClient({ core: sampleCore(0, 'file', 'vt-name.pdf') }), key: string | null = TEST_KEY) {
  const clock = new VirtualClock();
  const { service } = createService(client, key, clock);
  return { scanner: new FileScanner(service, clock), client, clock };
}

describe('FileScanner', () => {
  it('validates size and type locally', () => {
    expect(() => validateFile({ fileName: 'a.pdf', size: 32 * 1024 * 1024 })).not.toThrow();
    expect(() => validateFile({ fileName: 'a.pdf', size: 32 * 1024 * 1024 + 1 })).toThrow(/32 MB/);
    for (const name of ['a.docx', 'b.XLSX', 'c.zip', 'd.exe', 'e.apk', 'f.png', 'g.jpg', 'h.jpeg', 'i.gif', 'j.txt']) {
      expect(() => validateFile({ fileName: name, size: 1 }), name).not.toThrow();
    }
    for (const name of ['a.docm', 'b.js', 'noextension', 'c.pdf.lnk']) {
      expect(() => validateFile({ fileName: name, size: 1 }), name).toThrow(/not supported/);
    }
  });

  it('looks files up by hash and keeps the local name and size', async () => {
    const { meta } = await fileFixture();
    const { scanner, client } = setup();
    const outcome = await scanner.lookup(meta);
    expect(outcome.kind).toBe('report');
    if (outcome.kind !== 'report') return;
    expect(client.getFileReport).toHaveBeenCalledWith(meta.sha256, TEST_KEY, expect.objectContaining({ fileName: 'report.pdf' }));
    expect(outcome.report.file).toMatchObject({ fileName: 'report.pdf', size: meta.size, sha256: meta.sha256, fileType: 'PDF', mimeType: 'application/pdf' });
    expect(outcome.report.verdict).toBe('safe');
  });

  it('asks for upload permission when VirusTotal has never seen the file', async () => {
    const { meta } = await fileFixture();
    const client = fakeClient({ status: 'not-found', summary: null, core: null });
    const { scanner } = setup(client);
    expect(await scanner.lookup(meta)).toEqual({ kind: 'needs-upload', sha256: meta.sha256 });
    expect(client.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects oversized files without any request', async () => {
    const { meta } = await fileFixture();
    const { scanner, client } = setup();
    const outcome = await scanner.lookup({ ...meta, size: 40 * 1024 * 1024 });
    expect(outcome.kind === 'error' && outcome.error.code).toBe('file-too-large');
    expect(client.getFileReport).not.toHaveBeenCalled();
  });

  it('refuses to upload without consent', async () => {
    const { blob, meta } = await fileFixture();
    const { scanner, client } = setup();
    for (const consent of [false, undefined, 'yes', 1]) {
      await expect(scanner.upload(meta, blob, { consent: consent as boolean })).rejects.toMatchObject({ code: 'consent-required' });
    }
    expect(client.uploadFile).not.toHaveBeenCalled();
  });

  it('refuses to upload bytes that do not match the approved hash', async () => {
    const { meta } = await fileFixture();
    const { scanner, client } = setup();
    await expect(scanner.upload(meta, new Blob(['different']), { consent: true })).rejects.toMatchObject({ code: 'server-error' });
    expect(client.uploadFile).not.toHaveBeenCalled();
  });

  it('uploads with consent, polls, and returns the full report', async () => {
    const { blob, meta } = await fileFixture('invoice.exe');
    const client = fakeClient({ core: sampleCore(7, 'file', 'something.exe') });
    client.getAnalysis
      .mockResolvedValueOnce({ status: 'ok', analysis: snapshot('queued') })
      .mockResolvedValueOnce({ status: 'ok', analysis: snapshot('in-progress', 2, 3) })
      .mockResolvedValue({ status: 'ok', analysis: snapshot('completed', 7, 30) });
    const { scanner } = setup(client);
    const phases: string[] = [];
    const report = await scanner.upload(meta, blob, { consent: true, onProgress: (p) => void phases.push(p.phase) });

    expect(client.uploadFile).toHaveBeenCalledWith(blob, 'invoice.exe', TEST_KEY, expect.anything());
    expect(client.getAnalysis).toHaveBeenCalledTimes(3);
    expect(phases[0]).toBe('uploading');
    expect(phases).toContain('in-progress');
    expect(phases.at(-1)).toBe('fetching-report');
    expect(report).toMatchObject({ kind: 'file', state: 'complete', verdict: 'dangerous', analysisId: 'an-file' });
    expect(report.file).toMatchObject({ fileName: 'invoice.exe', sha256: meta.sha256 });
  });

  it('surfaces upload failures as friendly errors', async () => {
    const { blob, meta } = await fileFixture();
    const client = fakeClient();
    client.uploadFile.mockResolvedValue({ status: 'quota-exceeded', analysisId: null });
    const { scanner } = setup(client);
    await expect(scanner.upload(meta, blob, { consent: true })).rejects.toMatchObject({ code: 'rate-limited' });
  });
});
