// SPDX-License-Identifier: Apache-2.0
// The OnePledge seal mark on a 64 × 64 grid: a guilloché ring around an engraved numeral one.
import { ring } from './guilloche.ts';

/** Serif numeral "1" with a flag and a base serif, drawn as a path so logo files need no font. */
export const NUMERAL_ONE = 'M29.2 17.4 36.6 15v29.1l4.9 1.5V48H24.4v-2.4l4.9-1.5V22.8l-5.2 1.9-.6-2.5z';

export const MARK_RING = ring(32, 32, 25.2, 1.6, 22, 5, 480);

export interface MarkColors {
  disc: string;
  ring: string;
  numeral: string;
  edge?: string;
}

export const markPalettes: Record<string, MarkColors> = {
  wax: { disc: '#E0452B', ring: '#0B0D12', numeral: '#0B0D12' },
  paper: { disc: '#EDE6D6', ring: '#0B0D12', numeral: '#0B0D12' },
  ink: { disc: '#0B0D12', ring: '#EDE6D6', numeral: '#EDE6D6', edge: '#EDE6D6' },
  mono: { disc: 'none', ring: 'currentColor', numeral: 'currentColor', edge: 'currentColor' },
};

/** Standalone SVG markup for asset files. `simple` drops the ring for 16–32 px use. */
export function markSvg(colors: MarkColors, opts: { simple?: boolean; size?: number } = {}): string {
  const size = opts.size ?? 64;
  const edge = colors.edge ? `<circle cx="32" cy="32" r="30.25" fill="none" stroke="${colors.edge}" stroke-width="1.5"/>` : '';
  const ringPaths = opts.simple
    ? ''
    : `<g fill="none" stroke="${colors.ring}" stroke-width="0.55" stroke-opacity="0.85">${MARK_RING.map((d) => `<path d="${d}"/>`).join('')}</g>`;
  const inner = opts.simple ? '' : `<circle cx="32" cy="32" r="21" fill="none" stroke="${colors.ring}" stroke-width="0.8"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="${colors.disc}"/>${edge}${ringPaths}${inner}<path d="${NUMERAL_ONE}" fill="${colors.numeral}"/></svg>`;
}
