import { describe, expect, it } from 'vitest';
import { statsStore } from '../../src/storage/StatsStore';
import { createService, fakeClient, TEST_KEY, VirtualClock, vtSummary } from './helpers';

describe('VirusTotalService', () => {
  it('checks the Smart Cache before calling VirusTotal', async () => {
    const { service, client } = createService();
    const first = await service.lookup('domain', 'example.com');
    const second = await service.lookup('domain', 'example.com');
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(client.getDomainReport).toHaveBeenCalledTimes(1);
    expect(client.getDomainReport).toHaveBeenCalledWith('example.com', TEST_KEY, expect.anything());
    const stats = await statsStore.get();
    expect(stats.counters.virusTotalRequests).toBe(1);
    expect(stats.counters.cacheHits).toBe(1);
  });

  it('bypasses the cache when forced', async () => {
    const { service, client } = createService();
    await service.lookup('url', 'https://a.test/');
    await service.lookup('url', 'https://a.test/', { force: true });
    expect(client.getUrlReport).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent lookups', async () => {
    const { service, client } = createService();
    await Promise.all([service.lookup('domain', 'x.test'), service.lookup('domain', 'x.test')]);
    expect(client.getDomainReport).toHaveBeenCalledTimes(1);
  });

  it('reports no-key without touching the network', async () => {
    const { service, client } = createService(fakeClient(), null);
    expect((await service.lookup('domain', 'a.test')).status).toBe('no-key');
    expect(client.getDomainReport).not.toHaveBeenCalled();
  });

  it('respects the public API rate limit', async () => {
    const { service, client } = createService();
    const results = [];
    for (const host of ['a.test', 'b.test', 'c.test', 'd.test', 'e.test']) results.push(await service.lookup('domain', host));
    expect(results.map((result) => result.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'rate-limited']);
    expect(client.getDomainReport).toHaveBeenCalledTimes(4);
  });

  it('cools down after a quota error and does not cache it', async () => {
    const { service, client } = createService(fakeClient({ status: 'quota-exceeded', summary: null }));
    expect((await service.lookup('domain', 'a.test')).status).toBe('quota-exceeded');
    expect((await service.lookup('domain', 'a.test')).status).toBe('rate-limited');
    expect(client.getDomainReport).toHaveBeenCalledTimes(1);
  });

  it('reports API health states', async () => {
    expect((await createService().service.checkHealth()).state).toBe('online');
    expect((await createService(fakeClient(), null).service.checkHealth()).state).toBe('no-key');
    expect((await createService(fakeClient({ status: 'invalid-key' })).service.checkHealth()).state).toBe('invalid-key');
    expect((await createService(fakeClient({ status: 'unreachable' })).service.checkHealth()).state).toBe('unreachable');
    expect((await createService(fakeClient({ status: 'quota-exceeded' })).service.checkHealth()).state).toBe('quota-exceeded');
  });

  it('invalidates the cached URL after a successful submission', async () => {
    const { service, client } = createService(fakeClient({ status: 'not-found', summary: null, core: null }));
    await service.lookup('url', 'https://new.test/');
    expect(await service.submitUrl('https://new.test/')).toEqual({ status: 'ok', analysisId: 'an-1' });
    await service.lookup('url', 'https://new.test/');
    expect(client.getUrlReport).toHaveBeenCalledTimes(2);
  });

  it('re-checks dangerous results on every lookup', async () => {
    const { service, client } = createService(fakeClient({ summary: vtSummary(5) }));
    await service.lookup('domain', 'bad.test');
    const again = await service.lookup('domain', 'bad.test');
    expect(client.getDomainReport).toHaveBeenCalledTimes(2);
    expect(again.fromCache).toBe(false);
  });

  it('falls back to a clearly-marked stale entry when VirusTotal is unreachable', async () => {
    const client = fakeClient({ summary: vtSummary(5) });
    const { service } = createService(client);
    await service.lookup('domain', 'bad.test');
    client.getDomainReport.mockResolvedValue({ status: 'unreachable', summary: null, latencyMs: null });
    const offline = await service.lookup('domain', 'bad.test');
    expect(offline).toMatchObject({ status: 'ok', fromCache: true, stale: true, failure: 'unreachable' });
    expect(offline.summary?.stats.malicious).toBe(5);
  });

  it('does not invent results when offline without a cache entry', async () => {
    const { service } = createService(fakeClient({ status: 'unreachable', summary: null, core: null }));
    expect(await service.lookup('url', 'https://x.test/')).toMatchObject({ status: 'unreachable', fromCache: false, core: null });
  });

  it('peeks at the cache without touching the network', async () => {
    const { service, client } = createService();
    expect(await service.peek('domain', 'a.test')).toBeNull();
    await service.lookup('domain', 'a.test');
    expect((await service.peek('domain', 'a.test'))?.fromCache).toBe(true);
    expect(client.getDomainReport).toHaveBeenCalledTimes(1);
  });

  it('waits for a rate-limit slot when asked to', async () => {
    const clock = new VirtualClock();
    const { service, client } = createService(fakeClient(), TEST_KEY, clock);
    for (let i = 0; i < 4; i++) await service.getAnalysis('an', { wait: true });
    const fifth = await service.getAnalysis('an', { wait: true });
    expect(fifth.status).toBe('ok');
    expect(client.getAnalysis).toHaveBeenCalledTimes(5);
    expect(clock.sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(60_000);
  });

  it('gives up waiting at the deadline', async () => {
    const clock = new VirtualClock();
    const { service } = createService(fakeClient(), TEST_KEY, clock);
    for (let i = 0; i < 4; i++) await service.getAnalysis('an');
    const result = await service.getAnalysis('an', { wait: true, deadline: clock.time + 5_000 });
    expect(result.status).toBe('rate-limited');
  });
});
