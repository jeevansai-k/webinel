import { describe, expect, it } from 'vitest';
import { mountScreen, text } from '../../../tests/setup/screen';
import { statsStore } from '../../storage/StatsStore';
import { mount } from './Statistics';

describe('Statistics screen', () => {
  it('shows totals, a 7-day chart and verdict counts', async () => {
    await statsStore.recordVerdict('safe');
    await statsStore.recordVerdict('dangerous');
    await statsStore.increment('blocked');
    const { root } = await mountScreen(mount);

    const tiles = [...root.querySelectorAll('.stat-tile')].map((tile) => text(tile));
    expect(tiles[0]).toBe('2 Sites checked');
    expect(tiles[1]).toBe('1 Threats blocked');

    const bars = root.querySelectorAll<HTMLElement>('.bar');
    expect(bars).toHaveLength(7);
    const today = bars[6]!;
    expect(today.querySelector<HTMLElement>('.bar__fill')!.style.height).toBe('100%');
    expect(text(today.querySelector('.bar__tip'))).toContain('2 checked · 1 threat');
    expect(root.querySelector('[data-role="chart"]')!.getAttribute('aria-label')).toContain('Sites checked per day');

    const verdicts = [...root.querySelectorAll('[data-role="verdicts"] .list-row')].map((row) => text(row));
    expect(verdicts).toEqual(['Safe 1', 'Suspicious 0', 'Dangerous 1', 'Unverified 0', 'Check failed 0']);
  });

  it('updates live when statistics change', async () => {
    const { root } = await mountScreen(mount);
    await statsStore.recordVerdict('safe');
    expect(text(root.querySelector('.stat-tile'))).toBe('1 Sites checked');
  });
});
