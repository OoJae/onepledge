// SPDX-License-Identifier: Apache-2.0
// The product flows judges use. These must keep passing through every redesign checkpoint.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { routes, watchPage } from './helpers.ts';

test('walkthrough: pledge accepted, double pledge refused, release accepted', async ({ page }) => {
  const problems = await watchPage(page);
  await page.goto(routes.demo);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One invoice');
  const pledge = page.getByRole('button', { name: /Pledge to Lender A/ });
  await pledge.click();
  await expect(page.getByText('Pledged to lender A')).toBeVisible();
  await expect(page.getByRole('button', { name: /Try it again at Lender B/ })).toBeFocused();
  await page.getByRole('button', { name: /Try it again at Lender B/ }).click();
  await expect(page.getByText('Receivable already pledged').first()).toBeVisible();
  await page.getByRole('button', { name: /Lender A releases/ }).click();
  await expect(page.getByText('Released by lender A')).toBeVisible();
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByText('Pledged to lender A')).toHaveCount(0);
  expect(await problems()).toEqual([]);
});

test('attacks: naive registry bypassed and snooped; OnePledge refuses both', async ({ page }) => {
  const problems = await watchPage(page);
  await page.goto(routes.attacks);
  await page.getByRole('button', { name: 'Pledge it twice' }).click();
  await expect(page.getByText(/ACCEPTED, a second pledge of the same invoice/)).toBeVisible();
  await page.getByRole('button', { name: /reformatting attack on OnePledge/ }).click();
  await expect(page.getByText(/rejected by the circuit \(Receivable already pledged\)/)).toBeVisible();
  await page.getByRole('button', { name: /Check 40 invoices/ }).click();
  await expect(page.getByText(/14 matches/)).toBeVisible();
  await page.getByRole('button', { name: /snooping attack on OnePledge/ }).click();
  await expect(page.getByText(/guessed keys found in the tag set: 0/)).toBeVisible();
  expect(await problems()).toEqual([]);
});

test('live: reads the Preprod registry and checks a tag', async ({ page }) => {
  const problems = await watchPage(page);
  await page.goto(routes.live);
  const status = page.locator('[role=status]').filter({ hasText: /State read at|did not answer/ });
  await expect(status).toBeVisible({ timeout: 60_000 });
  if (/did not answer/.test(await status.innerText())) test.skip(true, 'Preprod indexer unavailable');
  const tag = (await page.locator('ul.tags li').first().innerText()).trim();
  await page.getByLabel(/Tag \(64 hex characters\)/).fill(tag);
  await expect(page.getByText(/Encumbered/)).toBeVisible();
  await page.getByLabel(/Tag \(64 hex characters\)/).fill('ab'.repeat(32));
  await expect(page.getByText(/Not pledged in this registry yet/)).toBeVisible();
  expect(await problems()).toEqual([]);
});

for (const [name, path] of Object.entries(routes)) {
  test(`accessibility: ${name} has no axe violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
