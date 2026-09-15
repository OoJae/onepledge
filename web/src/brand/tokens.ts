// SPDX-License-Identifier: Apache-2.0
// Brand tokens: the single source of truth. `npm run brand:tokens` writes tokens.css and docs/brand/tokens.json from here.

export const color = {
  ink: { value: '#0B0D12', role: 'Ground: the desk at night, and Midnight itself' },
  ink2: { value: '#12151C', role: 'Raised surfaces: cards, ledger rows' },
  ink3: { value: '#1A1E27', role: 'Pressed or hovered surfaces' },
  rule: { value: '#2A2F3A', role: 'Hairlines, slot frames, dividers' },
  paper: { value: '#EDE6D6', role: 'Primary type and invoice sheets' },
  paperDim: { value: '#A9A396', role: 'Secondary type and labels (7.6:1 on ink)' },
  wax: { value: '#E0452B', role: 'The one accent: sealing wax. Large marks, fills with ink text (4.7:1 on ink)' },
  waxLit: { value: '#F0664A', role: 'Wax for small text and links on ink' },
} as const;

export const font = {
  display: { family: "'Fraunces Variable', 'Iowan Old Style', Georgia, serif", role: 'Headlines only; italic marks the promise word' },
  body: { family: "'Inter Variable', system-ui, -apple-system, 'Segoe UI', sans-serif", role: 'Paragraphs and interface' },
  mono: { family: "'JetBrains Mono Variable', ui-monospace, Menlo, Consolas, monospace", role: 'KSeF numbers, tags, hashes, labels' },
} as const;

export const size = {
  displayXl: 'clamp(3.25rem, 9vw, 8.75rem)',
  displayL: 'clamp(2.25rem, 5vw, 5.5rem)',
  h2: 'clamp(1.75rem, 3vw, 3rem)',
  h3: 'clamp(1.2rem, 1.6vw, 1.5rem)',
  body: 'clamp(1rem, 1.05vw, 1.15rem)',
  small: '0.875rem',
  label: '0.75rem',
} as const;

export const motion = {
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  micro: '0.28s',
  reveal: '0.8s',
  page: '0.9s',
} as const;

export const radius = { sm: '6px', md: '12px', lg: '20px', pill: '999px' } as const;

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export function tokensCss(): string {
  const lines = [
    '/* SPDX-License-Identifier: Apache-2.0 */',
    '/* Generated from src/brand/tokens.ts by `npm run brand:tokens`. Do not edit by hand. */',
    ':root {',
    ...Object.entries(color).map(([k, v]) => `  --${kebab(k)}: ${v.value};`),
    ...Object.entries(font).map(([k, v]) => `  --font-${k}: ${v.family};`),
    ...Object.entries(size).map(([k, v]) => `  --size-${kebab(k)}: ${v};`),
    ...Object.entries(motion).map(([k, v]) => `  --motion-${kebab(k)}: ${v};`),
    ...Object.entries(radius).map(([k, v]) => `  --radius-${k}: ${v};`),
    '  color-scheme: dark;',
    '}',
    '',
  ];
  return lines.join('\n');
}
