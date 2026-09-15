// SPDX-License-Identifier: Apache-2.0
// Writes src/brand/tokens.css and docs/brand/tokens.json from src/brand/tokens.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { color, font, motion, radius, size, tokensCss } from '../../src/brand/tokens.ts';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
writeFileSync(resolve(web, 'src/brand/tokens.css'), tokensCss());
const docs = resolve(web, '..', 'docs/brand');
mkdirSync(docs, { recursive: true });
writeFileSync(resolve(docs, 'tokens.json'), JSON.stringify({ color, font, size, motion, radius }, null, 2) + '\n');
console.log('tokens.css and docs/brand/tokens.json written');
