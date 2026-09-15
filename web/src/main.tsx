// SPDX-License-Identifier: Apache-2.0
import './polyfills.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { bootRouter } from './router.ts';
import { ROUTES, routeFor } from './routes.ts';
import './brand/fonts.css';
import './brand/tokens.css';
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
