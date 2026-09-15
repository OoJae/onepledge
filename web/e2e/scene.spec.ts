// SPDX-License-Identifier: Apache-2.0
// The landing pledge scene in its three modes: 3D, illustrated (no WebGL) and reduced motion.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { watchPage } from './helpers.ts';

test.skip(process.env.ROUTE_MODE === 'hash', 'landing exists only with path routes');

async function scrollScene(page: import('@playwright/test').Page, p: number) {
  await page.evaluate((p) => {
    const s = document.getElementById('pledge-scene')!;
    window.scrollTo(0, s.getBoundingClientRect().top + window.scrollY + p * (s.offsetHeight - window.innerHeight));
  }, p);
  await page.waitForTimeout(700);
}

test('scroll scene advances through every beat without errors', async ({ page }) => {
  const problems = await watchPage(page);
  await page.goto('/');
  const scene = page.locator('#pledge-scene');
  await expect(scene).toHaveAttribute('data-mode', 'scroll');
  for (const [p, beat] of [[0.05, '0'], [0.3, '1'], [0.55, '2'], [0.9, '3']] as const) {
    await scrollScene(page, p);
    await expect(scene).toHaveAttribute('data-beat', beat);
    await expect(page.locator(`.l-caption[data-active="true"]`)).toHaveCount(1);
  }
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  expect(await problems()).toEqual([]);
});

test('reduced motion shows the illustrated beats with no canvas', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const problems = await watchPage(page);
  await page.goto('/');
  await expect(page.locator('#pledge-scene')).toHaveAttribute('data-mode', 'static');
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('.l-beat')).toHaveCount(4);
  await page.getByRole('link', { name: 'Demo' }).click();
  await expect(page).toHaveURL(/\/demo$/);
  expect(await problems()).toEqual([]);
  await context.close();
});

test('leaving and returning to the landing releases the scene', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop loads the 3D scene eagerly');
  const problems = await watchPage(page);
  const warnings: string[] = [];
  page.on('console', (m) => /WebGL|context/i.test(m.text()) && warnings.push(m.text()));
  for (let i = 0; i < 4; i++) {
    await page.goto('/');
    await page.locator('#pledge-scene[data-ready="3d"]').waitFor({ timeout: 30_000 }).catch(() => {});
    await page.getByRole('navigation').getByRole('link', { name: 'Demo' }).click();
    await expect(page).toHaveURL(/\/demo$/);
  }
  expect(warnings.filter((w) => /too many/i.test(w))).toEqual([]);
  expect(await problems()).toEqual([]);
});
