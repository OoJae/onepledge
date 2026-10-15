// SPDX-License-Identifier: Apache-2.0
// The lender inbox: find your own pledges by trying to decrypt all of them.
//
// This is the page that makes encrypted delivery visible. On chain a pledge is a tag, an opaque note
// commitment and a ciphertext filed under that commitment; nothing says who the ciphertext is for. A
// lender therefore scans every delivery and keeps what opens, and the count it scanned against the
// count it opened is the privacy property stated as a number.
//
// Everything heavy — the compiled contract, its ledger reader, the provider stack — sits behind a
// dynamic import of ../wallet/inbox.ts, so this page renders its connect panel and its "no wallet
// here" message without fetching 5 MB of WASM first.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EXPECTED_NETWORK,
  connect,
  describeError,
  waitForWallets,
  type Connection,
  type WalletChoice,
} from '../wallet/connector.ts';
import type { Draw, LenderAction, Opened, Preflight, Scan } from '../wallet/inbox.ts';
import type { DemoBundle } from '../wallet/pledge.ts';
// The deployed registry, read from the record rather than written in prose: the bundle names its own
// registry, and the two going out of step is exactly what this page has to say out loud.
import deployment from '../../../deployments/preprod.json';

type InboxModule = typeof import('../wallet/inbox.ts');

// Everything that touches the compiled contract goes through here, so this page's own chunk stays
// small enough to render before any of it has downloaded. Module level rather than a ref: the import
// cache is per module anyway, and this way none of the callbacks below has to depend on it.
let loaded: InboxModule | undefined;
const inbox = async (): Promise<InboxModule> => (loaded ??= await import('../wallet/inbox.ts'));

const EXPLORER = 'https://preprod.midnightexplorer.com/transactions';

const short = (s: string) => (s.length > 24 ? `${s.slice(0, 12)}…${s.slice(-8)}` : s);
const dustOf = (n: bigint) => (Number(n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });

/**
 * Grosz as Polish currency, formatted from the bigint rather than through Number: an amount is a
 * Uint<64> in the circuit, and the large end of that range does not survive a float.
 */
