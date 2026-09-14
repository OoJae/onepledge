// SPDX-License-Identifier: Apache-2.0
// Reads the deployed registry straight from the public Midnight indexer. No wallet, no backend.

import { useCallback, useEffect, useRef, useState } from 'react';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Registry } from '@onepledge/contract';
import { hex, short } from '../engine.ts';

type Deployment = {
  network: string;
  version?: string;
  contractAddress: string;
  deployTxId: string;
  deployTxHash?: string;
  deployBlockHeight: number;
  deployedAt: string;
  tagAuthority: { x: string; y: string };
  windowStart: number;
  windowEnd: number;
  maintenanceAuthority?: { committeeSize: number; threshold: number; note: string };
  events: {
    label: string;
    circuit: string;
    txId?: string;
    txHash?: string;
    blockHeight?: number;
    outcome: string;
    at: string;
    proveSeconds?: number;
    totalSeconds?: number;
  }[];
};

const deployments = Object.values(
  import.meta.glob<{ default: Deployment }>('../../../deployments/preprod.json', { eager: true }),
).map((m) => m.default);

const INDEXER = 'https://indexer.preprod.midnight.network/api/v4/graphql';
const INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
const EXPLORER = 'https://preprod.midnightexplorer.com';
const TIMEOUT_MS = 15_000;

const isoDay = (d: number | bigint) => new Date(Number(d) * 86_400_000).toISOString().slice(0, 10);

type Snapshot = {
  pledgeCount: bigint;
  releaseCount: bigint;
  tags: string[];
  lenders: bigint;
  notes: bigint;
  windowStart: bigint;
  windowEnd: bigint;
  authority: { x: bigint; y: bigint };
  latestBlock?: number;
  readAt: string;
  mismatches: string[];
};

type Status = 'idle' | 'loading' | 'ok' | 'error';

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`no response within ${ms / 1000}s`)), ms))]);

const latestContractBlock = async (address: string): Promise<number | undefined> => {
  const res = await fetch(INDEXER, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: `{ contractAction(address: "${address}") { transaction { block { height } } } }` }),
  });
  const json = (await res.json()) as { data?: { contractAction?: { transaction?: { block?: { height?: number } } } } };
  return json.data?.contractAction?.transaction?.block?.height;
};

