// SPDX-License-Identifier: Apache-2.0
import './polyfills.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { bootRouter } from './router.ts';
import { ROUTES, routeFor } from './routes.ts';
import './styles.css';

bootRouter(
  ROUTES.map((r) => r.path),
  (path) => routeFor(path).page(),
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
