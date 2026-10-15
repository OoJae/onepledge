// SPDX-License-Identifier: Apache-2.0
// The desk: connects a Midnight wallet and reports exactly what a real pledge would still need.
//
// The walkthrough at /demo runs the same circuits with no wallet at all. This page is the other half:
// the provider stack a pledge on Preprod actually goes through. It is deliberately honest about the
// prerequisites rather than failing at the moment of signing.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EXPECTED_NETWORK,
  connect,
  describeError,
  waitForWallets,
  type Connection,
  type WalletChoice,
} from '../wallet/connector.ts';
import { DEFAULT_PROOF_SERVER, proofServerReachable, provingMode } from '../wallet/providers.ts';
import { loadBundle, sendPledge, type DemoBundle, type PledgeResult } from '../wallet/pledge.ts';

type Wallet = {
  shielded: string;
  unshielded: string;
  dust: { cap: bigint; balance: bigint };
  proving: 'wallet' | 'proof-server';
  proofServer: { uri: string; reachable: boolean } | null;
};

const short = (s: string) => (s.length > 24 ? `${s.slice(0, 12)}…${s.slice(-8)}` : s);
const dust = (n: bigint) => (Number(n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });

export default function Desk() {
  const [choices, setChoices] = useState<WalletChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [bundle, setBundle] = useState<DemoBundle | null>(null);
  const [choice, setChoice] = useState(0);
  const [lender, setLender] = useState(0);
  const [pledging, setPledging] = useState(false);
  const [result, setResult] = useState<PledgeResult | null>(null);
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
  // Without this the page would claim there is no wallet until a reload.
  const rescan = useCallback(async () => {
    setScanning(true);
    setChoices(await waitForWallets());
    setScanning(false);
  }, []);

  const onConnect = useCallback(async (choice: WalletChoice) => {
    setBusy(true);
    setError(null);
    try {
      // No await before connect(): the gesture has to reach the wallet intact.
      const conn = await connect(choice);
      connection.current = conn;
      const [shielded, unshielded, dustBalance, config] = await Promise.all([
        conn.api.getShieldedAddresses(),
        conn.api.getUnshieldedAddress(),
        conn.api.getDustBalance(),
        conn.api.getConfiguration(),
      ]);
      const mode = provingMode(conn.api);
      const uri = config.proverServerUri ?? DEFAULT_PROOF_SERVER;
      setWallet({
        shielded: shielded.shieldedAddress,
        unshielded: unshielded.unshieldedAddress,
        dust: dustBalance,
        proving: mode,
        proofServer: mode === 'proof-server' ? { uri, reachable: await proofServerReachable(uri) } : null,
      });
      setBundle(await loadBundle().catch(() => null));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const ready = wallet !== null && wallet.dust.balance > 0n && (wallet.proving === 'wallet' || wallet.proofServer?.reachable === true);

  const onPledge = useCallback(async () => {
    if (!connection.current || !bundle) return;
    setPledging(true);
    setError(null);
    try {
      setResult(await sendPledge(connection.current, bundle, bundle.attestations[choice], bundle.lenders[lender].key));
    } catch (e) {
      const message = describeError(e);
      setError(
        /already pledged/i.test(message)
          ? 'That receivable has already been pledged on this registry. Every attestation is single-use: pick another invoice.'
          : message,
      );
    } finally {
      setPledging(false);
    }
  }, [bundle, choice, lender]);

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Borrower desk · Midnight Preprod</p>
        <h1 tabIndex={-1}>Pledge from your own wallet.</h1>
        <p className="lede">
          The walkthrough proves the circuits in your browser against an in-memory ledger. This page wires the
          providers a real pledge goes through on Preprod: your wallet balances and signs, a prover builds the
          proof, and the registry refuses a second pledge of the same invoice.
        </p>
      </section>

      {choices === null && <p className="loading muted" role="status">Looking for a Midnight wallet…</p>}

      {choices !== null && choices.length === 0 && (
        <p className="notice">
          <span className="notice-dot" aria-hidden />
          <span>
            No Midnight wallet is injected on this page. Install{' '}
            <a href="https://www.lace.io/midnight" rel="noreferrer noopener" target="_blank">Lace</a> or{' '}
            <a href="https://1am.xyz/" rel="noreferrer noopener" target="_blank">1AM</a>, switch it to Preprod and
            reload. Nothing else on OnePledge needs a wallet: the{' '}
            <a href="/demo">walkthrough</a> and the <a href="/live">live registry</a> work without one.
          </span>
        </p>
      )}

      {choices !== null && choices.length === 0 && (
        <section className="actions">
          <button className="ghost" onClick={() => void rescan()} aria-busy={scanning} aria-disabled={scanning}>
            {scanning ? 'Looking…' : 'Look again'}
          </button>
        </section>
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
          A wallet was found but reports a connector API this page does not support. OnePledge targets connector 4.x.
        </p>
      )}

      {error !== null && (
        <p className="banner" role="alert">{error}</p>
      )}

      {wallet !== null && (
        <>
          <section className="columns two">
            <article className="card column">
              <h2>Connected</h2>
              <p className="role">Network {EXPECTED_NETWORK}</p>
              <dl className="facts stacked">
                <div><dt>Shielded</dt><dd className="mono">{short(wallet.shielded)}</dd></div>
                <div><dt>Unshielded</dt><dd className="mono">{short(wallet.unshielded)}</dd></div>
                <div><dt>DUST</dt><dd className="mono">{dust(wallet.dust.balance)}</dd></div>
              </dl>
            </article>

            <article className="card column">
              <h2>Before a pledge can be sent</h2>
              <p className="role">Everything below is checked live</p>
              <ul className="seen">
                <li>
                  <span className="yes">Network</span> your wallet is on {EXPECTED_NETWORK}, where registry v2 is deployed
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
                  <span className={wallet.dust.balance > 0n ? 'yes' : 'no'}>DUST</span>{' '}
                  {wallet.dust.balance > 0n
                    ? 'available to pay fees'
                    : 'none yet. Fund the wallet from the Preprod faucet, press Generate tDUST, then wait: a fresh wallet takes hours to accrue any'}
                </li>
              </ul>
            </article>
          </section>

          {!ready && (
            <p className="notice">
              <span className="notice-dot" aria-hidden />
              <span>
                Signing is held back until every check above passes, so a pledge fails here rather than
                halfway through a transaction.
              </span>
            </p>
          )}

          {ready && bundle !== null && result === null && (
            <section className="card">
              <h2>Pledge a receivable</h2>
              <p className="role">
                Registry {bundle.registryVersion} on Preprod · {bundle.attestations.length} attestations available
              </p>
              <div className="field">
                <label htmlFor="invoice">Invoice</label>
                <select id="invoice" value={choice} onChange={(e) => setChoice(Number(e.target.value))}>
                  {bundle.attestations.map((a, i) => (
                    <option key={a.fields.ksefNumber} value={i}>
                      {a.fields.ksefNumber} · {(Number(a.fields.amountGrosz) / 100).toLocaleString('pl-PL')} zł
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="lender">Pledge to</label>
                <select id="lender" value={lender} onChange={(e) => setLender(Number(e.target.value))}>
                  {bundle.lenders.map((l, i) => (
                    <option key={l.label} value={i}>{l.label}</option>
                  ))}
                </select>
              </div>
              <section className="actions">
                <button onClick={() => void onPledge()} aria-busy={pledging} aria-disabled={pledging}>
                  {pledging ? 'Proving and submitting…' : 'Pledge on Preprod'}
                </button>
              </section>
              <p className="muted small">
                The tag authority signed these offline, which is how a borrower receives one in the real
                flow. Each is single-use: pledging burns its tag and the registry refuses it afterwards.
                Synthetic KSeF numbers, testnet only.
              </p>
            </section>
          )}

          {result !== null && (
            <section className="card">
              <h2>Pledged on Midnight Preprod</h2>
              <p className="role">The registry will now refuse this receivable to every other lender</p>
              <dl className="facts stacked">
                <div>
                  <dt>Transaction</dt>
                  <dd className="mono">
                    <a
                      href={`https://preprod.midnightexplorer.com/transactions/${result.txHash}`}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      {result.txHash.slice(0, 16)}…
                    </a>
                  </dd>
                </div>
                <div><dt>Block</dt><dd className="mono">{result.blockHeight}</dd></div>
                <div><dt>Note commitment</dt><dd className="mono">{result.note.slice(0, 16)}…</dd></div>
              </dl>
              <section className="actions">
                <button className="ghost" onClick={() => setResult(null)}>Pledge another</button>
                <a className="button button-ghost" href="/live">See it on the live registry</a>
              </section>
            </section>
          )}
        </>
      )}
    </>
  );
}