export function Live() {
  const deployment = deployments[0];
  const provider = useRef<ReturnType<typeof indexerPublicDataProvider> | null>(null);
  const requestId = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    if (!deployment) return;
    const id = ++requestId.current;
    setStatus('loading');
    setError(null);
    try {
      if (!provider.current) {
        setNetworkId('preprod');
        provider.current = indexerPublicDataProvider(INDEXER, INDEXER_WS);
      }
      const [state, latestBlock] = await withTimeout(
        Promise.all([provider.current.queryContractState(deployment.contractAddress), latestContractBlock(deployment.contractAddress).catch(() => undefined)]),
        TIMEOUT_MS,
      );
      if (id !== requestId.current) return;
      if (!state) throw new Error('the indexer has no state for this address');
      const l = Registry.ledger(state.data);
      const mismatches: string[] = [];
      if (l.tagAuthority.x.toString() !== deployment.tagAuthority.x || l.tagAuthority.y.toString() !== deployment.tagAuthority.y) {
        mismatches.push('tag authority key differs from the deployment record');
      }
      if (Number(l.windowStart) !== deployment.windowStart || Number(l.windowEnd) !== deployment.windowEnd) {
        mismatches.push('acceptance window differs from the deployment record');
      }
      setSnapshot({
        pledgeCount: l.pledgeCount,
        releaseCount: l.releaseCount,
        tags: [...l.tags].map(hex),
        lenders: l.lenders.firstFree(),
        notes: l.notes.firstFree(),
        windowStart: l.windowStart,
        windowEnd: l.windowEnd,
        authority: l.tagAuthority,
        latestBlock,
        readAt: new Date().toISOString(),
        mismatches,
      });
      setStatus('ok');
    } catch (e) {
      if (id !== requestId.current) return;
      setError((e as Error).message);
      setStatus('error');
    }
  }, [deployment]);

  useEffect(() => {
    void read();
  }, [read]);

  if (!deployment) {
    return (
      <section className="hero">
        <p className="eyebrow">Live registry</p>
        <h1 tabIndex={-1}>Not deployed yet.</h1>
        <p className="lede">
          Run <span className="mono">npm run deploy</span> and <span className="mono">npm run demo</span> in{' '}
          <span className="mono">cli/</span>. This page then reads the contract straight from the Preprod indexer.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Live on Midnight Preprod · registry {deployment.version ?? 'v1'} · read from the public indexer in your browser</p>
        <h1 tabIndex={-1}>What the chain actually holds.</h1>
        <p className="lede">
          No wallet and no OnePledge server. Your browser asks the public indexer for the contract state and decodes it
          with the contract's own compiled ledger reader. The values below are as reported by that indexer.
        </p>
      </section>

      <section className="card">
        <dl className="facts">
          <div><dt>Contract</dt><dd className="mono"><a href={`${EXPLORER}/contracts/${deployment.contractAddress}`} target="_blank" rel="noreferrer">{short(deployment.contractAddress)}</a></dd></div>
          <div>
            <dt>Deployed</dt>
            <dd>
              {deployment.deployTxHash ? (
                <a href={`${EXPLORER}/transactions/${deployment.deployTxHash}`} target="_blank" rel="noreferrer">block {deployment.deployBlockHeight}</a>
              ) : (
                <>block {deployment.deployBlockHeight}</>
              )}
            </dd>
          </div>
          <div><dt>Accepts invoices</dt><dd>{isoDay(deployment.windowStart)} to {isoDay(deployment.windowEnd)}</dd></div>
          {deployment.maintenanceAuthority && (
            <div>
              <dt>Upgrade key</dt>
              <dd>{deployment.maintenanceAuthority.threshold}-of-{deployment.maintenanceAuthority.committeeSize} deployer key</dd>
            </div>
          )}
        </dl>
        <div className="row">
          <button className="ghost" onClick={() => void read()} disabled={status === 'loading'} aria-busy={status === 'loading'}>
            {status === 'loading' ? 'Reading the indexer…' : 'Read again'}
          </button>
          <span className="muted small" role="status" aria-live="polite">
            {status === 'loading' && 'Contacting the Preprod indexer…'}
            {status === 'ok' && snapshot && `State read at ${snapshot.readAt.slice(11, 19)} UTC${snapshot.latestBlock ? `, latest contract action in block ${snapshot.latestBlock}` : ''}.`}
            {status === 'error' && `Could not read the indexer (${error}).${snapshot ? ' Showing the last successful read.' : ''}`}
          </span>
        </div>
        {snapshot && snapshot.mismatches.length > 0 && (
          <p className="error banner" role="alert">
            Warning: {snapshot.mismatches.join('; ')}. The indexer response does not match this repository's record.
          </p>
        )}
      </section>

      {snapshot && (
        <>
          <section className="columns">
            <article className="card column">
              <h2>Counters</h2>
              <dl className="facts stacked">
                <div><dt>Pledges</dt><dd>{snapshot.pledgeCount.toString()}</dd></div>
                <div><dt>Releases</dt><dd>{snapshot.releaseCount.toString()}</dd></div>
                <div><dt>Admitted lenders</dt><dd>{snapshot.lenders.toString()}</dd></div>
                <div><dt>Pledge notes</dt><dd>{snapshot.notes.toString()}</dd></div>
              </dl>
            </article>
            <article className="card column">
              <h2>Tags (every receivable ever pledged)</h2>
              <ul className="mono tags">{snapshot.tags.map((t) => <li key={t}>{t}</li>)}</ul>
              <p className="muted small">
                Opaque keyed hashes of KSeF numbers. No invoice number, amount or borrower appears in state; lenders
                appear only as admitted-lender key commitments, not linked to any pledge.
              </p>
            </article>
            <article className="card column">
              <h2>Trust anchors</h2>
              <dl className="facts stacked">
                <div><dt>Tag authority key</dt><dd className="mono">{short(snapshot.authority.x.toString(16))}</dd></div>
                <div><dt>Window (from state)</dt><dd>{isoDay(snapshot.windowStart)} to {isoDay(snapshot.windowEnd)}</dd></div>
              </dl>
            </article>
          </section>
          <TagCheck tags={snapshot.tags} />
        </>
      )}

      <section className="card">
        <h2>Recorded transactions</h2>
        <p className="muted small">
          Labels come from the operator's run log, not from the chain: on chain these are plain pledge and release calls
          that do not say which lender or invoice they concern.
        </p>
        <ol className="log" aria-live="polite">
          {deployment.events.map((e, i) => (
            <li key={i} className={e.txId ? 'ok' : 'rejected'}>
              <span className="badge">{e.txId ? e.circuit : 'rejected'}</span>
              <span>
                {e.label}
                {e.proveSeconds !== undefined && <span className="muted small"> · proved in {e.proveSeconds}s, finalized after {e.totalSeconds}s</span>}
              </span>
              {e.txHash ? (
                <a className="mono" href={`${EXPLORER}/transactions/${e.txHash}`} target="_blank" rel="noreferrer">{short(e.txHash)} · block {e.blockHeight}</a>
              ) : e.txId ? (
                <span className="mono muted">tx id {short(e.txId)} (no explorer hash recorded)</span>
              ) : (
                <span className="mono muted">{e.outcome}</span>
              )}
            </li>
          ))}
        </ol>
        <p className="muted small">
          A rejected double pledge never costs a transaction: an honest client's circuit assertion fails before proving.
          A proof built against stale state would be rejected when the chain replays it.
        </p>
      </section>
    </>
  );
}

function TagCheck({ tags }: { tags: string[] }) {
  const [value, setValue] = useState('');
  const normalized = value.trim().toLowerCase().replace(/^0x/, '');
  const valid = /^[0-9a-f]{64}$/.test(normalized);
  const found = valid && tags.includes(normalized);
  return (
    <section className="card">
      <h2>Check a tag before funding</h2>
      <p className="muted small">
        A borrower hands a prospective lender the attestation. Verify its signature with <span className="mono">verifyAttestation</span>
        {' '}from the attester package, then paste its tag here. The lookup runs in your browser against the state already
        downloaded, so nobody learns which tag you checked.
      </p>
      <label className="field">
        <span className="label">Tag (64 hex characters)</span>
        <input className="mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 4c7fe433…" spellCheck={false} />
      </label>
      <p role="status" aria-live="polite" className={valid ? (found ? 'error' : 'ok-text') : 'muted small'}>
        {!value && 'Paste a tag to check it.'}
        {value && !valid && 'A tag is 32 bytes, written as 64 hex characters.'}
        {valid && found && 'Encumbered: this receivable has already been pledged in this registry. Do not fund it.'}
        {valid && !found && 'Not pledged in this registry yet.'}
      </p>
    </section>
  );
}
