// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';

// ROUTE_MODE=hash tests the original hash routes; the default tests the path routes.
const hashMode = process.env.ROUTE_MODE === 'hash';

export const routes = {
  demo: hashMode ? '/#/' : '/demo',
  attacks: hashMode ? '/#/attack' : '/attacks',
  live: hashMode ? '/#/live' : '/live',
};

/** The lender inbox. A constant of its own because brandRoutes collapses to {} in hash mode, and
 *  inbox.spec.ts needs the path whichever mode it is about to skip in. */
export const INBOX = '/inbox';

// Routes that only ever existed as paths, so there is no legacy hash to test them under. Enrolled
// here so the shared accessibility sweep in flows.spec.ts covers them without listing them twice.
export const brandRoutes = hashMode ? {} : { landing: '/', brand: '/brand', desk: '/desk', inbox: INBOX };

/** Waits until every CSS animation on the page has finished.
 *
 *  The accessibility sweep used a flat 500ms wait, which landed in the middle of the landing hero's
 *  staggered fade-up: `.l-cta` starts at 0.42s and `.l-proof` at 0.52s, so axe sampled them part-way
 *  through and measured a *blended* colour. It reported 3.38:1 on the wax button, which at full
 *  opacity is 4.68:1, and whether it saw one such element or two depended on how long axe itself took
 *  to inject — one node on a CI runner, two on a developer machine. Mid-fade text is not a real
 *  contrast failure, so the sweep has to measure the settled page.
 *
 *  Only the mobile landing was ever affected: the fades live in the no-3D fallback, which a desktop
 *  viewport with WebGL never takes. `canRender3d()` also refuses a coarse pointer with four cores or
 *  fewer, which is exactly a GitHub runner and not a developer laptop, so this never failed locally.
 *
 *  Nothing in the app animates forever (no `infinite`, no `animation-timeline`), so waiting for all
 *  of them is bounded. Infinite animations are filtered out regardless, so adding one later makes
 *  this wait less precise rather than hanging it. */
export async function settleAnimations(page: Page) {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .every((a) => a.playState === 'finished' || a.playState === 'idle'),
    null,
    { timeout: 15_000 },
  );
}

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
