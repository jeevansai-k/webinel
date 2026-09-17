import { describe, expect, it } from 'vitest';
import { mountScreen, text } from '../../../tests/setup/screen';
import { timelineStore } from '../../storage/TimelineStore';
import { filterEvents, mount } from './Timeline';

async function seed() {
  await timelineStore.record({ kind: 'whitelisted', subject: 'trusted.test', verdict: null, detail: 'Added' });
  await timelineStore.record({ kind: 'manual-scan', subject: 'scan.test', verdict: 'safe', detail: 'Site scan' });
  await timelineStore.record({ kind: 'blocked', subject: 'evil.test', verdict: 'dangerous', detail: 'Phishing' });
}

describe('Timeline screen', () => {
  it('lists events newest first with tone by verdict', async () => {
    await seed();
    const { root } = await mountScreen(mount);
    const items = [...root.querySelectorAll('.timeline-item')];
    expect(items.map((item) => text(item.querySelector('.timeline-item__title')))).toEqual([
      'Blocked · evil.test',
      'Scanned · scan.test',
      'Trusted · trusted.test',
    ]);
    expect(items[0]!.querySelector('[data-tone="danger"]')).not.toBeNull();
  });

  it('filters by category', async () => {
    await seed();
    const { root } = await mountScreen(mount);
    root.querySelector<HTMLButtonElement>('[data-filter="threats"]')!.click();
    expect(root.querySelectorAll('.timeline-item')).toHaveLength(1);
    expect(root.querySelector('[data-filter="threats"]')!.getAttribute('aria-selected')).toBe('true');
    expect(filterEvents(await timelineStore.get(), 'changes').map((event) => event.subject)).toEqual(['trusted.test']);
  });

  it('shows new events live and an empty state', async () => {
    const { root } = await mountScreen(mount);
    expect(text(root)).toContain('No security events yet');
    await timelineStore.record({ kind: 'warned', subject: 'odd.test', verdict: 'suspicious', detail: 'Odd' });
    expect(root.querySelectorAll('.timeline-item')).toHaveLength(1);
  });
});
