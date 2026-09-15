// SPDX-License-Identifier: Apache-2.0
// Screenshots of the landing pledge scene at chosen scroll progress points (review aid).
// Usage: npx tsx scripts/shots-scene.ts <baseUrl> <outDir> <width> <height> [p...]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:4318', out = 'shots', w = '1440', h = '900', ...ps] = process.argv.slice(2);
const points = ps.length ? ps.map(Number) : [0.05, 0.2, 0.3, 0.36, 0.47, 0.59, 0.68, 0.8, 0.96];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + '/');
await page.locator('#pledge-scene').waitFor();
const ready = await page.locator('#pledge-scene[data-ready="3d"]').waitFor({ timeout: 30_000 }).then(() => true, () => false);
console.log('3d ready:', ready);
for (const p of points) {
  await page.evaluate((p) => {
    const s = document.getElementById('pledge-scene')!;
    const top = s.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top + p * (s.offsetHeight - window.innerHeight));
  }, p);
  await page.waitForTimeout(900);
  const beat = await page.locator('#pledge-scene').getAttribute('data-beat');
  const file = `${out}/scene-${w}-${String(p).replace('.', '_')}.png`;
  await page.screenshot({ path: file });
  console.log(file, 'beat', beat);
}
console.log('errors:', errors);
await browser.close();
