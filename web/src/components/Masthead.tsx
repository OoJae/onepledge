// SPDX-License-Identifier: Apache-2.0
import { Mark, Wordmark } from '../brand/Mark.tsx';
import { ROUTES } from '../routes.ts';

export function Masthead({ path }: { path: string }) {
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <a className="brand" href="/" aria-label="OnePledge, home">
          <Mark size={30} />
          <Wordmark />
        </a>
        <nav aria-label="Primary">
          {ROUTES.filter((r) => r.nav).map((r) => (
            <a key={r.path} href={r.path} aria-current={r.path === path ? 'page' : undefined}>
              {r.label}
            </a>
          ))}
        </nav>
        <a className="button button-paper masthead-cta" href="/demo">
          Try the pledge
        </a>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <p className="footer-attribution">This project is built on the Midnight Network.</p>
        <p>
          <span>Compact 0.31.1 · Apache-2.0 · </span>
          <a href="https://github.com/OoJae/onepledge">Source on GitHub</a>
        </p>
        <p className="footer-note">Invoice numbers shown are synthetic KSeF-format numbers.</p>
      </div>
    </footer>
  );
}

export function SkipLink() {
  return (
    <a className="skip-link" href="#main">
      Skip to content
    </a>
  );
}
