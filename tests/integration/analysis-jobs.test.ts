import { describe, expect, it, vi } from 'vitest';
import { AnalysisJobs } from '../../src/background/AnalysisJobs';
import { FileScanner } from '../../src/services/FileScanner';
import { sha256OfBlob } from '../../src/services/HashService';
import { memoryStaging } from '../../src/services/UploadStaging';
import { UrlScanner } from '../../src/services/UrlScanner';
import { analysisJobStore } from '../../src/storage/AnalysisJobStore';
import { statsStore } from '../../src/storage/StatsStore';
import { timelineStore } from '../../src/storage/TimelineStore';
import { createService, fakeClient, sampleCore, snapshot, VirtualClock } from './helpers';

function setup(client = fakeClient({ core: sampleCore(2) })) {
  const clock = new VirtualClock();
  const { service } = createService(client, 'k'.repeat(64), clock);
  const staging = memoryStaging();
  const jobs = new AnalysisJobs(new UrlScanner(service, clock), new FileScanner(service, clock), staging);
  return { jobs, client, staging };
}

describe('AnalysisJobs (background polling)', () => {
  it('runs a URL analysis in the background and records progress', async () => {
    const { jobs } = setup();
    const snapshots: string[] = [];
    const unsubscribe = analysisJobStore.subscribe((all) => Object.values(all).forEach((job) => snapshots.push(job.phase)));
    const jobId = await jobs.startUrl('https://evil.test/');
    await jobs.settled(jobId);
    unsubscribe();

    const job = await analysisJobStore.find(jobId);
    expect(job).toMatchObject({ kind: 'url', target: 'https://evil.test/', phase: 'completed', analysisId: 'an-1', error: null });
    expect(job?.report?.state).toBe('complete');
    expect(snapshots).toEqual(expect.arrayContaining(['submitting', 'queued', 'fetching-report', 'completed']));
    expect((await statsStore.get()).counters.fullAnalyses).toBe(1);
    expect((await timelineStore.get())[0]).toMatchObject({ kind: 'full-analysis', subject: 'evil.test' });
  });

  it('cancels a running analysis', async () => {
    const client = fakeClient();
    let release!: () => void;
    client.getAnalysis.mockImplementation(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return { status: 'ok', analysis: snapshot('queued') };
    });
    const { jobs } = setup(client);
    const jobId = await jobs.startUrl('https://example.com/');
    await vi.waitFor(() => expect(client.getAnalysis).toHaveBeenCalled());
    const cancelling = jobs.cancel(jobId);
    release();
    expect(await cancelling).toBe(true);
    const job = await analysisJobStore.find(jobId);
    expect(job?.phase).toBe('cancelled');
    expect(job?.error?.code).toBe('cancelled');
    expect(await jobs.cancel(jobId)).toBe(false);
  });

  it('keeps the background awake only while a job is running', async () => {
    const client = fakeClient();
    let release!: () => void;
    client.getAnalysis.mockImplementation(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return { status: 'ok', analysis: snapshot('completed') };
    });
    const { jobs } = setup(client);
    expect(jobs.keepingAlive).toBe(false);
    const jobId = await jobs.startUrl('https://example.com/');
    expect(jobs.keepingAlive).toBe(true);
    await vi.waitFor(() => expect(client.getAnalysis).toHaveBeenCalled());
    release();
    await jobs.settled(jobId);
    expect(jobs.keepingAlive).toBe(false);
  });

  it('reports a failed file handoff, never "cancelled"', async () => {
    const { jobs, staging } = setup();
    const meta = { fileName: 'new.exe', sha256: 'a'.repeat(64), size: 5, mimeType: 'application/octet-stream' };
    await expect(jobs.startFileUpload(meta, 'missing-id', true)).rejects.toMatchObject({ code: 'upload-handoff' });
    expect(staging.size()).toBe(0);
  });

  it('records friendly failures', async () => {
    const client = fakeClient();
    client.submitUrl.mockResolvedValue({ status: 'quota-exceeded', analysisId: null });
    const { jobs } = setup(client);
    const jobId = await jobs.startUrl('https://example.com/');
    await jobs.settled(jobId);
    const job = await analysisJobStore.find(jobId);
    expect(job?.phase).toBe('failed');
    expect(job?.error).toMatchObject({ code: 'rate-limited', title: 'Daily API limit reached.' });
  });

  it('rejects invalid URLs before creating a job', async () => {
    const { jobs } = setup();
    await expect(jobs.startUrl('not a url')).rejects.toMatchObject({ code: 'invalid-url' });
    expect(await analysisJobStore.get()).toEqual({});
  });

  it('uploads a staged file only with consent, and removes it from staging', async () => {
    const { jobs, client, staging } = setup(fakeClient({ core: sampleCore(0, 'file', 'x.pdf') }));
    const blob = new Blob(['%PDF-1.7 test']);
    const meta = { fileName: 'cv.pdf', sha256: await sha256OfBlob(blob), size: blob.size, mimeType: 'application/pdf' };

    const declinedId = await staging.put(blob);
    await expect(jobs.startFileUpload(meta, declinedId, false)).rejects.toMatchObject({ code: 'consent-required' });
    expect(staging.size()).toBe(0);
    expect(client.uploadFile).not.toHaveBeenCalled();

    const stagingId = await staging.put(blob);
    const jobId = await jobs.startFileUpload(meta, stagingId, true);
    expect(staging.size()).toBe(0);
    await jobs.settled(jobId);
    const job = await analysisJobStore.find(jobId);
    expect(job).toMatchObject({ kind: 'file', target: 'cv.pdf', phase: 'completed' });
    expect(client.uploadFile).toHaveBeenCalledTimes(1);
    expect((await statsStore.get()).counters.filesUploaded).toBe(1);
    expect((await timelineStore.get())[0]?.kind).toBe('file-uploaded');
  });

  it('marks jobs interrupted by a worker restart', async () => {
    await analysisJobStore.put({
      id: 'old',
      kind: 'url',
      target: 'https://x.test/',
      phase: 'in-progress',
      startedAt: 1,
      updatedAt: 1,
      polls: 3,
      analysisId: 'a',
      report: null,
      error: null,
    });
    const { jobs } = setup();
    await jobs.recoverInterrupted();
    expect(await analysisJobStore.find('old')).toMatchObject({ phase: 'failed', error: { code: 'interrupted' } });
  });

  it('keeps only the most recent jobs', async () => {
    for (let i = 0; i < 15; i++) {
      await analysisJobStore.put({ id: `j${i}`, kind: 'url', target: 't', phase: 'completed', startedAt: i, updatedAt: i, polls: 0, analysisId: null, report: null, error: null });
    }
    const ids = Object.keys(await analysisJobStore.get());
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain('j0');
    expect((await analysisJobStore.latest('url'))?.id).toBe('j14');
  });
});
