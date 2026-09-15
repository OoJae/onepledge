// SPDX-License-Identifier: Apache-2.0
// End-to-end checks of the web app. Runs against `vite preview` (which serves the production CSP) unless BASE_URL is set.
import { defineConfig, devices } from '@playwright/test';

const external = process.env.BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: external ?? 'http://localhost:4318',
    trace: 'retain-on-failure',
    extraHTTPHeaders: process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : undefined,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } } },
  ],
  webServer: external
    ? undefined
    : { command: 'npx vite preview --port 4318 --strictPort', url: 'http://localhost:4318', reuseExistingServer: true, timeout: 60_000 },
});
