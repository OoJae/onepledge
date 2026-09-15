// SPDX-License-Identifier: Apache-2.0
import type { ComponentType } from 'react';
import { lazyPage } from './router.ts';

export interface RouteDef {
  path: string;
  label: string;
  title: string;
  fallback: string;
  nav: boolean;
  page: ReturnType<typeof lazyPage>;
}

const story = lazyPage(() => import('./pages/Story.tsx').then((m) => m.Story as ComponentType));

export const ROUTES: RouteDef[] = [
  { path: '/', label: 'OnePledge', title: 'OnePledge · one invoice, one pledge', fallback: 'Loading the compiled contract (about 0.5 MB)…', nav: false, page: story },
  { path: '/demo', label: 'The story', title: 'OnePledge · walkthrough', fallback: 'Loading the compiled contract (about 0.5 MB)…', nav: true, page: story },
  {
    path: '/attacks',
    label: 'Why not a hash registry',
    title: 'OnePledge · why not a hash registry',
    fallback: 'Loading the compiled contract (about 0.5 MB)…',
    nav: true,
    page: lazyPage(() => import('./pages/Attack.tsx').then((m) => m.Attack as ComponentType)),
  },
  {
    path: '/live',
    label: 'Live registry',
    title: 'OnePledge · live on Midnight Preprod',
    fallback: "Loading the contract's ledger reader and Midnight's ledger runtime (about 5 MB, cached after the first visit)…",
    nav: true,
    page: lazyPage(() => import('./pages/Live.tsx').then((m) => m.Live as ComponentType)),
  },
];

export const routeFor = (path: string) => ROUTES.find((r) => r.path === path) ?? ROUTES[0];
