// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import { Story } from './pages/Story.tsx';
import { Attack } from './pages/Attack.tsx';
import { Live } from './pages/Live.tsx';

const routes = {
  '#/': { label: 'The story', page: Story },
  '#/attack': { label: 'Why not a hash registry', page: Attack },
  '#/live': { label: 'Live registry', page: Live },
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
      <main>
        <Page />
      </main>
      <footer className="footer">
        <span>Built on Midnight · Compact 0.31.1 · Apache-2.0</span>
        <span>Invoice numbers shown are synthetic KSeF-format numbers.</span>
      </footer>
    </div>
  );
}
