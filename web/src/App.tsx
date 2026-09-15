// SPDX-License-Identifier: Apache-2.0
import { Suspense, useEffect, useRef } from 'react';
import { Footer, Masthead, SkipLink } from './components/Masthead.tsx';
import { usePath, useLoadedPage } from './router.ts';
import { routeFor, type RouteDef } from './routes.ts';

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
    <div className="app">
      <SkipLink />
      <Masthead path={route.path} />
      <main id="main" ref={main} tabIndex={-1}>
        <Suspense
          fallback={
            <p className="container loading muted" role="status">
              {route.fallback}
            </p>
          }
        >
          <div data-route={route.path} className={route.fullBleed ? 'page page-full' : 'page container'}>
            <PageHost route={route} />
          </div>
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