const pln = (grosz: bigint): string => {
  // A non-breaking space groups the thousands, which is how pl-PL writes them and what keeps an
  // amount from wrapping mid-number.
  const whole = (grosz / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${whole},${(grosz % 100n).toString().padStart(2, '0')} zł`;
};

/** Zloty text to grosz without float arithmetic, so 1234,56 zł is exactly 123456 grosz. */
const parseZloty = (text: string): bigint | null => {
  // \s covers the non-breaking space this page's own formatting puts between thousands, so a figure
  // pasted back out of the display parses.
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  const match = /^(\d{1,18})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '0').padEnd(2, '0'));
};

const ACTION_LABEL: Record<LenderAction, string> = {
  accept: 'Accepted',
  decline: 'Declined',
  release: 'Released',
};

/** Accept and decline share one nullifier, so a note shows at most one of the two; release is a
 *  separate nullifier, so it can show alongside either. */
const stateOf = (d: Opened): string => {
  if (!d.binds) return 'no usable opening';
  const marks = [d.accepted && 'accepted', d.declined && 'declined', d.released && 'released'].filter(Boolean);
  return marks.length > 0 ? marks.join(', ') : 'undecided';
};

export default function Inbox() {
  const [choices, setChoices] = useState<WalletChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Preflight | null>(null);
  const [bundle, setBundle] = useState<DemoBundle | null>(null);
  const [bundleFailed, setBundleFailed] = useState(false);
  const [lender, setLender] = useState(0);
  const [scan, setScan] = useState<Scan | null>(null);
  const [reading, setReading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [sent, setSent] = useState<{ label: string; txHash: string; blockHeight: number }[]>([]);
  const [floorText, setFloorText] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [draw, setDraw] = useState<Draw | null>(null);
  const connection = useRef<Connection | null>(null);

  // Poll for injection on mount. Doing this inside the click handler would spend the page's transient
  // user activation and the wallet's authorisation pop-up would be silently blocked.
  useEffect(() => {
    let live = true;
    void waitForWallets().then((found) => live && setChoices(found));
    return () => {
      live = false;
    };
  }, []);

  // Extensions inject late, and a fresh install usually lands after this page has already given up.
  const rescan = useCallback(async () => {
    setRescanning(true);
    setChoices(await waitForWallets());
    setRescanning(false);
  }, []);

  const onConnect = useCallback(async (choice: WalletChoice) => {
    setBusy(true);
    setError(null);
    try {
      // No await before connect(): the gesture has to reach the wallet intact.
      const conn = await connect(choice);
      connection.current = conn;
      const mod = await inbox();
      setWallet(await mod.preflight(conn));
      setBundle(
        await mod.loadBundle().catch(() => {
          setBundleFailed(true);
          return null;
        }),
      );
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const chosen = bundle?.lenders[lender];
  const secret = chosen?.secret;
  const mintedWithSecrets = bundle !== null && bundle.lenders.some((l) => l.secret !== undefined);
  const otherRegistry = bundle !== null && bundle.contractAddress !== deployment.contractAddress;
  const ready =
    wallet !== null &&
    wallet.dust > 0n &&
    (wallet.proving === 'wallet' || wallet.proofServer?.reachable === true);

  const runScan = useCallback(async () => {
    if (!bundle || !secret || reading) return;
    setReading(true);
    setError(null);
    try {
      const mod = await inbox();
      setScan(await mod.scanInbox(bundle, secret));
    } catch (e) {
      setScan(null);
      setError(describeError(e));
    } finally {
      setReading(false);
    }
  }, [bundle, secret, reading]);

  // Land on a lender this bundle can actually act as. A bundle minted before the inbox existed has no
  // secrets at all and is handled separately; this only matters for a partial one.
  useEffect(() => {
    if (!bundle) return;
    const first = bundle.lenders.findIndex((l) => l.secret !== undefined);
    if (first > 0) setLender(first);
  }, [bundle]);

  // A different lender is a different book; keeping the old scan on screen would be a lie about it.
  useEffect(() => {
    setScan(null);
    setDraw(null);
    setFloorText('');
  }, [lender]);

  // Offer a floor at or below the true total, rounded down to whole thousands of zloty, the way the
  // CLI demo picks one. Only as a starting point: the floor is the lender's claim, and typing one the
  // book does not reach is worth seeing, because the circuit refuses it before any proof is built.
  useEffect(() => {
    if (!scan || scan.pool.length < scan.poolSize) return;
    const total = scan.pool.reduce((sum, d) => sum + d.opening.amount, 0n);
    setFloorText((current) => (current === '' ? ((total / 100_000n) * 1_000n).toString() : current));
  }, [scan]);

  const onAct = useCallback(
    async (d: Opened, action: LenderAction) => {
      const conn = connection.current;
      // The in-flight button stays focusable (aria-disabled, not disabled), so it can be pressed
      // again; one transaction at a time is enforced here rather than by taking focus away.
      if (!conn || !bundle || !secret || acting !== null) return;
      setActing(`${d.filedUnder}:${action}`);
      setError(null);
      try {
        const mod = await inbox();
        const tx = await mod.act(conn, bundle, secret, d.opening, action);
        setSent((s) => [
          ...s,
          { label: `${ACTION_LABEL[action]} ${d.invoice?.ksefNumber ?? short(d.filedUnder)}`, ...tx },
        ]);
        await runScan();
      } catch (e) {
        setError(describeError(e));
      } finally {
        setActing(null);
      }
    },
    [bundle, secret, acting, runScan],
  );

  const floor = parseZloty(floorText);
  const poolTotal = scan?.pool.reduce((sum, d) => sum + d.opening.amount, 0n) ?? 0n;

  const onDraw = useCallback(async () => {
    const conn = connection.current;
    const target = parseZloty(floorText);
    if (!conn || !bundle || !secret || !scan || target === null || drawing) return;
    setDrawing(true);
    setError(null);
    try {
      const mod = await inbox();
      const result = await mod.proveBorrowingBase(
        conn,
        bundle,
        secret,
        scan.pool.map((d) => d.opening),
        target,
        scan.round.label,
      );
      setDraw(result);
      setSent((s) => [
        ...s,
        {
          label: `Proved a borrowing base of at least ${pln(result.floor)}`,
          txHash: result.txHash,
          blockHeight: result.blockHeight,
        },
      ]);
    } catch (e) {
      const message = describeError(e);
      setError(
        /does not clear the floor/i.test(message)
          ? 'The circuit refused that floor: the four receivables do not add up to it. Nothing was sent — the assertion fires while the proof is being built, so an overstated borrowing base costs no transaction and leaves nothing on chain to say it was tried.'
          : /already proven for this round/i.test(message)
            ? 'This lender has already proven a borrowing base for this round. One draw per round is what holds a lender to a single claim; press "Scan again" to see the draw that is already on chain.'
            : message,
      );
    } finally {
      setDrawing(false);
    }
  }, [bundle, secret, scan, floorText, drawing]);

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Lender inbox · Midnight Preprod · registry {deployment.version}</p>
        <h1 tabIndex={-1}>Find your own pledges.</h1>
        <p className="lede">
          A pledge on chain is a tag, an opaque note commitment, and a ciphertext filed under that
          commitment. Nothing says who the ciphertext is for, so a lender finds its own book the way
          shielded protocols do: it tries to decrypt every delivery and keeps the ones that open. This
          page does that against the deployed registry, in this tab. The key it decrypts with is a demo
          lender's party secret, published in the demo bundle on purpose; a wallet will not decrypt
          arbitrary payloads, so yours only signs and pays for what you do with what opened.
        </p>
      </section>

      {choices === null && (
        <p className="loading muted" role="status">
          Looking for a Midnight wallet…
        </p>
      )}

      {choices !== null && choices.length === 0 && (
        <>
          <p className="notice">
            <span className="notice-dot" aria-hidden />
            <span>
              No Midnight wallet is injected on this page, so there is nothing to scan with. Install{' '}
              <a href="https://www.lace.io/midnight" rel="noreferrer noopener" target="_blank">
                Lace
              </a>{' '}
              or{' '}
              <a href="https://1am.xyz/" rel="noreferrer noopener" target="_blank">
                1AM
              </a>
              , switch it to Preprod and reload. The <a href="/demo">walkthrough</a> runs the same
              accept, decline and release circuits with no wallet at all, and <a href="/live">/live</a>{' '}
              shows what the chain holds.
            </span>
          </p>
          <section className="actions">
            <button className="ghost" onClick={() => void rescan()} aria-busy={rescanning}>
              {rescanning ? 'Looking…' : 'Look again'}
            </button>
          </section>
        </>
      )}

      {choices !== null && choices.length > 0 && wallet === null && (
        <section className="actions">
          {choices.map((c) => (
            <button key={c.rdns} onClick={() => void onConnect(c)} disabled={busy || !c.compatible}>
              {busy ? 'Waiting for the wallet…' : `Connect ${c.label}`}
            </button>
          ))}
        </section>
      )}

      {choices?.some((c) => !c.compatible) && (
        <p className="small muted">
          A wallet was found but reports a connector API this page does not support. OnePledge targets
          connector 4.x.
        </p>
      )}

      {error !== null && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}

      {wallet !== null && (
        <section className="columns two">
          <article className="card column">
            <h2>Connected</h2>
            <p className="role">Network {EXPECTED_NETWORK}</p>
            <dl className="facts stacked">
              <div>
                <dt>Shielded</dt>
                <dd className="mono">{short(wallet.shielded)}</dd>
              </div>
              <div>
                <dt>Unshielded</dt>
                <dd className="mono">{short(wallet.unshielded)}</dd>
              </div>
              <div>
                <dt>DUST</dt>
                <dd className="mono">{dustOf(wallet.dust)}</dd>
              </div>
            </dl>
          </article>

          <article className="card column">
            <h2>Before an inbox action can be sent</h2>
            <p className="role">Accepting, declining, releasing and drawing are all transactions</p>
            <ul className="seen">
              <li>
                <span className="yes">Network</span> your wallet is on {EXPECTED_NETWORK}, where
                registry {deployment.version} is deployed
              </li>
              <li>
                <span className={wallet.proving === 'wallet' ? 'yes' : 'no'}>Proving</span>{' '}
                {wallet.proving === 'wallet'
                  ? 'this wallet proves in the browser, so there is nothing to install'
                  : `this wallet cannot prove, so a proof server must run at ${wallet.proofServer?.uri}`}
              </li>
              {wallet.proving === 'proof-server' && (
                <li>
                  <span className={wallet.proofServer?.reachable ? 'yes' : 'no'}>Proof server</span>{' '}
                  {wallet.proofServer?.reachable
                    ? 'reachable'
                    : 'not reachable. Run docker run -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v'}
                </li>
              )}
              <li>
                <span className={wallet.dust > 0n ? 'yes' : 'no'}>DUST</span>{' '}
                {wallet.dust > 0n
                  ? 'available to pay fees'
                  : 'none yet. Fund the wallet from the Preprod faucet, press Generate tDUST, then wait: a fresh wallet takes hours to accrue any'}
              </li>
            </ul>
            <p className="muted small">
              Scanning needs none of this. Reading deliveries off the public indexer and decrypting
              them happens entirely in this tab; only the buttons below spend a transaction.
            </p>
          </article>
        </section>
      )}

      {bundleFailed && (
        <p className="notice">
          <span className="notice-dot" aria-hidden />
          <span>
            The demo bundle could not be fetched, so there is no lender to act as. It is a static file
            minted by <span className="mono">npm run mint:attestations --workspace cli</span>.
          </span>
        </p>
      )}

      {bundle !== null && !mintedWithSecrets && (
        <p className="notice">
          <span className="notice-dot" aria-hidden />
          <span>
            This inbox needs a freshly minted demo bundle. The one being served publishes each demo
            lender's key and encryption key but not its <span className="mono">secret</span>, and
            without that secret nothing can be decrypted in your browser — a delivery is sealed to the
            lender, not to the page. Re-run{' '}
            <span className="mono">npm run mint:attestations --workspace cli</span> and reload. The{' '}
            <a href="/desk">borrower desk</a> works with the older bundle, so you can still pledge.
          </span>
        </p>
      )}

      {otherRegistry && (
        <p className="notice">
          <span className="notice-dot" aria-hidden />
          <span>
            The bundle names registry {bundle?.registryVersion} at{' '}
            <span className="mono">{short(bundle?.contractAddress ?? '')}</span>, which is not the{' '}
            {deployment.version} deployment this site records. The scan reads the registry the bundle
            names, so it will show that one's deliveries, not this one's.
          </span>
        </p>
      )}

      {bundle !== null && mintedWithSecrets && (
        <section className="card">
          <h2>Act as a lender</h2>
          <p className="role">
            Registry {bundle.registryVersion} · {bundle.lenders.length} demo lenders
          </p>
          <div className="field">
            <label htmlFor="lender">Lender</label>
            <select id="lender" value={lender} onChange={(e) => setLender(Number(e.target.value))}>
              {bundle.lenders.map((l, i) => (
                <option key={l.label} value={i} disabled={l.secret === undefined}>
                  {l.label}
                  {l.secret === undefined ? ' (no secret in this bundle)' : ''}
                </option>
              ))}
            </select>
          </div>
          <section className="actions">
            <button
              onClick={() => void runScan()}
              aria-busy={reading}
              aria-disabled={reading ? true : undefined}
              disabled={!secret}
            >
              {reading ? 'Trying every delivery…' : scan ? 'Scan again' : 'Scan the registry'}
            </button>
          </section>
          <p className="muted small">
            These lender secrets are published in the bundle on purpose, and only because this is a
            testnet toy: a visitor who cannot be a lender cannot see an inbox work at all. On a real
            deployment the secret never leaves the lender's machine, and publishing it would hand
            anyone the power to accept, decline and release that lender's pledges and to read every
            delivery addressed to it.
          </p>
        </section>
      )}

      {scan !== null && (
        <>
          <section className="card">
            <h2>What the scan saw</h2>
            <p className="role" role="status">
              Read from the public indexer at {scan.readAt.slice(11, 19)} UTC
            </p>
            <dl className="facts">
              <div>
                <dt>Deliveries tried</dt>
                <dd className="big">{scan.scanned}</dd>
              </div>
              <div>
                <dt>Opened for {chosen?.label}</dt>
                <dd className="big">{scan.opened.length}</dd>
              </div>
              <div>
                <dt>Pledges on the registry</dt>
                <dd className="big">{scan.pledgeCount.toString()}</dd>
              </div>
            </dl>
            <p className="muted small">
              {scan.scanned === 0
                ? 'The registry holds no deliveries yet. Pledge a receivable from the borrower desk and this inbox will have something to find.'
                : `Every one of the ${scan.scanned} was tried; ${scan.scanned - scan.opened.length} did not open. A delivery meant for another lender and a delivery full of garbage are indistinguishable from here, which is the point: the ciphertext carries no recipient hint, and the map that holds it never says who a delivery is for. That is why the work is proportional to the whole registry rather than to one lender's book — the alternative, a per-lender index, would let anyone holding a lender's key read off that lender's entire book.`}
            </p>
            {!scan.admitted && (
              <p className="banner" role="alert">
                This registry has not admitted {chosen?.label}: there is no entry for its lender key in{' '}
                <span className="mono">lenderEncryptionKeys</span>. A pledge to it cannot be proven, so
                there is nothing addressed to it here, and an empty inbox says nothing about privacy.
              </p>
            )}
            {scan.admitted && !scan.encryptionKeyMatches && (
              <p className="banner" role="alert">
                {chosen?.label} is admitted, but the encryption key the registry published for it is not
                the one this bundle's secret derives. The two are out of step, so no delivery sealed to
                that lender can open here however many are tried. Re-mint the bundle against this
                registry.
              </p>
            )}
          </section>

          {scan.opened.length > 0 && (
            <section className="card">
              <h2>Deliveries that opened</h2>
              <p className="role">
                Each was decrypted here, then checked against the key it was filed under
              </p>
              <ol className="log">
                {scan.opened.map((d) => {
                  const settled = d.accepted || d.declined;
                  const inFlight = (a: LenderAction) => acting === `${d.filedUnder}:${a}`;
                  // Held back, not unavailable: another action is mid-flight. aria-disabled rather
                  // than disabled so the button the visitor pressed keeps keyboard focus.
                  const heldBack = (a: LenderAction) => (acting !== null && !inFlight(a) ? true : undefined);
                  return (
                    <li key={d.filedUnder} className={d.binds ? undefined : 'rejected'}>
                      <span className="badge">{d.binds ? 'binds' : 'mismatch'}</span>
                      <div>
                        <p className="big">
                          {d.invoice ? `${d.invoice.ksefNumber} · ` : ''}
                          {pln(d.opening.amount)}
                        </p>
                        <dl className="facts stacked">
                          <div>
                            <dt>Filed under</dt>
                            <dd className="mono">{d.filedUnder}</dd>
                          </div>
                          <div>
                            <dt>Recomputed from the opening</dt>
                            <dd className="mono">{d.recomputed}</dd>
                          </div>
                          <div>
                            <dt>State on chain</dt>
                            <dd>{stateOf(d)}</dd>
                          </div>
                        </dl>
                        {d.binds ? (
                          <section className="actions">
                            <button
                              onClick={() => void onAct(d, 'accept')}
                              aria-busy={inFlight('accept')}
                              aria-disabled={heldBack('accept')}
                              disabled={settled}
                            >
                              {inFlight('accept') ? 'Proving and submitting…' : 'Accept'}
                            </button>
                            <button
                              className="ghost"
                              onClick={() => void onAct(d, 'decline')}
                              aria-busy={inFlight('decline')}
                              aria-disabled={heldBack('decline')}
                              disabled={settled}
                            >
                              {inFlight('decline') ? 'Proving and submitting…' : 'Decline'}
                            </button>
                            <button
                              className="ghost"
                              onClick={() => void onAct(d, 'release')}
                              aria-busy={inFlight('release')}
                              aria-disabled={heldBack('release')}
                              disabled={d.released}
                            >
                              {inFlight('release') ? 'Proving and submitting…' : 'Release'}
                            </button>
                          </section>
                        ) : (
                          <p className="muted small">
                            This decrypted, but the opening inside is not the opening of the note it was
                            filed under. A borrower builds the ciphertext off-chain and the circuit
                            cannot constrain an opaque value, so recomputing the commitment is the only
                            check a lender has on it — and it fails here. There is nothing to accept,
                            and nothing to decline either: declining needs the real opening of the note
                            on the ledger, which this lender does not hold, so the receivable stays
                            encumbered. Only the borrower loses by that, since it has encumbered its own
                            invoice, but it is still a gap and worth naming as one: the registry has no
                            timeout, and no third party can void a note whose opening nobody holds.
                          </p>
                        )}
                        {d.binds && settled && !d.released && (
                          <p className="muted small">
                            Accept and decline share one nullifier, so a note is decided once and only
                            once. Release is a separate nullifier, so it is still available.
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {scan.opened.some((d) => d.invoice !== undefined) && (
                <p className="muted small">
                  The invoice number beside an amount is not something the chain or the delivery
                  disclosed. A delivery carries the tag, the invoice commitment, the amount and the
                  salt; this page recovers the number by matching that tag against the demo bundle it
                  already holds, which is a property of the demo and not of the design. A real lender
                  knows its own invoice numbers because it financed them.
                </p>
              )}
              {!ready && (
                <p className="notice">
                  <span className="notice-dot" aria-hidden />
                  <span>
                    The buttons above are live, but the checks in the panel at the top have not all
                    passed, so a transaction would fail partway through rather than here.
                  </span>
                </p>
              )}
              <p className="muted small">
                Declining is the void path: the lender refuses the pledge, its tag comes back out of{' '}
                <span className="mono">tags</span>, and the receivable can be financed elsewhere.
                Without it a borrower could burn any invoice forever by pledging it to a lender that
                never agreed to finance it.
              </p>
            </section>
          )}

          {scan.draw !== undefined && (
            <p className="notice">
              <span className="notice-dot" aria-hidden />
              <span>
                A borrowing base is already recorded for this lender and round{' '}
                <span className="mono">{scan.draw.round}</span>: at least {pln(scan.draw.floor)}. The
                registry refuses a second draw for the same round, which is what holds a lender to one
                claim per round.
              </span>
            </p>
          )}

          {scan.pool.length >= scan.poolSize && (
            <>
              <section className="card">
                <h2>Prove a borrowing base</h2>
                <p className="role">
                  {scan.poolSize} receivables pledged to {chosen?.label} · round{' '}
                  <span className="mono">{scan.round.label}</span>
                </p>
                <p>
                  A factor that finances receivables is itself financed, and its funding bank wants to
                  know the book behind a drawdown is real and large enough. Showing it means handing
                  over the client list, the invoices and the amounts — the same disclosure problem this
                  registry exists to avoid, one level up. So the lender proves instead: {scan.poolSize}{' '}
                  receivables pledged to me, each one on this ledger, together worth at least this much.
                </p>
                <div className="field">
                  <label htmlFor="floor">Floor in zloty</label>
                  <input
                    id="floor"
                    className="mono"
                    inputMode="decimal"
                    value={floorText}
                    onChange={(e) => setFloorText(e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <p role="status" aria-live="polite" className={floor === null ? 'error' : 'muted small'}>
                  {floor === null
                    ? 'A floor is an amount in zloty, with at most two decimal places.'
                    : floor <= poolTotal
                      ? `These ${scan.poolSize} are worth ${pln(poolTotal)} in total, which this floor clears. That total is visible here because you hold the openings; it is in no transaction.`
                      : `These ${scan.poolSize} are worth ${pln(poolTotal)} in total, so this floor will be refused while the proof is built — no transaction, nothing on chain.`}
                </p>
                <section className="actions">
                  <button
                    onClick={() => void onDraw()}
                    aria-busy={drawing}
                    aria-disabled={drawing || floor === null ? true : undefined}
                  >
                    {drawing ? 'Proving and submitting…' : 'Prove a borrowing base'}
                  </button>
                </section>
                <p className="muted small">
                  The pool is fixed at {scan.poolSize} because a depth-16 note path plus a commitment
                  recompute costs about 4.8 MB of prover key per receivable. A larger book accumulates
                  instead: one draw per round over a rolling {scan.poolSize}.
                </p>
              </section>

              <section className="columns two">
                <article className="card column">
                  <h2>What reaches the chain</h2>
                  <dl className="facts stacked">
                    <div>
                      <dt>Round</dt>
                      <dd className="mono">{scan.round.label}</dd>
                    </div>
                    <div>
                      <dt>Floor</dt>
                      <dd>{floor === null ? '—' : pln(floor)}</dd>
                    </div>
                    <div>
                      <dt>Draw id</dt>
                      <dd className="mono">{scan.round.drawId}</dd>
                    </div>
                  </dl>
                  <p className="muted small">
                    The round is this UTC day and deliberately nothing more. A draw record publishes
                    its round in the clear, so a round that named the lender would publish exactly what
                    the draw id exists to hide. Every lender drawing today uses this same value; their
                    draw ids differ because the id is keyed on the lender's own secret.
                  </p>
                </article>
                <article className="card column">
                  <h2>What never leaves this browser</h2>
                  {/* A definition list rather than the yes/no pills the preflight uses: those read as
                      checks that passed or failed, and these are things deliberately withheld. */}
                  <dl className="facts stacked">
                    <div>
                      <dt>Amounts</dt>
                      <dd>
                        The {scan.poolSize} add up to {pln(poolTotal)}. The proof states only that the
                        sum is at least the floor.
                      </dd>
                    </div>
                    <div>
                      <dt>Which receivables</dt>
                      <dd>
                        Each note commitment is proven against a Merkle root everyone already knows,
                        and never named in the transaction.
                      </dd>
                    </div>
                    <div>
                      <dt>Which lender</dt>
                      <dd>
                        The draw id is a hash of the round and this lender's secret, so it is
                        unlinkable to the lender and to the {scan.poolSize} notes counted.
                      </dd>
                    </div>
                  </dl>
                  <p className="muted small">
                    Authorisation is structural rather than checked: the circuit recomputes each note
                    commitment from the prover's own secret, so only the lender of record for all{' '}
                    {scan.poolSize} can produce the proof at all.
                  </p>
                </article>
              </section>
            </>
          )}

          {scan.opened.length > 0 && scan.pool.length < scan.poolSize && (
            <p className="muted small">
              The circuit asks for {scan.poolSize} distinct notes pledged to this lender whose openings
              bind. This page also leaves out declined and released ones, because a pledge that was
              never financed or has already been paid does not belong in a borrowing base — that
              exclusion is this page's filter, not a rule the circuit enforces. On that basis this
              lender has {scan.pool.length}.
            </p>
          )}
        </>
      )}

      {draw !== null && (
        <section className="card">
          <h2>Borrowing base proven on Midnight Preprod</h2>
          <p className="role">The chain now records that this round cleared {pln(draw.floor)}</p>
          <dl className="facts stacked">
            <div>
              <dt>Transaction</dt>
              <dd className="mono">
                <a href={`${EXPLORER}/${draw.txHash}`} rel="noreferrer noopener" target="_blank">
                  {short(draw.txHash)}
                </a>
              </dd>
            </div>
            <div>
              <dt>Block</dt>
              <dd className="mono">{draw.blockHeight}</dd>
            </div>
            <div>
              <dt>Draw id</dt>
              <dd className="mono">{draw.drawId}</dd>
            </div>
          </dl>
        </section>
      )}

      {sent.length > 0 && (
        <section className="card">
          <h2>Sent from this tab</h2>
          <ol className="log" aria-live="polite">
            {sent.map((s) => (
              <li key={s.txHash}>
                <span className="badge">tx</span>
                <span>
                  {s.label}
                  <span className="muted small"> · block {s.blockHeight}</span>
                </span>
                <a className="mono" href={`${EXPLORER}/${s.txHash}`} rel="noreferrer noopener" target="_blank">
                  {short(s.txHash)}
                </a>
              </li>
            ))}
          </ol>
          <p className="muted small">
            On chain these are plain accept, decline, release and draw calls, and none of them says
            which lender made it. An accept and a release each publish one nullifier and nothing that
            says which receivable they concern; a draw publishes a round, a floor and an unlinkable
            draw id. A decline is the exception, and deliberately so: it publishes the tag as well,
            because a refused receivable has to visibly become pledgeable again, so a decline does say
            which receivable it freed. That tag was already public from the pledge.
          </p>
        </section>
      )}
    </>
  );
}
