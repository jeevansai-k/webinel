import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromeFake } from '../../../tests/setup/chromeMock';
import { fakeContext, text } from '../../../tests/setup/screen';
import { mount, type LegalSection } from './Legal';

function open(section: LegalSection) {
  const root = document.createElement('section');
  document.body.append(root);
  const ctx = fakeContext();
  mount(root, ctx, section);
  return { root, ctx };
}

const visiblePanel = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('[data-panel]')].filter((panel) => !panel.hidden).map((panel) => panel.dataset.panel);

describe('Privacy & Terms screen', () => {
  it('opens on the requested section inside the popup', () => {
    const privacy = open('privacy');
    expect(visiblePanel(privacy.root)).toEqual(['privacy']);
    expect(text(privacy.root.querySelector('.screen-header__title'))).toBe('Privacy');
    expect(text(privacy.root.querySelector('[data-panel="privacy"]'))).toContain('no servers, no accounts and no sign-in');

    const terms = open('terms');
    expect(visiblePanel(terms.root)).toEqual(['terms']);
    expect(text(terms.root.querySelector('.screen-header__title'))).toBe('Terms');
    expect(terms.root.querySelector('[data-section="terms"]')!.getAttribute('aria-selected')).toBe('true');
    expect(chromeFake().tabs.create).not.toHaveBeenCalled();
  });

  it('switches sections with the tabs and with the footer links, without leaving the screen', () => {
    const { root, ctx } = open('privacy');
    const scroller = root.querySelector<HTMLElement>('[data-role="scroller"]')!;
    scroller.scrollTop = 120;
    root.querySelector<HTMLButtonElement>('[data-section="terms"]')!.click();
    expect(visiblePanel(root)).toEqual(['terms']);
    expect(scroller.scrollTop).toBe(0);

    root.querySelector<HTMLAnchorElement>('.popup-footer [data-legal="privacy"]')!.click();
    expect(visiblePanel(root)).toEqual(['privacy']);
    expect(ctx.navigate).not.toHaveBeenCalled();
    expect(chromeFake().tabs.create).not.toHaveBeenCalled();
  });

  it('has a back button and a scrolling body with a visible scrollbar', () => {
    const { root, ctx } = open('privacy');
    root.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    expect(ctx.back).toHaveBeenCalled();
    const scroller = root.querySelector('[data-role="scroller"]')!;
    expect(scroller.classList.contains('scroll')).toBe(true);
    const css = readFileSync(resolve(import.meta.dirname, 'Legal.css'), 'utf8');
    expect(css).toMatch(/\.legal-body\s*{[^}]*overflow-y:\s*scroll;[^}]*scrollbar-gutter:\s*stable;/);
  });
});
