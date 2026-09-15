// SPDX-License-Identifier: Apache-2.0
// Top-level await is native at the esnext build target. WASM setup follows midnightntwrk/example-zkloan's UI (Apache-2.0). Buffer/process globals are
// provided by src/polyfills.ts, which main.tsx imports before anything else.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import vercel from './vercel.json' with { type: 'json' };

// `vite preview` serves the same security headers as the hosted site, so the CSP is tested locally.
const hostedHeaders = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));

export default defineConfig(({ mode }) => ({
  base: '/',
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    global: 'globalThis',
  },
  plugins: [wasm(), react()],
  resolve: {
    alias: { 'isomorphic-ws': fileURLToPath(new URL('./src/isomorphic-ws.ts', import.meta.url)) },
  },
  optimizeDeps: { exclude: ['@midnight-ntwrk/onchain-runtime-v3'] },
  // assetsInlineLimit 0: inlined data: fonts would violate the CSP (no data: in font-src).
  build: { target: 'esnext', assetsInlineLimit: 0, commonjsOptions: { transformMixedEsModules: true } },
  preview: { headers: hostedHeaders },
  server: {
    fs: {
      // Only what the app imports: its own sources, workspace packages, dependencies and the deployment record.
      allow: ['.', '../contract', '../attester', '../deployments', '../node_modules'],
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.secrets/**', '**/midnight-level-db/**'],
    },
  },
}));
