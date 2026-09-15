// SPDX-License-Identifier: Apache-2.0
import { Suspense, useEffect, useRef } from 'react';
import { usePath, useLoadedPage } from './router.ts';
import { ROUTES, routeFor, type RouteDef } from './routes.ts';

function PageHost({ route }: { route: RouteDef }) {
  const Page = useLoadedPage(route.page);
  return <Page />;
}

export function App() {
  const path = usePath();
  const route = routeFor(path);
  const main = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    document.title = route.title;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Move focus to the new page's heading once it has loaded, so screen readers announce the change.
    let tries = 0;
    const timer = window.setInterval(() => {
      const heading = main.current?.querySelector<HTMLElement>(`[data-route="${route.path}"] h1`);
      if (heading || ++tries > 400) {
        window.clearInterval(timer);
        heading?.focus();
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [route]);

  return (
    <div className="shell">
      <header className="masthead">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden>1</span>
          OnePledge
        </a>
        <nav>
          {ROUTES.filter((r) => r.nav).map((r) => (
            <a key={r.path} href={r.path} aria-current={r.path === route.path ? 'page' : undefined}>
              {r.label}
            </a>
          ))}
        </nav>
      </header>
      <main ref={main}>
        <Suspense
          fallback={
            <p className="muted" role="status">
              {route.fallback}
            </p>
          }
        >
          <div data-route={route.path}>
            <PageHost route={route} />
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
