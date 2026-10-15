// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from 'react';
import { Walkthrough, hex, short, type Outcome } from '../engine.ts';

type Step = 'start' | 'pledged' | 'doubled' | 'accepted' | 'declined' | 'released' | 'repledged';

/**
 * Every element the keyboard can be sent to, and every panel that can be scrolled into view. This
 * replaces a map from step to an index into a fixed-length array of button refs: that map had to be
 * read beside the button list to see what it pointed at, three of its seven entries named a button
 * that is disabled in that step (so focus fell to the body instead of moving on), and an index past
 * the end of the array threw. With three acts on the page, a name per control costs a line and says
 * at the call site where focus lands.
 */
type Control =
  | 'pledgeA'
  | 'pledgeB'
  | 'accept'
  | 'decline'
  | 'release'
  | 'repledge'
  | 'reset'
  | 'log'
  | 'seat1'
  | 'seat2'
  | 'seat3'
  | 'admit'
  | 'outsider'
  | 'committeeResult'
  | 'buildBook'
  | 'scanResult'
  | 'floor'
  | 'prove'
  | 'proveResult'
  | 'overclaim'
  | 'drawResult';

const SEATS = ['seat1', 'seat2', 'seat3'] as const satisfies readonly Control[];

/**
 * A draw is proven for a named round and the registry allows one draw per round, so the over-claim
 * gets a round of its own: it always fails, a failed proof records nothing, and its round therefore
 * stays unused and the button stays repeatable.
 */
const DRAW_ROUND = 'onepledge:2026-Q4';
const OVERCLAIM_ROUND = 'onepledge:2026-Q4-overclaim';

const pln = (grosz: string | bigint) =>
  (Number(grosz) / 100).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });

/** Whole ten thousands of złoty, rounded down, so a suggested floor is one the book clears. */
const tenThousands = (grosz: bigint) => (grosz / 1_000_000n) * 10_000n;

/** `next` takes focus; `reveal` is the panel holding the answer, for screens too narrow to show both. */
type Push = (label: string, outcome: Outcome, next: Control, reveal?: Control) => void;

interface Act {
  run: Walkthrough;
  /** Rises with every circuit run, so a view recomputes from the ledger instead of being mirrored in state. */
  runs: number;
  push: Push;
  register: (name: Control) => (el: HTMLElement | null) => void;
}

