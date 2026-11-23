// Rasterizes src/assets/logo.svg into the PNG sizes the manifest needs.
// Uses Playwright's Chromium (SVG rendering identical to the browser). Output is
// committed, so this only runs when the logo changes: `npm run build:icons`.
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('build-icons needs Playwright: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');
const svg = readFileSync(resolve(root, 'src/assets/logo.svg'), 'utf8');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  const target = resolve(outDir, `icon-${size}.png`);
  await page.setViewportSize({ width: size, height: size });
  const sized = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${sized}</body>`);
  await page.screenshot({ path: target, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`wrote ${target}`);
}
await browser.close();
