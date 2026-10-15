// SPDX-License-Identifier: Apache-2.0
// The lender inbox with no wallet. Playwright never injects window.midnight, so this is exactly what
// a visitor without an extension gets, and the page has to say so instead of spinning forever on a
// wallet that is never coming.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { INBOX, routes, watchPage } from './helpers.ts';

test.skip(process.env.ROUTE_MODE === 'hash', 'the inbox exists only with path routes');

test('inbox: renders and says there is no wallet rather than hanging', async ({ page }) => {
  const problems = await watchPage(page);
  // The landing page asserts zero .wasm requests; the inbox keeps the same promise for its own first
  // paint by holding the compiled contract behind a dynamic import that only a connect triggers.
  const wasm: string[] = [];
  page.on('request', (r) => r.url().endsWith('.wasm') && wasm.push(r.url()));

  await page.goto(INBOX);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Find your own pledges/i, {
    timeout: 60_000,
  });

  // waitForWallets polls for 3s before giving up, so this is the "gave up" message, not a race.
  await expect(page.getByText(/No Midnight wallet is injected on this page/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Look again' })).toBeEnabled();
  // Nothing to act as, so nothing that needs a secret is offered.
  await expect(page.getByRole('button', { name: /Scan the registry/ })).toHaveCount(0);

  expect(wasm).toEqual([]);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  expect(await problems()).toEqual([]);
});

test('inbox: the heading takes focus when the route is navigated to', async ({ page }) => {
  const problems = await watchPage(page);
  await page.goto(routes.live);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/chain actually holds/i, {
    timeout: 60_000,
  });
  await page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(page).toHaveTitle(/the lender inbox/);
  expect(await problems()).toEqual([]);
});
