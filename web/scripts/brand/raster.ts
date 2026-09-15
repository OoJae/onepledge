// SPDX-License-Identifier: Apache-2.0
// Raster brand assets: PNG icons from the seal mark, and the Open Graph image composed from a real frame of the 3D scene.
// Needs the site running (default http://localhost:4318, e.g. `npx vite preview --port 4318`).
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:4318';
const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..', '..');
const outs = [resolve(web, 'public/brand'), resolve(web, '..', 'docs/brand')];
outs.forEach((d) => mkdirSync(d, { recursive: true }));
const save = (name: string, buf: Buffer) => outs.forEach((d) => writeFileSync(resolve(d, name), buf));
const svg64 = (name: string) => readFileSync(resolve(web, 'public/brand', name)).toString('base64');
const font64 = (pkg: string, file: string) => readFileSync(resolve(web, '..', 'node_modules/@fontsource-variable', pkg, 'files', file)).toString('base64');

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });

// Icons.
{
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const icon = async (name: string, size: number, opts: { ground?: string; mark: number; file?: string }) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;background:${opts.ground ?? 'transparent'}"><img width="${opts.mark}" height="${opts.mark}" src="data:image/svg+xml;base64,${svg64(opts.file ?? 'mark-wax.svg')}"></body>`,
    );
    await page.waitForTimeout(100);
    save(name, await page.screenshot({ omitBackground: !opts.ground }));
  };
  await icon('favicon-32.png', 32, { mark: 32, file: 'mark-small.svg' });
  await icon('icon-192.png', 192, { mark: 192 });
  await icon('icon-512.png', 512, { mark: 512 });
  await icon('apple-touch-icon.png', 180, { ground: '#0B0D12', mark: 148 });
  await icon('maskable-512.png', 512, { ground: '#0B0D12', mark: 330 });
  await page.close();
}

// A frame of the real scene: the moment of pledge.
// bypassCSP only for this local capture, to hide the captions over the frame.
const sceneContext = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, bypassCSP: true });
const scene = await sceneContext.newPage();
await scene.goto(base + '/');
await scene.locator('#pledge-scene[data-ready="3d"]').waitFor({ timeout: 60_000 });
await scene.addStyleTag({ content: '.l-captions,.masthead,.l-stage::after{display:none!important}' });
await scene.evaluate(() => {
  const s = document.getElementById('pledge-scene')!;
  window.scrollTo(0, s.getBoundingClientRect().top + window.scrollY + 0.47 * (s.offsetHeight - window.innerHeight));
});
await scene.waitForTimeout(1500);
const frame = await scene.screenshot({ clip: { x: 560, y: 60, width: 1000, height: 900 } });
save('seal-render.png', frame);
await sceneContext.close();

// Open Graph image, 1200 × 630.
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
@font-face{font-family:F;src:url(data:font/woff2;base64,${font64('fraunces', 'fraunces-latin-opsz-normal.woff2')}) format('woff2');font-weight:100 900}
@font-face{font-family:F;font-style:italic;src:url(data:font/woff2;base64,${font64('fraunces', 'fraunces-latin-opsz-italic.woff2')}) format('woff2');font-weight:100 900}
@font-face{font-family:M;src:url(data:font/woff2;base64,${font64('jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2')}) format('woff2');font-weight:100 900}
body{margin:0;width:1200px;height:630px;background:#0B0D12;color:#EDE6D6;overflow:hidden;position:relative;font-family:F}
.art{position:absolute;right:-40px;top:-20px;width:700px;height:630px;background:url(data:image/png;base64,${frame.toString('base64')}) center/cover}
.fade{position:absolute;inset:0;background:linear-gradient(90deg,#0B0D12 0%,#0B0D12 38%,rgba(11,13,18,0) 62%)}
.copy{position:absolute;left:72px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;width:620px}
.brand{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:600;letter-spacing:-.01em}
.brand em{font-weight:500}
h1{margin:44px 0 0;font-size:104px;line-height:.9;letter-spacing:-.035em;font-weight:500;font-variation-settings:'opsz' 144}
h1 em{font-weight:400}
p{margin:30px 0 0;font:500 20px M;letter-spacing:.06em;color:#A9A396;text-transform:uppercase}
.url{margin-top:14px;color:#EDE6D6;text-transform:none;letter-spacing:0;font-size:24px}
</style></head><body><div class="art"></div><div class="fade"></div><div class="copy">
<div class="brand"><img width="52" height="52" src="data:image/svg+xml;base64,${svg64('mark-wax.svg')}"><span>One<em>Pledge</em></span></div>
<h1>One invoice.<br><em>One pledge.</em></h1>
<p>Private receivables registry · Midnight</p><p class="url">onepledge.vercel.app</p>
</div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const og = await page.screenshot();
  writeFileSync(resolve(web, 'public/og.png'), og);
  save('og.png', og);
  await page.close();
}

await browser.close();
writeFileSync(
  resolve(web, 'public/site.webmanifest'),
  JSON.stringify(
    {
      name: 'OnePledge',
      short_name: 'OnePledge',
      description: 'One pledge per invoice, without any lender seeing another’s book.',
      start_url: '/',
      display: 'standalone',
      background_color: '#0B0D12',
      theme_color: '#0B0D12',
      icons: [
        { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/brand/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  ) + '\n',
);
console.log('raster assets written');
