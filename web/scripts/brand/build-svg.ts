// SPDX-License-Identifier: Apache-2.0
// Writes the brand's vector assets to web/public/brand and docs/brand from the same generators the site uses.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ring, rosette } from '../../src/brand/guilloche.ts';
import { markPalettes, markSvg } from '../../src/brand/mark.ts';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..', '..');
const outs = [resolve(web, 'public/brand'), resolve(web, '..', 'docs/brand')];
outs.forEach((d) => mkdirSync(d, { recursive: true }));
const write = (name: string, content: string) => outs.forEach((d) => writeFileSync(resolve(d, name), content));

const glyphs = JSON.parse(readFileSync(resolve(here, 'wordmark-glyphs.json'), 'utf8')) as { d: string; width: number; ascent: number; descent: number };
const PAPER = '#EDE6D6';
const INK = '#0B0D12';

// Marks
write('mark-wax.svg', markSvg(markPalettes.wax, { size: 256 }));
write('mark-paper.svg', markSvg(markPalettes.paper, { size: 256 }));
write('mark-ink.svg', markSvg(markPalettes.ink, { size: 256 }));
write('mark-small.svg', markSvg(markPalettes.wax, { simple: true, size: 32 }));
write('favicon.svg', markSvg(markPalettes.wax, { simple: true, size: 32 }));

// Wordmark: font units scaled to a 64-unit cap band.
const em = glyphs.ascent - glyphs.descent;
const scale = 64 / em;
const wordW = Math.ceil(glyphs.width * scale);
const wordPath = (fill: string, x = 0, y = 0) =>
  `<path transform="translate(${x} ${y + glyphs.ascent * scale}) scale(${scale.toFixed(5)})" d="${glyphs.d}" fill="${fill}"/>`;
write('wordmark.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${wordW}" height="64" viewBox="0 0 ${wordW} 64">${wordPath(PAPER)}</svg>`);
write('wordmark-ink.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${wordW}" height="64" viewBox="0 0 ${wordW} 64">${wordPath(INK)}</svg>`);

const inner = (svg: string) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
// Horizontal lockup: mark 64, gap 18, wordmark; clear space = 32 on every side.
{
  const W = 32 + 64 + 18 + wordW + 32;
  const H = 128;
  write(
    'lockup-horizontal.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${INK}"/><g transform="translate(32 32)">${inner(markSvg(markPalettes.wax))}</g>${wordPath(PAPER, 32 + 64 + 18, 32 + 4)}</svg>`,
  );
}
// Stacked lockup on paper.
{
  const W = Math.max(wordW, 96) + 96;
  const H = 96 + 20 + 64 + 96;
  write(
    'lockup-stacked.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/><g transform="translate(${(W - 96) / 2} 48) scale(1.5)">${inner(markSvg(markPalettes.ink))}</g>${wordPath(INK, (W - wordW) / 2, 48 + 96 + 20)}</svg>`,
  );
}
// Guilloché pattern tile.
{
  const paths = [...ring(300, 300, 250, 12, 40, 8, 720), ...rosette(300, 300, 200, 13, 10, 700)];
  write(
    'guilloche.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="${INK}"/><g fill="none" stroke="${PAPER}" stroke-opacity="0.5" stroke-width="0.6">${paths.map((d) => `<path d="${d}"/>`).join('')}</g></svg>`,
  );
}

// Licences for the fonts the brand uses.
const fontsource = resolve(web, '..', 'node_modules/@fontsource-variable');
for (const [pkg, name] of [['fraunces', 'Fraunces'], ['inter', 'Inter'], ['jetbrains-mono', 'JetBrains-Mono']] as const) {
  copyFileSync(resolve(fontsource, pkg, 'LICENSE'), resolve(web, '..', 'docs/brand', `OFL-${name}.txt`));
}
console.log('brand SVGs written to', outs.join(' and '));
