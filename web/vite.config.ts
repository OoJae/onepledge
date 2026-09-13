// SPDX-License-Identifier: Apache-2.0
// Top-level await is native at the esnext build target. WASM setup follows midnightntwrk/example-zkloan's UI (Apache-2.0). Buffer/process globals are
// provided by src/polyfills.ts, which main.tsx imports before anything else.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    global: 'globalThis',
  },
  plugins: [wasm(), react()],
  resolve: {
    alias: { 'isomorphic-ws': fileURLToPath(new URL('./src/isomorphic-ws.ts', import.meta.url)) },
  },
  optimizeDeps: {
    esbuildOptions: { define: { global: 'globalThis' }, target: 'esnext' },
    exclude: ['@midnight-ntwrk/onchain-runtime-v3'],
  },
  build: { target: 'esnext', commonjsOptions: { transformMixedEsModules: true } },
  server: { fs: { allow: ['..'] } },
}));
