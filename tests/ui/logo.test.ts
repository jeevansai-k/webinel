import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logoMark } from '../../src/shared/icons';

const master = readFileSync(resolve(import.meta.dirname, '../../src/assets/logo.svg'), 'utf8');
const shapes = (svg: string) => [...svg.matchAll(/<(path|rect|circle)\b([^>]*?)\/>/g)].map((m) => `${m[1]}${m[2].replace(/\s*fill="url\(#[^)]+\)"/, '')}`);

describe('Webinel logo', () => {
  it('draws the same watchtower in the inline mark as in src/assets/logo.svg', () => {
    expect(shapes(logoMark(32, 'x'))).toEqual(shapes(master));
    expect(shapes(master).length).toBeGreaterThan(5);
  });

  it('gives every instance its own gradient ids', () => {
    const home = logoMark(34, 'home');
    const warning = logoMark(34, 'warning');
    const ids = (svg: string) => [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(home)).toEqual(['wl-tower-home', 'wl-beam-home']);
    expect(ids(home).filter((id) => ids(warning).includes(id))).toEqual([]);
    // Every gradient reference points at an id defined in the same mark.
    for (const ref of home.matchAll(/url\(#([^)]+)\)/g)) expect(ids(home)).toContain(ref[1]);
  });
});
