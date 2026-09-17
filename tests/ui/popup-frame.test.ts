import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { footerHtml } from '../../src/popup/Footer';

const css = readFileSync(resolve(import.meta.dirname, '../../src/popup/popup.css'), 'utf8');
const theme = readFileSync(resolve(import.meta.dirname, '../../src/shared/styles/theme.css'), 'utf8');
const extraCss = [
  'src/shared/styles/report.css',
  'src/warning/Warning.css',
  'src/popup/Home/Home.css',
  'src/popup/Settings/Settings.css',
  'src/popup/AdvancedAnalysis/AdvancedAnalysis.css',
  'src/popup/DocumentScanner/DocumentScanner.css',
  'src/popup/Timeline/Timeline.css',
  'src/popup/Statistics/Statistics.css',
].map((file) => readFileSync(resolve(import.meta.dirname, '../..', file), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../public/manifest.json'), 'utf8'));

describe('popup frame', () => {
  it('is fixed at exactly 440 × 600', () => {
    const rootRule = /html,\s*body\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    for (const property of ['width', 'min-width', 'max-width']) expect(rootRule).toMatch(new RegExp(`(^|\\s)${property}: 440px;`));
    for (const property of ['height', 'min-height', 'max-height']) expect(rootRule).toMatch(new RegExp(`(^|\\s)${property}: 600px;`));
    const popupRule = /\.popup\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(popupRule).toContain('width: 440px');
    expect(popupRule).toContain('height: 600px');
  });

  it('has a solid black background with no coloured glow', () => {
    const popupRule = /\.popup\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(popupRule).toContain('background: var(--bg);');
    expect(popupRule).not.toContain('radial-gradient');
    expect(theme).not.toMatch(/--bg-glow-[abc]:\s*rgba/);
    expect(extraCss.join('\n')).not.toContain('radial-gradient(640px');
  });

  it('has curved corners and clips its content to them', () => {
    const popupRule = /\.popup\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(popupRule).toContain('border-radius: var(--radius-xl)');
    expect(popupRule).toContain('overflow: hidden');
    expect(theme).toMatch(/--radius-xl:\s*22px/);
  });

  it('uses exactly #0b0b0d black and #ff6a00 orange, with no blue accents left', () => {
    expect(theme).toMatch(/--brand-black:\s*#0b0b0d;/);
    expect(theme).toMatch(/--brand-orange:\s*#ff6a00;/);
    expect(theme).toMatch(/--bg:\s*var\(--brand-black\);/);
    expect(theme).toMatch(/--canvas:\s*var\(--brand-black\);/);
    expect(theme).toMatch(/--accent:\s*var\(--brand-orange\);/);
    expect(theme).toMatch(/--accent-gradient:\s*var\(--brand-orange\);/);
    expect(theme).toMatch(/--safe:\s*#22c55e/);
    // Only these two brand hexes may appear as blacks/oranges.
    const hexes = [...[theme, css, ...extraCss].join('\n').matchAll(/#[0-9a-f]{6}\b/gi)].map((match) => match[0].toLowerCase());
    for (const hex of hexes) {
      expect(['#0b0b0d', '#ff6a00', '#f5f2ed', '#a8a29a', '#6f6a63', '#22c55e', '#facc15', '#ef4444', '#b91c1c', '#9a948c',
        '#d9d3ca', '#f4f0ea', '#5f574d', '#958b7f', '#15803d', '#a16207', '#dc2626', '#78716c'], hex).toContain(hex);
    }
    const everyStylesheet = [theme, css, ...extraCss].join('\n');
    for (const blue of ['#38bdf8', '#0ea5e9', '#818cf8', '#6366f1', '56, 189, 248', '99, 102, 241']) {
      expect(everyStylesheet, blue).not.toContain(blue);
    }
  });

  it('has a 20px footer with only version, privacy and terms', () => {
    const footerRule = /\.popup-footer\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(footerRule).toContain('height: 20px');
    document.body.innerHTML = footerHtml('1.2.3');
    const footer = document.querySelector('footer')!;
    expect([...footer.querySelectorAll('span[data-role], a')].map((node) => node.textContent)).toEqual(['v1.2.3', 'Privacy', 'Terms']);
  });
});

describe('manifest', () => {
  it('is Manifest V3 with a local-only footprint', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).not.toContain('identity');
    expect(manifest.oauth2).toBeUndefined();
    expect(manifest.content_security_policy.extension_pages).toContain('connect-src https://www.virustotal.com;');
    expect(manifest.optional_permissions).toContain('clipboardRead');
    expect(manifest.permissions).not.toContain('clipboardRead');
  });
});
