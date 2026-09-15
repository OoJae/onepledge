// SPDX-License-Identifier: Apache-2.0
// A small path router: one pathname store, legacy #/ links mapped on arrival, and page changes wrapped in
// view transitions when the browser supports them and the reader has not asked for reduced motion.

import { use, useSyncExternalStore, type ComponentType } from 'react';
import { flushSync } from 'react-dom';

type Settled<T> = Promise<T> & { status?: 'fulfilled'; value?: T };

/** A memoised page import whose resolved value can be read synchronously once it has loaded. */
export function lazyPage(load: () => Promise<ComponentType>) {
  let promise: Settled<ComponentType> | undefined;
  return () => {
    if (!promise) {
      const p: Settled<ComponentType> = load().then((value) => {
        p.status = 'fulfilled';
        p.value = value;
        return value;
      });
      promise = p;
    }
    return promise;
  };
}

/** A page bundled with the entry chunk: already settled, so it renders without Suspense. */
export function eagerPage(component: ComponentType) {
  const promise: Settled<ComponentType> = Promise.resolve(component);
  promise.status = 'fulfilled';
  promise.value = component;
  return () => promise;
}

/** Renders a lazy page without a Suspense flash when it was preloaded before navigation. */
export function useLoadedPage(get: () => Settled<ComponentType>): ComponentType {
  const promise = get();
  return promise.status === 'fulfilled' ? promise.value! : use(promise as Promise<ComponentType>);
}

// Old hash links from the README, deck and video: #/ (walkthrough), #/attack, #/live, and near-misses.
const LEGACY: Record<string, string> = {
  '': '/demo',
  story: '/demo',
  walkthrough: '/demo',
  demo: '/demo',
  attack: '/attacks',
  attacks: '/attacks',
  live: '/live',
  brand: '/brand',
};

export function legacyTarget(pathname: string, hash: string): string | null {
  if (pathname !== '/' || !hash) return null;
  const match = /^#\/?([a-z]*)\/?$/i.exec(hash);
  return match ? (LEGACY[match[1].toLowerCase()] ?? null) : null;
}

export const normalizePath = (pathname: string) => {
  const trimmed = pathname.replace(/\/+$/, '').toLowerCase();
  return trimmed === '' ? '/' : trimmed;
};

let known = new Set<string>(['/']);
let preload: (path: string) => Promise<unknown> = async () => undefined;
let current = '/';
const listeners = new Set<() => void>();

const setPath = (path: string) => {
  current = path;
  listeners.forEach((listener) => listener());
};

export const usePath = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

function transition(update: () => void, point?: { x: number; y: number }) {
  const doc = document as ViewTransitionDocument;
  const run = () => {
    flushSync(update);
    window.scrollTo(0, 0);
  };
  if (!doc.startViewTransition || reducedMotion()) return run();
  const root = document.documentElement.style;
  root.setProperty('--vt-x', `${Math.round(point?.x ?? window.innerWidth / 2)}px`);
  root.setProperty('--vt-y', `${Math.round(point?.y ?? window.innerHeight / 2)}px`);
  doc.startViewTransition(run);
}

export async function navigate(to: string, options: { replace?: boolean; point?: { x: number; y: number } } = {}) {
  const url = new URL(to, window.location.href);
  const path = normalizePath(url.pathname);
  if (!known.has(path)) return window.location.assign(url.href);
  if (path === current && !options.replace) {
    if (url.hash) return;
    window.scrollTo(0, 0);
    return;
  }
  await Promise.race([preload(path).catch(() => undefined), new Promise((r) => setTimeout(r, 400))]);
  transition(() => {
    const target = `${path}${url.search}${url.hash}`;
    if (options.replace) window.history.replaceState(null, '', target);
    else window.history.pushState(null, '', target);
    setPath(path);
  }, options.point);
}

/** Call once before rendering: maps legacy links, fixes unknown paths and installs the listeners. */
export function bootRouter(paths: string[], preloader: (path: string) => Promise<unknown>) {
  known = new Set(paths);
  preload = preloader;
  window.history.scrollRestoration = 'manual';

  const legacy = legacyTarget(window.location.pathname, window.location.hash);
  let path = legacy ?? normalizePath(window.location.pathname);
  if (!known.has(path)) path = '/';
  const suffix = legacy ? '' : window.location.search + window.location.hash;
  if (legacy || path !== window.location.pathname) window.history.replaceState(null, '', path + suffix);
  current = path;

  window.addEventListener('popstate', () => {
    const next = normalizePath(window.location.pathname);
    transition(() => setPath(known.has(next) ? next : '/'));
  });
  window.addEventListener('hashchange', () => {
    const target = legacyTarget(window.location.pathname, window.location.hash);
    if (target) void navigate(target, { replace: true });
  });
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.('a');
    if (!anchor || anchor.target || anchor.hasAttribute('download') || !anchor.href) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const next = normalizePath(url.pathname);
    if (!known.has(next) || (next === current && url.hash)) return;
    event.preventDefault();
    const rect = anchor.getBoundingClientRect();
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    void navigate(url.pathname + url.search + url.hash, {
      point: fromKeyboard ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: event.clientX, y: event.clientY },
    });
  });
}
