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

  it('has a solid themed background', () => {
    const popupRule = /\.popup\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(popupRule).toContain('background: var(--bg);');
    expect(popupRule).not.toContain('gradient');
  });

  it('has curved corners and clips its content to them', () => {
    const popupRule = /\.popup\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(popupRule).toContain('border-radius: var(--radius-xl)');
    expect(popupRule).toContain('overflow: hidden');
    expect(theme).toMatch(/--radius-xl:\s*22px/);
  });

  it('uses the Nightwatch palette: blue-ink neutrals and one signal accent', () => {
    expect(theme).toMatch(/--brand-ink:\s*#070c16;/);
    expect(theme).toMatch(/--brand-signal:\s*#4cc2ff;/);
    expect(theme).toMatch(/--accent:\s*var\(--brand-signal\);/);
    expect(theme).toMatch(/--on-accent:\s*var\(--brand-ink\);/);
    // Light theme redefines every surface and the accent.
    const light = /:root\[data-theme='light'\]\s*{([^}]*)}/.exec(theme)?.[1] ?? '';
    for (const token of ['--bg', '--surface', '--text', '--accent', '--safe', '--warn', '--danger']) {
      expect(light, token).toMatch(new RegExp(`${token}:`));
    }
  });

  it('keeps every colour in theme tokens and drops the old black/orange brand', () => {
    const everyStylesheet = [theme, css, ...extraCss].join('\n');
    for (const legacy of ['#0b0b0d', '#ff6a00', '255, 106, 0', '--brand-orange', '--brand-black', '--glass-stroke']) {
      expect(everyStylesheet, legacy).not.toContain(legacy);
    }
    // Component stylesheets reference tokens; hex values live only in theme.css (white highlights excepted).
    for (const sheet of [css, ...extraCss]) {
      const hexes = [...sheet.matchAll(/#[0-9a-f]{3,6}\b/gi)].map((match) => match[0].toLowerCase());
      expect(hexes.filter((hex) => hex !== '#ffffff' && hex !== '#fff' && hex !== '#000')).toEqual([]);
    }
  });

  it('bundles its fonts locally', () => {
    for (const face of ['Inter Variable', 'Space Grotesk Variable', 'JetBrains Mono Variable']) {
      expect(theme).toContain(`font-family: '${face}'`);
    }
    expect(theme).not.toMatch(/url\(['"]?https?:/);
  });

  it('has a 20px footer with only version, privacy and terms', () => {
    const footerRule = /\.popup-footer\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(footerRule).toContain('height: 20px');
    document.body.innerHTML = footerHtml('1.2.3');
    const footer = document.querySelector('footer')!;
    expect([...footer.querySelectorAll('span[data-role], a')].map((node) => node.textContent)).toEqual(['v1.2.3', 'Privacy', 'Terms']);
  });
});

describe('side panel', () => {
  it('registers the Document Scanner as Firefox sidebar and Chrome side panel', () => {
    expect(manifest.sidebar_action.default_panel).toBe('popup/index.html?mode=panel#documents');
    expect(manifest.sidebar_action.open_at_install).toBe(false);
    expect(manifest.side_panel.default_path).toBe('popup/index.html?mode=panel#documents');
    expect(manifest.permissions).toContain('sidePanel');
  });

  it('lets the panel page grow past the fixed popup frame', () => {
    expect(css).toMatch(/:root\[data-mode='panel'\] body\s*{[^}]*max-width: none;/);
    expect(css).toMatch(/:root\[data-mode='panel'\] \.popup\s*{[^}]*width: 100%;/);
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
