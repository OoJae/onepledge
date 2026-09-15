// SPDX-License-Identifier: Apache-2.0
// Old links in the README, deck and video must keep landing on the right page.
import { expect, test } from '@playwright/test';
import { watchPage } from './helpers.ts';

const legacy: [string, string, RegExp][] = [
  ['/#/', '/demo', /One invoice/],
  ['/#/attack', '/attacks', /hash registry/i],
  ['/#/live', '/live', /chain actually holds/i],
  ['/#live', '/live', /chain actually holds/i],
  ['/#/Live/', '/live', /chain actually holds/i],
  ['/demo/', '/demo', /One invoice/],
  ['/nope', '/', /./],
];

for (const [from, to, heading] of legacy) {
  test(`legacy link ${from} lands on ${to}`, async ({ page }) => {
    const problems = await watchPage(page);
    await page.goto(from);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading, { timeout: 60_000 });
    expect(new URL(page.url()).pathname).toBe(to);
    expect(await problems()).toEqual([]);
  });
}

test('navigation keeps history, titles and focus', async ({ page, isMobile }) => {
  const problems = await watchPage(page);
  await page.goto('/demo');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One invoice');
  const nav = page.getByRole('navigation');
  await nav.getByRole('link', { name: 'Attacks' }).click();
  await expect(page).toHaveURL(/\/attacks$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(page).toHaveTitle(/why not a hash registry/);
  await nav.getByRole('link', { name: 'Live' }).click();
  await expect(page).toHaveURL(/\/live$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/attacks$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/hash registry/i);
  if (!isMobile) {
    await page.keyboard.press('Shift+Tab');
  }
  expect(await problems()).toEqual([]);
});
