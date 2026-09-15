// SPDX-License-Identifier: Apache-2.0
import { Suspense, lazy, useEffect, useRef, useState } from 'react';

// Pages load on demand, so the ledger WASM is fetched only by the pages that use it.
const Story = lazy(() => import('./pages/Story.tsx').then((m) => ({ default: m.Story })));
const Attack = lazy(() => import('./pages/Attack.tsx').then((m) => ({ default: m.Attack })));
const Live = lazy(() => import('./pages/Live.tsx').then((m) => ({ default: m.Live })));

const routes = {
  '#/': { label: 'The story', title: 'OnePledge · one invoice, one pledge', page: Story },
  '#/attack': { label: 'Why not a hash registry', title: 'OnePledge · why not a hash registry', page: Attack },
  '#/live': { label: 'Live registry', title: 'OnePledge · live on Midnight Preprod', page: Live },
} as const;

type Route = keyof typeof routes;

const currentRoute = (): Route => {
  // Accept near-misses such as #live, #/live/ and #/Live; send anything else to the story and fix the URL.
  const raw = window.location.hash || '#/';
  const normalized = ('#/' + raw.replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase()) as Route;
  const route = normalized in routes ? normalized : '#/';
  if (raw !== route) window.history.replaceState(null, '', route);
  return route;
};

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const Page = routes[route].page;
  const main = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    document.title = routes[route].title;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Move focus to the new page's heading once it has loaded, so screen readers announce the change.
    let tries = 0;
    const timer = window.setInterval(() => {
      const heading = main.current?.querySelector<HTMLElement>(`[data-route="${route}"] h1`);
      if (heading || ++tries > 400) {
        window.clearInterval(timer);
        heading?.focus();
        window.scrollTo(0, 0);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [route]);

  return (
    <div className="shell">
      <header className="masthead">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden>1</span>
          OnePledge
        </a>
        <nav>
          {(Object.keys(routes) as Route[]).map((r) => (
            <a key={r} href={r} aria-current={r === route ? 'page' : undefined}>
              {routes[r].label}
            </a>
          ))}
        </nav>
      </header>
      <main ref={main}>
        <Suspense
          fallback={
            <p className="muted" role="status">
              {route === '#/live'
                ? "Loading the contract's ledger reader and Midnight's ledger runtime (about 5 MB, cached after the first visit)…"
                : 'Loading the compiled contract (about 0.5 MB)…'}
            </p>
          }
        >
          <div data-route={route}>
            <Page />
          </div>
        </Suspense>
      </main>
      <footer className="footer">
        <span>This project is built on the Midnight Network. · Compact 0.31.1 · Apache-2.0</span>
        <span>Invoice numbers shown are synthetic KSeF-format numbers.</span>
      </footer>
    </div>
  );
}
