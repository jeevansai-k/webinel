import { mountScreenHeader } from '../../shared/components/ScreenHeader';
import { verdictChip } from '../../shared/components/VerdictChip';
import { LIMITS } from '../../shared/config';
import { escapeHtml, query } from '../../shared/dom';
import { icon, type IconName } from '../../shared/icons';
import type { Verdict } from '../../shared/verdict';
import { lastDays, statsStore, type CounterName, type Statistics } from '../../storage/StatsStore';
import { mountFooter } from '../Footer';
import type { Cleanup, ScreenContext } from '../router';
import template from './Statistics.html?raw';
import './Statistics.css';

const numberFormat = new Intl.NumberFormat();

const TILES: Array<{ label: string; icon: IconName; value: (stats: Statistics) => number }> = [
  { label: 'Sites checked', icon: 'globe', value: (stats) => stats.scanned },
  { label: 'Threats blocked', icon: 'shieldAlert', value: (stats) => stats.counters.blocked },
  { label: 'Warnings shown', icon: 'bolt', value: (stats) => stats.counters.warned },
  { label: 'Downloads stopped', icon: 'download', value: (stats) => stats.counters.downloadsBlocked },
];

const VERDICT_ORDER: Verdict[] = ['safe', 'suspicious', 'dangerous', 'unknown', 'error'];

const COUNTERS: Array<{ name: CounterName; label: string }> = [
  { name: 'virusTotalRequests', label: 'VirusTotal requests' },
  { name: 'cacheHits', label: 'Smart Cache hits' },
  { name: 'quickScans', label: 'Scan Now checks' },
  { name: 'fullAnalyses', label: 'Full analyses' },
  { name: 'linksScanned', label: 'Links scanned' },
  { name: 'filesScanned', label: 'Documents scanned' },
  { name: 'filesUploaded', label: 'Files uploaded (with consent)' },
  { name: 'bypassed', label: 'Warnings bypassed' },
];

export function renderChart(chart: HTMLElement, stats: Statistics, now = Date.now()): void {
  const days = lastDays(stats, LIMITS.statsDays, now);
  const max = Math.max(1, ...days.map((day) => day.scanned));
  chart.setAttribute(
    'aria-label',
    `Sites checked per day: ${days.map((day) => `${day.day} ${day.scanned}`).join(', ')}`,
  );
  chart.innerHTML = days
    .map((day) => {
      const date = new Date(`${day.day}T12:00:00`);
      const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
      const height = day.scanned === 0 ? 0 : Math.max(4, (day.scanned / max) * 100);
      return `<div class="bar" tabindex="0" data-day="${day.day}">
        <span class="bar__tip">${escapeHtml(date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))} · ${day.scanned} checked · ${day.threats} threat${day.threats === 1 ? '' : 's'}</span>
        <span class="bar__value">${day.scanned || ''}</span>
        <div class="bar__track"><div class="bar__fill" data-height="${height}"></div></div>
        <span class="bar__day">${escapeHtml(weekday)}</span>
      </div>`;
    })
    .join('');
  // Extension CSP forbids inline style attributes; size bars through the CSSOM.
  for (const fill of chart.querySelectorAll<HTMLElement>('.bar__fill')) {
    fill.style.height = `${fill.dataset.height}%`;
  }
}

export function render(root: HTMLElement, stats: Statistics): void {
  query(root, '[data-role="tiles"]').innerHTML = TILES.map(
    (tile) => `<div class="glass stat-tile">
      <div class="stat-tile__value">${numberFormat.format(tile.value(stats))}</div>
      <div class="stat-tile__label">${icon(tile.icon, 13)}${tile.label}</div>
    </div>`,
  ).join('');

  renderChart(query(root, '[data-role="chart"]'), stats);

  query(root, '[data-role="verdicts"]').innerHTML = VERDICT_ORDER.map(
    (verdict) => `<li class="list-row">
      <div class="list-row__main">${verdictChip(verdict)}</div>
      <span class="list-row__value">${numberFormat.format(stats.verdicts[verdict])}</span>
    </li>`,
  ).join('');

  query(root, '[data-role="counters"]').innerHTML = COUNTERS.map(
    (counter) => `<li class="list-row">
      <div class="list-row__main">${counter.label}</div>
      <span class="list-row__value">${numberFormat.format(stats.counters[counter.name] ?? 0)}</span>
    </li>`,
  ).join('');

  query(root, '[data-role="since"]').textContent = `since ${new Date(stats.since).toLocaleDateString()}`;
}

export async function mount(root: HTMLElement, ctx: ScreenContext): Promise<Cleanup> {
  root.innerHTML = template;
  mountScreenHeader(root, 'Statistics', 'statistics', ctx.back);
  mountFooter(root, ctx.navigate);
  render(root, await statsStore.get());
  return statsStore.subscribe((stats) => render(root, stats));
}
