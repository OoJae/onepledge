// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';

// ROUTE_MODE=hash tests the original hash routes; the default tests the path routes.
const hashMode = process.env.ROUTE_MODE === 'hash';

export const routes = {
  demo: hashMode ? '/#/' : '/demo',
  attacks: hashMode ? '/#/attack' : '/attacks',
  live: hashMode ? '/#/live' : '/live',
};

/** Collects CSP violations and console errors for the lifetime of the page. */
export async function watchPage(page: Page) {
  const problems: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/indexer|Failed to load resource/i.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return async () => {
    const csp = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
    return [...problems, ...csp.map((c) => `csp: ${c}`)];
  };
}
