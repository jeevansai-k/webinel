// Rasterizes src/assets/logo.svg into the PNG sizes the manifest needs.
// Requires ImageMagick (`convert`). Output is committed, so this only runs when the logo changes.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'src/assets/logo.svg');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const target = resolve(outDir, `icon-${size}.png`);
  execFileSync('convert', ['-background', 'none', '-density', '1200', source, '-resize', `${size}x${size}`, target]);
  console.log(`wrote ${target}`);
}
