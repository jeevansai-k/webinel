import { describe, expect, it } from 'vitest';
import { hasTemporaryBypass, pendingWarnings } from '../../src/background/SessionState';
import { ProtectionController } from '../../src/background/ProtectionController';
import { ThreatEngine } from '../../src/services/ThreatEngine';
import { activityStore } from '../../src/storage/ActivityStore';
import { settingsStore } from '../../src/storage/SettingsStore';
import { statsStore } from '../../src/storage/StatsStore';
import { timelineStore } from '../../src/storage/TimelineStore';
import { whitelistStore } from '../../src/storage/WhitelistStore';
import { chromeFake } from '../setup/chromeMock';
import { createService, fakeClient, vtSummary } from './helpers';

function controller(malicious: number) {
  const { service } = createService(fakeClient({ summary: vtSummary(malicious) }));
  return new ProtectionController(new ThreatEngine(service));
}

describe('ProtectionController', () => {
  it('redirects dangerous navigations to the warning page with an opaque id', async () => {
    const tabs = chromeFake().tabs;
    await controller(6).handleNavigation(5, 'https://evil.test/login?session=secret');

    expect(tabs.update).toHaveBeenCalledTimes(1);
    const [tabId, { url }] = tabs.update.mock.calls[0] as unknown as [number, { url: string }];
    expect(tabId).toBe(5);
    expect(url).toMatch(/^chrome-extension:\/\/webinel-test\/warning\/Warning\.html\?id=[\w-]+$/);
    expect(url).not.toContain('evil.test');

    const warnings = Object.values(await pendingWarnings.get());
    expect(warnings[0]).toMatchObject({ tabId: 5, host: 'evil.test', verdict: 'dangerous' });
    expect((await statsStore.get()).counters.blocked).toBe(1);
    expect((await timelineStore.get())[0]).toMatchObject({ kind: 'blocked', subject: 'evil.test' });
    expect((await activityStore.get())[0]).toMatchObject({ host: 'evil.test', status: 'blocked' });
    expect(chromeFake().action.setBadgeText).toHaveBeenCalledWith({ tabId: 5, text: '!!' });
  });

  it('blocks even while Chrome still reports the previous page for the tab', async () => {
    // Regression: tabs.get() can lag behind a fresh navigation (e.g. still chrome://newtab).
    chromeFake().tabs.get.mockResolvedValue({ id: 5, url: 'chrome://newtab/' } as chrome.tabs.Tab);
    await controller(6).handleNavigation(5, 'http://paypal.com.secure-login.verify-account.invalid/signin');
    expect(chromeFake().tabs.update).toHaveBeenCalledWith(5, { url: expect.stringContaining('warning/Warning.html?id=') });
  });

  it('does not redirect a tab that already moved elsewhere', async () => {
    const client = fakeClient();
    client.getDomainReport.mockImplementation(async (host: string) => ({
      status: 'ok' as const,
      summary: vtSummary(host === 'evil.test' ? 6 : 0),
      latencyMs: 1,
    }));
    const protection = new ProtectionController(new ThreatEngine(createService(client).service));
    const evil = protection.handleNavigation(5, 'https://evil.test/');
    const other = protection.handleNavigation(5, 'https://other.test/');
    await Promise.all([evil, other]);
    expect(chromeFake().tabs.update).not.toHaveBeenCalled();
  });

  it('evaluates one navigation once even when several events report it', async () => {
    const client = fakeClient({ summary: vtSummary(6) });
    const { service } = createService(client);
    const protection = new ProtectionController(new ThreatEngine(service));
    await Promise.all([
      protection.handleNavigation(5, 'https://evil.test/'),
      protection.handleNavigation(5, 'https://evil.test/'),
      protection.handleNavigation(5, 'https://evil.test/'),
    ]);
    expect(chromeFake().tabs.update).toHaveBeenCalledTimes(1);
    expect(client.getDomainReport).toHaveBeenCalledTimes(1);
    expect(Object.keys(await pendingWarnings.get())).toHaveLength(1);
  });

  it('blocks again when the user returns to the blocked page', async () => {
    const protection = controller(6);
    await protection.handleNavigation(5, 'https://evil.test/');
    const [, { url: warningUrl }] = chromeFake().tabs.update.mock.calls[0] as unknown as [number, { url: string }];
    await protection.handleNavigation(5, warningUrl);
    await protection.handleNavigation(5, 'https://evil.test/');
    expect(chromeFake().tabs.update).toHaveBeenCalledTimes(2);
  });

  it('re-evaluates the same page after the duplicate window', async () => {
    let now = 0;
    const client = fakeClient();
    const { service } = createService(client);
    const protection = new ProtectionController(new ThreatEngine(service), () => now);
    await protection.handleNavigation(5, 'https://fine.test/');
    await protection.handleNavigation(5, 'https://fine.test/');
    expect((await activityStore.get())).toHaveLength(1);
    now += 11_000;
    await chrome.storage.local.remove('activity');
    await protection.handleNavigation(5, 'https://fine.test/');
    expect((await activityStore.get())).toHaveLength(1);
  });

  it('shows no warning if the tab cannot be redirected', async () => {
    chromeFake().tabs.update.mockRejectedValue(new Error('No tab with id: 5'));
    await expect(controller(6).handleNavigation(5, 'https://evil.test/')).resolves.toMatchObject({ action: 'block' });
    expect((await statsStore.get()).counters.blocked).toBe(0);
  });

  it('allows safe sites and records activity', async () => {
    const report = await controller(0).handleNavigation(2, 'https://fine.test/');
    expect(report?.action).toBe('allow');
    expect(chromeFake().tabs.update).not.toHaveBeenCalled();
    expect((await activityStore.get())[0]).toMatchObject({ host: 'fine.test', status: 'safe' });
  });

  it('skips non-web pages and respects the real-time toggle', async () => {
    const protection = controller(6);
    expect(await protection.handleNavigation(1, 'chrome://settings')).toBeNull();
    await settingsStore.patch({ realTimeProtection: false });
    expect(await protection.handleNavigation(1, 'https://evil.test/')).toBeNull();
    expect(chromeFake().tabs.update).not.toHaveBeenCalled();
  });

  it('Continue Anyway grants a temporary bypass and returns the original URL once', async () => {
    const protection = controller(6);
    await protection.handleNavigation(5, 'https://evil.test/a');
    const [warning] = Object.values(await pendingWarnings.get());

    expect(await protection.continueAnyway(warning!.id)).toBe('https://evil.test/a');
    expect(await hasTemporaryBypass('evil.test')).toBe(true);
    await expect(protection.continueAnyway(warning!.id)).rejects.toThrow(/expired/);

    chromeFake().tabs.update.mockClear();
    // location.replace(url) from the warning page starts a new navigation.
    const again = await protection.handleNavigation(5, 'https://evil.test/a');
    expect(again?.verdict).toBe('dangerous');
    expect(chromeFake().tabs.update).not.toHaveBeenCalled();
    expect((await statsStore.get()).counters.bypassed).toBe(1);
  });

  it('Whitelist this Site trusts the host permanently', async () => {
    const protection = controller(6);
    await protection.handleNavigation(9, 'https://evil.test/');
    const [warning] = Object.values(await pendingWarnings.get());
    expect(await protection.whitelistFromWarning(warning!.id)).toBe('https://evil.test/');
    expect(await whitelistStore.contains('evil.test')).toBe(true);
  });

  it('forgets per-tab state when a tab closes', async () => {
    const protection = controller(0);
    await protection.handleNavigation(4, 'https://fine.test/');
    expect(await protection.currentReport(4)).not.toBeNull();
    await protection.forget(4);
    expect(await protection.currentReport(4)).toBeNull();
  });
});
