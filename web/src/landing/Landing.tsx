// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from 'react';
import { EXPLORER, registry, shortHash } from '../brand/facts.ts';
import { SealArt } from './SealArt.tsx';
import { SealScene } from './SealScene.tsx';
import './landing.css';

const steps = [
  {
    title: 'Tag',
    body: "The tag authority turns the invoice's KSeF number into a keyed tag and signs it for this registry. Without its key, nobody can turn an invoice number into a tag.",
  },
  {
    title: 'Prove',
    body: 'The borrower proves, in zero knowledge, that the signature is valid, the lender is admitted and the tag is new. The invoice and the lender stay private.',
  },
  {
    title: 'Record',
    body: 'Midnight adds the tag to a public set. The same tag can never be pledged again, so a second lender is refused.',
  },
];

const parties = [
  ['Anyone reading the chain', 'Opaque tags, counts and timing', 'The invoice, the borrower, which lender financed it'],
  ['The financing lender', 'The full invoice, checked against the signed commitment', "Other lenders' deals"],
  ['A rival lender given the tag', 'That the invoice is already pledged', 'By whom, how much, on what terms'],
  ['The tag authority', 'Which of its invoices were pledged, and when', 'Which lender financed them, or the terms'],
];

/** Sections fade up once as they enter the viewport. Reduced motion shows them at once (see landing.css). */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const targets = root.current?.querySelectorAll<HTMLElement>('[data-reveal]') ?? [];
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            (e.target as HTMLElement).dataset.revealed = 'true';
            io.unobserve(e.target);
          }
        }),
      { rootMargin: '0px 0px -15% 0px' },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);
  return root;
}

export function Landing() {
  const txs = registry.events.filter((e) => e.txHash);
  const root = useReveal();
  return (
    <div ref={root} className="l-root">
      <section className="l-hero" aria-labelledby="hero-title">
        <div className="container l-hero-grid">
          <div className="l-hero-copy">
            <p className="eyebrow">Receivables registry on Midnight · Preprod</p>
            <h1 id="hero-title" tabIndex={-1} className="l-display">
              <span className="l-line">
                <span className="l-line-inner">One invoice.</span>
              </span>
              <span className="l-line">
                <span className="l-line-inner">
                  <em>One pledge.</em>
                </span>
              </span>
            </h1>
            <p className="l-lede">
              OnePledge refuses the second pledge of the same invoice, and no lender ever sees another lender's book.
            </p>
            <div className="l-cta">
              <a className="button button-wax" href="/demo">
                Try the pledge
              </a>
              <a className="button button-ghost" href="/live">
                Read the chain
              </a>
            </div>
            <p className="l-proof">
              <span className="l-proof-dot" aria-hidden /> Registry v2 deployed in block {registry.deployBlock.toLocaleString('en-US')} ·{' '}
              {txs.length + 1} Preprod transactions
            </p>
          </div>
          <div className="l-hero-stage" aria-hidden="true">
            <SealArt beat={0} />
          </div>
        </div>
        <a className="l-scroll-hint" href="#pledge-scene">
          Scroll to pledge
        </a>
      </section>

      <SealScene />

      <section className="l-section container" id="after-scene" aria-labelledby="books-title">
        <div className="l-split" data-reveal>
          <h2 id="books-title" className="l-h2" tabIndex={-1}>
            Lenders could catch it by comparing books. <em>None will.</em>
          </h2>
          <div className="l-split-body">
            <p>
              Pledging the same invoice to several lenders is one of the oldest frauds in trade finance. A lender's clients and
              pricing are its business, so no lender shows its book to a rival.
            </p>
            <p>
              Publishing a hash of every financed invoice fails twice: write the number differently and it's a new hash, and anyone
              holding an invoice can look up whether it was financed.
            </p>
            <a className="l-link" href="/attacks">
              See both attacks, side by side →
            </a>
          </div>
        </div>
      </section>

      <section className="l-section container" aria-labelledby="how-title">
        <h2 id="how-title" className="l-h2" data-reveal>
          How a pledge is recorded
        </h2>
        <ol className="l-steps" data-reveal>
          {steps.map((s, i) => (
            <li key={s.title}>
              <span className="l-margin">{String(i + 1).padStart(2, '0')}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="l-section container" aria-labelledby="parties-title">
        <h2 id="parties-title" className="l-h2" data-reveal>
          Everyone learns only <em>their share</em>
        </h2>
        <div className="l-table-wrap" data-reveal>
          <table className="l-table">
            <thead>
              <tr>
                <th scope="col">Who</th>
                <th scope="col">Learns</th>
                <th scope="col">Never learns</th>
              </tr>
            </thead>
            <tbody>
              {parties.map(([who, learns, never]) => (
                <tr key={who}>
                  <th scope="row">{who}</th>
                  <td>{learns}</td>
                  <td className="l-never">{never}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="l-section container" aria-labelledby="proof-title">
        <div className="l-proof-head" data-reveal>
          <h2 id="proof-title" className="l-h2">
            Running on Midnight Preprod
          </h2>
          <p className="muted">
            Registry v2{' '}
            <a href={`${EXPLORER}/contracts/${registry.address}`} className="mono">
              {shortHash(registry.address)}
            </a>
            . Labels come from the operator's run log; on chain these are plain calls.
          </p>
        </div>
        <ol className="l-ledger" data-reveal>
          <li>
            <span className="l-margin">{registry.deployBlock}</span>
            <span className="l-ledger-label">Deploy registry v2</span>
            <a className="mono" href={`${EXPLORER}/transactions/${registry.deployTxHash}`}>
              {shortHash(registry.deployTxHash)}
            </a>
          </li>
          {registry.events.map((e, i) => (
            <li key={i} className={e.txHash ? '' : 'l-ledger-refused'}>
              <span className="l-margin">{e.blockHeight ?? '—'}</span>
              <span className="l-ledger-label">
                {e.label}
                {!e.txHash && <span className="badge l-refused">refused before proving</span>}
              </span>
              {e.txHash ? (
                <a className="mono" href={`${EXPLORER}/transactions/${e.txHash}`}>
                  {shortHash(e.txHash)}
                </a>
              ) : (
                <span className="mono muted">no transaction</span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="l-section container" aria-labelledby="next-title">
        <h2 id="next-title" className="sr-only">
          Explore OnePledge
        </h2>
        <div className="l-doors" data-reveal>
          <a className="l-door" href="/demo">
            <span className="l-door-kicker">In your browser</span>
            <span className="l-door-title">Try the pledge</span>
            <span className="l-door-body">Pledge an invoice, watch the second pledge fail, release it.</span>
          </a>
          <a className="l-door" href="/attacks">
            <span className="l-door-kicker">Why this design</span>
            <span className="l-door-title">See the attacks</span>
            <span className="l-door-body">A public hash registry is bypassed and snooped. OnePledge is not.</span>
          </a>
          <a className="l-door" href="/live">
            <span className="l-door-kicker">No wallet needed</span>
            <span className="l-door-title">Read the chain</span>
            <span className="l-door-body">The deployed registry, decoded from the public Preprod indexer.</span>
          </a>
        </div>
      </section>
    </div>
  );
}
