// SPDX-License-Identifier: Apache-2.0
// The product flows judges use. These must keep passing through every redesign checkpoint.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { brandRoutes, routes, settleAnimations, watchPage } from './helpers.ts';
import deployment from '../../deployments/preprod.json' with { type: 'json' };

test('walkthrough: pledge accepted, double pledge refused, lender accepts, release accepted', async ({ page }) => {
  const problems = await watchPage(page);
  await page.goto(routes.demo);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One invoice');
  await page.getByRole('button', { name: /Pledge to Lender A/ }).click();
  await expect(page.getByText('Pledged to lender A')).toBeVisible();
  await expect(page.getByRole('button', { name: /Try it again at Lender B/ })).toBeFocused();
  await page.getByRole('button', { name: /Try it again at Lender B/ }).click();
  await expect(page.getByText('Receivable already pledged').first()).toBeVisible();
  await page.getByRole('button', { name: /Lender A accepts/ }).click();
  await expect(page.getByText('Accepted by lender A')).toBeVisible();
  await page.getByRole('button', { name: /Lender A releases/ }).click();
  await expect(page.getByText('Released by lender A')).toBeVisible();
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByText('Pledged to lender A')).toHaveCount(0);
  expect(await problems()).toEqual([]);
});

test('walkthrough: a declined pledge frees the receivable for another lender', async ({ page }) => {
  const problems = await watchPage(page);
  await page.goto(routes.demo);
  await page.getByRole('button', { name: /Pledge to Lender A/ }).click();
  await page.getByRole('button', { name: /Try it again at Lender B/ }).click();
  await expect(page.getByText('Receivable already pledged').first()).toBeVisible();

  // The void path: until Wave 2 this receivable was burned forever.
  await page.getByRole('button', { name: /Lender A declines/ }).click();
  await expect(page.getByText(/the receivable is free again/)).toBeVisible();

  await page.getByRole('button', { name: /Pledge the freed invoice to Lender B/ }).click();
  await expect(page.getByText('Pledged to lender B')).toBeVisible();
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

for (const [name, path] of Object.entries({ ...routes, ...brandRoutes })) {
  test(`accessibility: ${name} has no axe violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
    await settleAnimations(page);
    const results = await new AxeBuilder({ page }).analyze();
    // One entry per offending element, naming the selector and axe's own measurement. The previous
    // form reported only `${v.id}: ${v.nodes.length}`, so a failure said "color-contrast: 1" and
    // nothing about which element or by how much — the detail is not in the trace either, because
    // this map discards it before Playwright records the assertion.
    const violations = results.violations.flatMap((v) =>
      v.nodes.map((n) => `${v.id} at ${n.target.join(' ')} — ${(n.failureSummary ?? '').split('\n').pop()?.trim()}`),
    );
    expect(violations).toEqual([]);
  });
}

test('landing: thesis, calls to action and real Preprod proof', async ({ page }) => {
  test.skip(process.env.ROUTE_MODE === 'hash', 'landing exists only with path routes');
  const problems = await watchPage(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/One invoice\.\s*One pledge\./);
  await expect(page.getByRole('link', { name: 'Try the pledge' }).first()).toHaveAttribute('href', '/demo');
  // One badge per recorded step that the circuit refused before a proof could be built. Counted from
  // the deployment record rather than pinned, because the scenario gains refusals as the contract
  // gains checks: this went from one to three when the registrar committee and the borrowing base
  // landed, and a fixed number would just break again next time.
  //
  // A refusal has no txId, because no transaction was ever built. The earlier test counted events
  // with no *explorer hash*, which let the page badge three non-refusals — two `note` annotations and
  // the committee install, which succeeded on chain without its hash being captured — and asserted
  // that wrong number back, so the suite agreed with the bug instead of catching it.
  const refused = deployment.events.filter((e) => e.circuit !== 'note' && !('txId' in e)).length;
  expect(refused, 'the recorded scenario has no refusals to show').toBeGreaterThan(0);
  await expect(page.getByText('refused before proving')).toHaveCount(refused);
  await expect(page.getByText('refused before proving').first()).toBeVisible();
  // Read the hash from the deployment record rather than pinning one: the landing page renders
  // whatever is deployed, so a hardcoded hash silently goes stale at the next redeploy.
  await expect(page.locator(`a[href*="/transactions/${deployment.deployTxHash.slice(0, 8)}"]`)).toBeVisible();
  const wasm = [] as string[];
  page.on('request', (r) => r.url().endsWith('.wasm') && wasm.push(r.url()));
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(800);
  expect(wasm).toEqual([]);
  await page.getByRole('link', { name: /Try the pledge/ }).first().click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  expect(await problems()).toEqual([]);
});
