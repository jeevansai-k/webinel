import { mountScreenHeader } from '../../shared/components/ScreenHeader';
import { query } from '../../shared/dom';
import { mountFooter } from '../Footer';
import type { ScreenContext } from '../router';
import template from './Legal.html?raw';
import './Legal.css';

export type LegalSection = 'privacy' | 'terms';

const TITLES: Record<LegalSection, string> = { privacy: 'Privacy', terms: 'Terms' };

/** Shows one section at a time; the body scrolls inside the popup. */
export function showSection(root: HTMLElement, section: LegalSection): void {
  for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-section]')) {
    const selected = tab.dataset.section === section;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of root.querySelectorAll<HTMLElement>('[data-panel]')) {
    panel.hidden = panel.dataset.panel !== section;
  }
  const title = root.querySelector('.screen-header__title');
  if (title) title.textContent = TITLES[section];
  query(root, '[data-role="scroller"]').scrollTop = 0;
}

/** Privacy & Terms, shown inside the popup (never in a browser tab). */
export function mount(root: HTMLElement, ctx: ScreenContext, section: LegalSection): void {
  root.innerHTML = template;
  mountScreenHeader(root, TITLES[section], 'lock', ctx.back);
  // Footer links switch sections in place instead of stacking more screens.
  mountFooter(root, (target) => showSection(root, target));
  for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-section]')) {
    tab.addEventListener('click', () => showSection(root, tab.dataset.section as LegalSection));
  }
  showSection(root, section);
}
