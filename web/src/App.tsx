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

const currentRoute = (): Route => (window.location.hash in routes ? (window.location.hash as Route) : '#/');

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
      if (heading || ++tries > 40) {
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
        <Suspense fallback={<p className="muted" role="status">Loading…</p>}>
          <div data-route={route}>
            <Page />
          </div>
        </Suspense>
      </main>
      <footer className="footer">
        <span>Built on Midnight · Compact 0.31.1 · Apache-2.0</span>
        <span>Invoice numbers shown are synthetic KSeF-format numbers.</span>
      </footer>
    </div>
  );
}
