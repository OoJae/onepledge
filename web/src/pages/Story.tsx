// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from 'react';
import { Walkthrough, hex, short, type Outcome } from '../engine.ts';

type Step = 'start' | 'pledged' | 'doubled' | 'released';

const pln = (grosz: string) =>
  (Number(grosz) / 100).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });

export function Story() {
  const [run, setRun] = useState(() => new Walkthrough());
  const [step, setStep] = useState<Step>('start');
  const [log, setLog] = useState<{ label: string; outcome: Outcome }[]>([]);
  const [noteSalt, setNoteSalt] = useState<Uint8Array | null>(null);
  const [, force] = useState(0);
  const view = useMemo(() => run.publicView(), [run, step, log]);
  const buttons = [useRef<HTMLButtonElement>(null), useRef<HTMLButtonElement>(null), useRef<HTMLButtonElement>(null), useRef<HTMLButtonElement>(null)];
  const logRef = useRef<HTMLElement>(null);

  // Keep keyboard focus on the next action after a button disables itself.
  useEffect(() => {
    const next = { start: 0, pledged: 1, doubled: 2, released: 3 }[step];
    if (log.length > 0) buttons[next].current?.focus();
    if (log.length > 0 && window.matchMedia('(max-width: 860px)').matches) logRef.current?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, log.length]);

  const push = (label: string, outcome: Outcome) => {
    setLog((l) => [...l, { label, outcome }]);
    force((n) => n + 1);
  };

  const pledgeA = () => {
    const outcome = run.pledgeTo('A');
    if (outcome.ok) setNoteSalt(run.noteSalt);
    push('Borrower pledges the invoice to Lender A', outcome);
    if (outcome.ok) setStep('pledged');
  };

  const pledgeB = () => {
    push('Borrower tries the same invoice at Lender B', run.pledgeTo('B'));
    setStep('doubled');
  };

  const release = () => {
    if (!noteSalt) return;
    push('Lender A releases the pledge (invoice paid)', run.releaseByA(noteSalt));
    setStep('released');
  };

  const reset = () => {
    setRun(new Walkthrough());
    setStep('start');
    setLog([]);
    setNoteSalt(null);
  };

  const pledged = step !== 'start';

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Receivables finance · Poland's KSeF e-invoicing</p>
        <h1 tabIndex={-1}>One invoice. Two lenders. Only one gets to finance it.</h1>
        <p className="lede">
          Double-pledging the same invoice to several lenders is one of the oldest frauds in trade finance. Lenders
          could stop it by pooling their books, but no lender will show a rival its clients. OnePledge lets the
          registry refuse the second pledge while each lender sees only its own deals.
        </p>
      </section>

      <section className="invoice card">
        <div>
          <p className="label">Invoice being financed</p>
          <p className="mono big">{run.invoice.ksefNumber}</p>
        </div>
        <dl className="facts">
          <div><dt>Amount</dt><dd>{pln(run.invoice.amountGrosz)}</dd></div>
          <div><dt>Due</dt><dd>{run.invoice.dueDate}</dd></div>
          <div><dt>Seller NIP</dt><dd className="mono">{run.invoice.sellerNip}</dd></div>
          <div><dt>Debtor NIP</dt><dd className="mono">{run.invoice.debtorNip}</dd></div>
        </dl>
      </section>

      <p className="notice">
        <span className="notice-dot" aria-hidden />
        <span>
          This walkthrough runs the real compiled Compact circuits in your browser against an in-memory ledger: no
          transactions are sent. The same contract is deployed on Midnight Preprod: see the{' '}
          <a href="/live">Live registry</a>.
        </span>
      </p>

      <section className="actions">
        <button ref={buttons[0]} onClick={pledgeA} disabled={step !== 'start'}>1 · Pledge to Lender A</button>
        <button ref={buttons[1]} onClick={pledgeB} disabled={step !== 'pledged'} className="danger">2 · Try it again at Lender B</button>
        <button ref={buttons[2]} onClick={release} disabled={step !== 'doubled'}>3 · Lender A releases (paid)</button>
        <button ref={buttons[3]} onClick={reset} className="ghost">Start over</button>
      </section>

      <section className="columns">
        <article className="card column">
          <h2>Lender A</h2>
          <p className="role">Financed the invoice</p>
          {pledged ? (
            <ul className="seen">
              <li><span className="yes">Sees</span> the full invoice: {pln(run.invoice.amountGrosz)}, due {run.invoice.dueDate}</li>
              <li><span className="yes">Checks</span> the opening matches the signed commitment: {run.lenderAOpensInvoice() ? 'matches' : 'MISMATCH'}</li>
              <li><span className="no">Never sees</span> Lender B's clients or deals</li>
            </ul>
          ) : (
            <p className="muted">Waiting for a pledge.</p>
          )}
        </article>

        <article className="card column">
          <h2>Lender B</h2>
          <p className="role">Asked to finance the same invoice</p>
          {step === 'doubled' || step === 'released' ? (
            <ul className="seen">
              <li><span className="yes">Learns</span> one fact: this invoice is <strong>already pledged</strong>. The borrower's circuit refused before any proof was made.</li>
              <li><span className="yes">Can check</span> before funding: verify the attestation, then look its tag up in the public set on its own machine. Status: {run.encumbered() ? (step === 'released' ? 'pledged (tags are permanent)' : 'encumbered') : 'free'}</li>
              <li><span className="no">Never sees</span> which lender, how much, or the terms</li>
            </ul>
          ) : (
            <p className="muted">Not involved yet.</p>
          )}
        </article>

        <article className="card column public">
          <h2>Everyone else</h2>
          <p className="role">The public Midnight ledger</p>
          <dl className="facts stacked">
            <div><dt>Pledges</dt><dd>{view.pledgeCount.toString()}</dd></div>
            <div><dt>Releases</dt><dd>{view.releaseCount.toString()}</dd></div>
            <div><dt>Tags</dt><dd className="mono">{view.tags.length ? view.tags.map((t) => short(t)).join(', ') : 'none'}</dd></div>
          </dl>
          <p className="muted small">
            A tag is a keyed hash of the KSeF number. Without the tag authority's key, nobody can turn an invoice
            number into its tag, so the set cannot be searched by guessing numbers.
          </p>
        </article>
      </section>

      <section className="card" ref={logRef}>
        <h2>Circuit log</h2>
        {log.length === 0 && <p className="muted">Each button runs the compiled Compact circuit. Results appear here.</p>}
        <ol className="log" aria-live="polite" hidden={log.length === 0}>
          {log.map((entry, i) => (
            <li key={i} className={entry.outcome.ok ? 'ok' : 'rejected'}>
              <span className="badge">{entry.outcome.ok ? 'accepted' : 'rejected'}</span>
              <span>{entry.label}</span>
              <span className="mono muted">{entry.outcome.detail}</span>
            </li>
          ))}
        </ol>
        <p className="muted small">
          Tag {short(hex(run.attestation.tag))} · every pledge carries a fresh signature from the tag authority,
          verified inside the circuit. This page runs the compiled circuits against an in-memory ledger: no proofs are
          generated and nothing goes on chain. The same flow runs on Preprod from the CLI: see the{' '}
          <a href="/live">Live registry</a>.
        </p>
      </section>
    </>
  );
}
