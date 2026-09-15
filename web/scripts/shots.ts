// SPDX-License-Identifier: Apache-2.0
// Screenshots of every route at phone, tablet and desktop widths for visual review.
// Usage: npx tsx scripts/shots.ts <baseUrl> <outDir> [paths...]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:4318', out = 'shots', ...rest] = process.argv.slice(2);
const paths = rest.length ? rest : ['/', '/demo', '/attacks', '/live'];
const widths = [375, 768, 1440];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 375 ? 812 : 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const p of paths) {
    await page.goto(base + p);
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 60_000 });
    if (p === '/live') await page.getByText(/State read at|did not answer/).waitFor({ timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const name = `${out}/${p === '/' ? 'home' : p.slice(1)}-${w}.png`;
    await page.screenshot({ path: name, fullPage: true });
    console.log(name);
  }
  await ctx.close();
}
await browser.close();