export function Story() {
  const [run, setRun] = useState(() => new Walkthrough());
  const [step, setStep] = useState<Step>('start');
  const [log, setLog] = useState<{ label: string; outcome: Outcome }[]>([]);
  const [noteSalt, setNoteSalt] = useState<Uint8Array | null>(null);
  // Bumped by Start over and used as the later acts' key: remounting them drops the state they hold
  // along with the run it belonged to, instead of this component having to remember every field.
  const [generation, setGeneration] = useState(0);
  const [landing, setLanding] = useState<{ next: Control; reveal: Control } | null>(null);
  const [, force] = useState(0);
  const view = useMemo(() => run.publicView(), [run, step, log]);
  const controls = useRef(new Map<Control, HTMLElement | null>());
  const register = (name: Control) => (el: HTMLElement | null) => {
    controls.current.set(name, el);
  };

  // Keep keyboard focus on the next action after a button disables itself, and on a narrow screen
  // bring the panel that answered into view: the first act answers in the log at the foot of the
  // page, the later acts answer beside their own buttons.
  useEffect(() => {
    if (!landing || log.length === 0) return;
    controls.current.get(landing.next)?.focus();
    if (window.matchMedia('(max-width: 860px)').matches) {
      controls.current.get(landing.reveal)?.scrollIntoView({ block: 'nearest' });
    }
  }, [landing, log.length]);

  const push: Push = (label, outcome, next, reveal = 'log') => {
    setLog((l) => [...l, { label, outcome }]);
    setLanding({ next, reveal });
    force((n) => n + 1);
  };

  const pledgeA = () => {
    const outcome = run.pledgeTo('A');
    if (outcome.ok) setNoteSalt(run.noteSalt);
    push('Borrower pledges the invoice to Lender A', outcome, outcome.ok ? 'pledgeB' : 'pledgeA');
    if (outcome.ok) setStep('pledged');
  };

  const pledgeB = () => {
    push('Borrower tries the same invoice at Lender B', run.pledgeTo('B'), 'accept');
    setStep('doubled');
  };

  const decide = (decision: 'accept' | 'decline') => () => {
    if (!noteSalt) return;
    const outcome = run.decideByA(decision, noteSalt);
    const forward: Control = decision === 'accept' ? 'release' : 'repledge';
    push(
      decision === 'accept'
        ? 'Lender A accepts the pledge'
        : 'Lender A declines the pledge, freeing the receivable',
      outcome,
      outcome.ok ? forward : decision,
    );
    if (outcome.ok) setStep(decision === 'accept' ? 'accepted' : 'declined');
  };

  const release = () => {
    if (!noteSalt) return;
    const outcome = run.releaseByA(noteSalt);
    push('Lender A releases the pledge (invoice paid)', outcome, outcome.ok ? 'reset' : 'release');
    setStep('released');
  };

  const repledgeB = () => {
    const outcome = run.pledgeTo('B');
    if (outcome.ok) setNoteSalt(run.noteSalt);
    push('Borrower pledges the freed invoice to Lender B', outcome, outcome.ok ? 'reset' : 'repledge');
    if (outcome.ok) setStep('repledged');
  };

  const reset = () => {
    setRun(new Walkthrough());
    setStep('start');
    setLog([]);
    setNoteSalt(null);
    setLanding(null);
    setGeneration((g) => g + 1);
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
        <button ref={register('pledgeA')} onClick={pledgeA} disabled={step !== 'start'}>1 · Pledge to Lender A</button>
        <button ref={register('pledgeB')} onClick={pledgeB} disabled={step !== 'pledged'} className="danger">2 · Try it again at Lender B</button>
        <button ref={register('accept')} onClick={decide('accept')} disabled={step !== 'doubled'}>3 · Lender A accepts</button>
        <button ref={register('decline')} onClick={decide('decline')} disabled={step !== 'doubled'} className="danger">3 · Lender A declines</button>
        <button ref={register('release')} onClick={release} disabled={step !== 'accepted'}>4 · Lender A releases (paid)</button>
        <button ref={register('repledge')} onClick={repledgeB} disabled={step !== 'declined'}>4 · Pledge the freed invoice to Lender B</button>
        <button ref={register('reset')} onClick={reset} className="ghost">Start over</button>
      </section>

      <section className="columns">
        <article className="card column">
          <h2>Lender A</h2>
          <p className="role">
            {step === 'declined' || step === 'repledged'
              ? 'Refused the pledge'
              : step === 'start'
                ? 'The lender the borrower approaches'
                : 'Holds the pledge'}
          </p>
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
          <p className="role">
            {step === 'repledged' ? 'Financed the invoice after Lender A refused' : 'Asked to finance the same invoice'}
          </p>
          {step === 'repledged' ? (
            <ul className="seen">
              <li>
                <span className="yes">Sees</span> the full invoice, because the borrower came to it once
                Lender A had let the receivable go
              </li>
              <li>
                <span className="yes">Knows</span> the receivable was free when it pledged: the registry
                refused it minutes earlier and accepted it now
              </li>
              <li><span className="no">Never sees</span> that Lender A was the one who refused, or on what terms</li>
            </ul>
          ) : step === 'doubled' || step === 'accepted' || step === 'released' || step === 'declined' ? (
            <ul className="seen">
              <li><span className="yes">Learns</span> one fact: this invoice is <strong>already pledged</strong>. The borrower's circuit refused before any proof was made.</li>
              <li><span className="yes">Can check</span> before funding: verify the attestation, then look its tag up in the public set on its own machine. Status: {run.encumbered() ? (step === 'released' ? 'pledged (an accepted pledge keeps the tag)' : 'encumbered') : 'free again, because Lender A declined'}</li>
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
            <div><dt>Accepted</dt><dd>{view.acceptCount.toString()}</dd></div>
            <div><dt>Declined</dt><dd>{view.declineCount.toString()}</dd></div>
            <div><dt>Releases</dt><dd>{view.releaseCount.toString()}</dd></div>
            <div><dt>Borrowing-base draws</dt><dd>{view.drawCount.toString()}</dd></div>
            <div><dt>Tags</dt><dd className="mono">{view.tags.length ? view.tags.map((t) => short(t)).join(', ') : 'none'}</dd></div>
          </dl>
          <p className="muted small">
            A tag is a keyed hash of the KSeF number. Without the tag authority's key, nobody can turn an invoice
            number into its tag, so the set cannot be searched by guessing numbers. A decision is recorded as an
            opaque nullifier: the counts move, but the ledger never says which lender decided, or on what.
          </p>
        </article>
      </section>

      <section className="card" ref={register('log')}>
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
          <a href="/live">Live registry</a>. The two acts below run against this same ledger and land in this log too.
        </p>
      </section>

      <Committee key={`committee-${generation}`} run={run} runs={log.length} push={push} register={register} />
      <BorrowingBase key={`base-${generation}`} run={run} runs={log.length} push={push} register={register} />
    </>
  );
}

/** Who may admit a lender: two of three registrar seats, and the ledger never learns which two. */
function Committee({ run, runs, push, register }: Act) {
  /** Which seats this tab clicked. The ledger has no equivalent, which is the point of the act. */
  const [clicked, setClicked] = useState<number[]>([]);
  const [admitted, setAdmitted] = useState(false);
  const [last, setLast] = useState<Outcome | null>(null);
  const view = useMemo(() => run.committeeView(), [run, runs]);
  const approvals = useMemo(() => run.approvalsForC(), [run, runs]);

  /** After a refused admission, the seat to try next — the story is short of approvals, not of seats. */
  const unusedSeat = (seats: number[]): Control => {
    const free = [0, 1, 2].find((seat) => !seats.includes(seat));
    return free === undefined ? 'admit' : SEATS[free];
  };

  const approve = (seat: number) => () => {
    const outcome = run.approveAdmitC(seat);
    const seats = outcome.ok ? [...clicked, seat] : clicked;
    setClicked(seats);
    setLast(outcome);
    // Focus goes to Admit whether or not this approval was the second one: trying it and being
    // refused is the step that makes the threshold visible.
    push(`Registrar seat ${seat + 1} approves admitting Lender C`, outcome, 'admit', 'committeeResult');
  };

  const admit = () => {
    const outcome = run.executeAdmitC();
    if (outcome.ok) setAdmitted(true);
    setLast(outcome);
    push(
      'The pending admission of Lender C is carried out',
      outcome,
      outcome.ok ? 'committeeResult' : unusedSeat(clicked),
      'committeeResult',
    );
  };

  const outsider = () => {
    // The engine reaches this circuit through a seat index, so an outsider's key has to sit in the seat
    // array to be tried at all: seat 4 of a three-seat committee, holding Lender B's own key. Nothing
    // reads the array's length, and the registrar tree has no leaf for that key, which is the point.
    // The alternative was driving run.sim from this page, which would copy the engine's translation of
    // circuit failures into the UI.
    if (run.committee.length === 3) run.committee.push(run.lenderB);
    const outcome = run.approveAdmitC(3);
    setLast(outcome);
    push('Lender B, which holds no committee seat, approves admitting Lender C', outcome, 'outsider', 'committeeResult');
  };

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Registry v4 · admitting a lender</p>
        <h2>Three seats. Two have to agree. The ledger never learns which two.</h2>
        <p className="lede">
          Somebody has to let lenders into the registry, and one key doing that alone is both a single point of failure
          and a single thing to subvert. An admission now takes two of three registrar seats. Lender A and Lender B
          above were admitted this way before the page loaded; Lender C is still outside. Approve for it, then carry the
          admission out.
        </p>
      </section>

      <section className="actions">
        <button ref={register('seat1')} onClick={approve(0)} disabled={admitted}>Seat 1 approves</button>
        <button ref={register('seat2')} onClick={approve(1)} disabled={admitted}>Seat 2 approves</button>
        <button ref={register('seat3')} onClick={approve(2)} disabled={admitted}>Seat 3 approves</button>
        <button ref={register('admit')} onClick={admit} disabled={admitted}>Admit Lender C</button>
        <button ref={register('outsider')} onClick={outsider} disabled={admitted} className="danger">
          Lender B tries to approve
        </button>
      </section>

      <p className="banner" role="status" tabIndex={-1} ref={register('committeeResult')} hidden={!last}>
        {last && (
          <>
            <span className="badge">{last.ok ? 'accepted' : 'rejected'}</span> {last.detail}
          </>
        )}
      </p>

      <p className="notice">
        <span className="notice-dot" aria-hidden />
        <span>
          Three refusals worth seeing: one seat and then <em>Admit</em> (one approval is not two); the same seat twice
          (an approval carries a marker derived from that seat's own secret, so it counts once — and the marker still
          names no seat); and Lender B, whose key is on the ledger as an admitted lender but matches no seat.
        </span>
      </p>

      <section className="columns two">
        <article className="card column">
          <h2>This tab</h2>
          <p className="role">What your browser knows, because you clicked it</p>
          <ul className="seen">
            {[0, 1, 2].map((seat) => (
              <li key={seat}>
                <span className={clicked.includes(seat) ? 'yes' : 'no'}>
                  {clicked.includes(seat) ? 'approved' : 'no vote'}
                </span>
                Registrar seat {seat + 1}
              </li>
            ))}
          </ul>
          <p className="muted small">
            This list exists in this tab and nowhere else. All three seat keys are here because a browser demo has
            nobody else to hold them; on a real deployment they are three separate holders, which is the only thing
            that makes two-of-three worth anything.
          </p>
        </article>

        <article className="card column">
          <h2>The public ledger</h2>
          <p className="role">What anyone reading the chain sees</p>
          <dl className="facts stacked">
            <div><dt>Registrar seats</dt><dd>{view.seats}</dd></div>
            <div><dt>Approvals required</dt><dd>{view.threshold.toString()}, sealed at deployment</dd></div>
            <div>
              <dt>Approvals on this admission</dt>
              <dd>
                {admitted ? 'none left: the admission spent them' : `${approvals} of ${view.seats}, no seat named`}
              </dd>
            </div>
            <div><dt>Committee epoch</dt><dd>{view.epoch.toString()}</dd></div>
            <div><dt>Lenders admitted</dt><dd>{view.admitted}</dd></div>
          </dl>
          <p className="muted small">
            The ledger holds one leaf per seat — a hash binding that seat's key commitment to the current epoch — in a
            tree whose root everyone can read. A seat approves by proving that one of those three leaves is its own,
            and that proof comes out the same whichever of the three it was: the count moves and the approval names no
            seat. Carrying the admission out needs no key at all — once two approvals exist the
            authorisation is complete, so whoever submits it is immaterial — and it spends the approvals it used and
            marks that action done, so the same approvals cannot be submitted again.
          </p>
          <p className="muted small">
            The obvious design — a list of registrar keys that the circuit looks the approver up in — was rejected
            because every admission would then publish which registrar vouched for which lender: a permanent public
            record of the one thing this registry exists not to keep. Plainly, though, the ledger does still say "two of
            these three", so a seat hides in a crowd of three, and a bigger committee is a bigger crowd. The epoch is
            how a committee is retired: rotate the seats and it moves, and both the old seats and anything they had
            approved stop counting. This page does not rotate — the registry's rotate circuits and their tests do.
          </p>
        </article>
      </section>
    </>
  );
}

/** A lender proves what its book is worth to a funder, without handing over the book. */
function BorrowingBase({ run, runs, push, register }: Act) {
  const [built, setBuilt] = useState(false);
  const [scan, setScan] = useState<Outcome | null>(null);
  const [last, setLast] = useState<Outcome | null>(null);
  const [floorZl, setFloorZl] = useState('');

  const total = useMemo(() => run.bookTotal(), [run, runs]);
  const deliveries = useMemo(() => run.sim.ledger().deliveries.size(), [run, runs]);
  const drawCount = useMemo(() => run.drawView().count, [run, runs]);
  // drawView() returns the floors on their own; reading the public map pairs each floor with the draw
  // id it was recorded under, and those two values plus the round are the whole of what a draw puts
  // on chain.
  const draws = useMemo(
    () =>
      [...run.sim.ledger().draws].map(([id, record]) => ({
        id: short(hex(id)),
        round: new TextDecoder().decode(record.round).replace(/\0+$/, ''),
        floor: record.floor,
      })),
    [run, runs],
  );

  // A figure pasted back out of this page carries pl-PL's narrow no-break space between thousands.
  const digits = floorZl.replace(/\s/gu, '');
  const floorGrosz = /^\d{1,12}$/.test(digits) ? BigInt(digits) * 100n : null;
  const overclaimFloor = (total / 1_000_000n + 1n) * 1_000_000n;

  const build = () => {
    const outcome = run.buildBook();
    setScan(outcome);
    if (outcome.ok) {
      setBuilt(true);
      setFloorZl(tenThousands(run.bookTotal()).toString());
    }
    push(
      'Lender A pledges four more receivables, then trial-decrypts every delivery on the ledger',
      outcome,
      outcome.ok ? 'prove' : 'buildBook',
      'scanResult',
    );
  };

  const prove = () => {
    if (floorGrosz === null) return;
    const outcome = run.proveBase(floorGrosz, DRAW_ROUND);
    setLast(outcome);
    push(
      `Lender A proves its pool is worth at least ${pln(floorGrosz)}`,
      outcome,
      outcome.ok ? 'drawResult' : 'prove',
      outcome.ok ? 'drawResult' : 'proveResult',
    );
  };

  const tryOverclaim = () => {
    const outcome = run.proveBase(overclaimFloor, OVERCLAIM_ROUND);
    setLast(outcome);
    push(
      `Lender A tries to prove ${pln(overclaimFloor)}, more than the pool holds`,
      outcome,
      'overclaim',
      'proveResult',
    );
  };

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Registry v4 · the borrowing base</p>
        <h2>Prove the book clears a floor, without showing the book.</h2>
        <p className="lede">
          A lender that finances receivables is itself financed, and its funder wants to know the book behind a
          drawdown is real and large enough. Showing it means handing over the client list, the invoices and the
          amounts — the same disclosure problem this registry exists to avoid, one floor up. So the lender proves
          instead: these receivables are pledged to me, they are on this ledger, and together they are worth at least
          this much.
        </p>
      </section>

      <section className="card">
        <h2>Build Lender A's book</h2>
        <p className="role">Four more pledges, each delivered to Lender A in a sealed envelope</p>
        <p className="muted small">
          A pledge leaves an encrypted opening on the ledger, keyed by the note. Nothing in it says who it is for, so a
          lender finds its own the way shielded protocols do: it tries to decrypt every delivery and keeps the ones that
          open. That scan is the inbox, and the inbox is where a draw gets its numbers.
        </p>
        <div className="row">
          <button ref={register('buildBook')} onClick={build} disabled={built}>Build the book and scan for it</button>
        </div>
        <p className="banner" role="status" ref={register('scanResult')} hidden={!scan}>
          {scan && (
            <>
              <span className="badge">{scan.ok ? 'accepted' : 'rejected'}</span> {scan.detail}
            </>
          )}
        </p>
        {built && (
          <>
            <ul className="seen">
              {run.book.map((item) => (
                <li key={hex(item.opening.tag)}>
                  <span className="yes">opened</span>
                  {pln(item.opening.amount)} · tag <span className="mono">{short(item.opening.tag)}</span>
                </li>
              ))}
            </ul>
            <p className="muted small">
              {deliveries.toString()} deliveries sit on the ledger, {run.book.length} of them opened for Lender A, and
              nothing on chain says which ones: the map is keyed by note commitments, and a ciphertext that refuses to
              decrypt looks exactly like one addressed to somebody else. You can read the amounts because this page is
              Lender A's own screen.
            </p>
            <p className="muted small">
              A draw covers four receivables at a time — a depth-16 path and a note recompute cost about 4.8 MB of
              proving key each, so the circuit is compiled for four and a longer book draws round by round.{' '}
              {run.book.length > 4
                ? `This inbox holds ${run.book.length} openings, so the draw below covers four of them;`
                : 'All four go into the pool;'}{' '}
              together they are worth {pln(total)}.
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2>Prove a floor</h2>
        <p className="role">One number goes public, and it is the entire claim</p>
        <label className="field">
          <span className="label">Floor to prove, in whole złoty</span>
          <input
            className="mono"
            ref={register('floor')}
            value={floorZl}
            onChange={(e) => setFloorZl(e.target.value)}
            inputMode="numeric"
            placeholder="e.g. 120000"
            spellCheck={false}
            disabled={!built}
            aria-describedby="floor-hint"
          />
        </label>
        {/* Described rather than announced: a live region on a field hint re-reads itself at every
            keystroke, and this hint is read when the field takes focus, which is when it matters. */}
        <p id="floor-hint" className={built && floorGrosz === null ? 'error small' : 'muted small'}>
          {!built
            ? 'Build the book first: the pool has to exist before anything can be proven about it.'
            : floorGrosz === null
              ? 'A floor is a whole number of złoty, digits only.'
              : `${pln(floorGrosz)} is the one figure the chain will learn.`}
        </p>
        <div className="row">
          <button ref={register('prove')} onClick={prove} disabled={!built || floorGrosz === null}>
            {built && floorGrosz !== null ? `Prove at least ${pln(floorGrosz)}` : 'Prove this floor'}
          </button>
          <button ref={register('overclaim')} onClick={tryOverclaim} disabled={!built} className="danger">
            {built ? `Try ${pln(overclaimFloor)}, above the pool` : 'Try a floor above the pool'}
          </button>
        </div>
        <p className="banner" role="status" ref={register('proveResult')} hidden={!last}>
          {last && (
            <>
              <span className="badge">{last.ok ? 'accepted' : 'rejected'}</span> {last.detail}
            </>
          )}
        </p>
        <p className="muted small">
          Nobody is trusted to be the right lender: the circuit rebuilds each note commitment from the prover's own
          secret, so only the lender of record for all four can prove anything about them. Press <em>Prove</em>{' '}
          twice and the registry refuses the second one — a draw is made for a named round, one draw per round, so a
          lender cannot quietly re-draw against the same book.
        </p>
      </section>

      <section className="columns two">
        <article className="card column">
          <h2>What the chain holds</h2>
          <p className="role">Draws recorded in this registry: {drawCount.toString()}</p>
          <ul className="seen" tabIndex={-1} ref={register('drawResult')}>
            {draws.length === 0 ? (
              <li className="muted">No draw yet.</li>
            ) : (
              draws.map((draw) => (
                <li key={draw.id}>
                  <span className="yes">floor</span>
                  {pln(draw.floor)} · round <span className="mono">{draw.round}</span> · draw id{' '}
                  <span className="mono">{draw.id}</span>
                </li>
              ))
            )}
          </ul>
          <p className="muted small">
            The floor is public on purpose: it is the claim. The round is a label the lender picked, and the draw id is
            a hash of that round under the lender's own secret — unguessable without it, and unrelated to the id the
            same lender would get in any other round.
          </p>
        </article>

        <article className="card column">
          <h2>What it does not hold</h2>
          <p className="role">Everything the funder never needed</p>
          <ul className="seen">
            <li>
              <span className="no">Not recorded</span> any of the four amounts: each is bound into a note commitment
              and added up inside the circuit
            </li>
            <li>
              <span className="no">Not recorded</span> which receivables were counted: no tag, no note, no per-item
              nullifier is published
            </li>
            <li>
              <span className="no">Not recorded</span> which lender proved it, or that any two draws came from the same
              lender
            </li>
            <li>
              <span className="yes">Public by construction</span> that a draw covers exactly four receivables, because
              the circuit is compiled for four
            </li>
          </ul>
          <p className="muted small">
            One honest limit: on this page the circuits run against an in-memory ledger, so a refusal is the circuit's
            own assertion rather than a verifier rejecting a proof. The assertions are the ones the deployed contract
            makes. A real chain also sees who submitted the transaction, and this page has no network layer to show
            that in.
          </p>
        </article>
      </section>
    </>
  );
}
