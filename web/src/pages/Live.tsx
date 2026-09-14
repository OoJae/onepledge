// SPDX-License-Identifier: Apache-2.0
// Reads the deployed registry straight from the public Midnight indexer. No wallet, no backend.

import { useEffect, useState } from 'react';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Registry } from '@onepledge/contract';
import { hex, short } from '../engine.ts';

type Deployment = {
  network: string;
  contractAddress: string;
  deployTxId: string;
  deployTxHash?: string;
  deployBlockHeight: number;
  deployedAt: string;
  windowStart: number;
  windowEnd: number;
  events: { label: string; circuit: string; txId?: string; txHash?: string; blockHeight?: number; outcome: string; at: string }[];
};

const deployments = Object.values(
  import.meta.glob<{ default: Deployment }>('../../../deployments/preprod.json', { eager: true }),
).map((m) => m.default);

const INDEXER = 'https://indexer.preprod.midnight.network/api/v4/graphql';
const INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
const EXPLORER = 'https://preprod.midnightexplorer.com';

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
  readAt: string;
};

export function Live() {
  const deployment = deployments[0];
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = async () => {
    if (!deployment) return;
    setError(null);
    try {
      setNetworkId('preprod');
      const provider = indexerPublicDataProvider(INDEXER, INDEXER_WS);
      const state = await provider.queryContractState(deployment.contractAddress);
      if (!state) throw new Error('The indexer has no state for this address');
      const l = Registry.ledger(state.data);
      setSnapshot({
        pledgeCount: l.pledgeCount,
        releaseCount: l.releaseCount,
        tags: [...l.tags].map(hex),
        lenders: l.lenders.firstFree(),
        notes: l.notes.firstFree(),
        windowStart: l.windowStart,
        windowEnd: l.windowEnd,
        authority: l.tagAuthority,
        readAt: new Date().toISOString(),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void read();
  }, []);

  if (!deployment) {
    return (
      <section className="hero">
        <p className="eyebrow">Live registry</p>
        <h1>Not deployed yet.</h1>
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
        <p className="eyebrow">Live on Midnight Preprod · read from the public indexer in your browser</p>
        <h1>What the chain actually holds.</h1>
        <p className="lede">
          No wallet and no OnePledge server. Your browser asks the public indexer for the contract state and decodes
          it with the contract's own compiled ledger reader.
        </p>
      </section>

      <section className="card">
        <dl className="facts">
          <div><dt>Contract</dt><dd className="mono"><a href={`${EXPLORER}/contracts/${deployment.contractAddress}`} target="_blank" rel="noreferrer">{short(deployment.contractAddress)}</a></dd></div>
          <div><dt>Deployed</dt><dd>block {deployment.deployBlockHeight}</dd></div>
          <div><dt>Accepts invoices</dt><dd>{isoDay(deployment.windowStart)} to {isoDay(deployment.windowEnd)}</dd></div>
        </dl>
        <button className="ghost" onClick={() => void read()}>Read again</button>
        {error && <p className="error">Could not read the indexer: {error}</p>}
      </section>

      {snapshot && (
        <section className="columns">
          <article className="card column">
            <h2>Counters</h2>
            <dl className="facts stacked">
              <div><dt>Pledges</dt><dd>{snapshot.pledgeCount.toString()}</dd></div>
              <div><dt>Releases</dt><dd>{snapshot.releaseCount.toString()}</dd></div>
              <div><dt>Admitted lenders</dt><dd>{snapshot.lenders.toString()}</dd></div>
              <div><dt>Pledge notes</dt><dd>{snapshot.notes.toString()}</dd></div>
            </dl>
            <p className="muted small">Read at {snapshot.readAt}</p>
          </article>
          <article className="card column">
            <h2>Tags (every receivable ever pledged)</h2>
            <ul className="mono tags">{snapshot.tags.map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="muted small">Opaque keyed hashes. No invoice number, amount, borrower or lender appears anywhere in state.</p>
          </article>
          <article className="card column">
            <h2>Trust anchors</h2>
            <dl className="facts stacked">
              <div><dt>Tag authority key</dt><dd className="mono">{short(snapshot.authority.x.toString(16))}</dd></div>
              <div><dt>Window (from state)</dt><dd>{isoDay(snapshot.windowStart)} to {isoDay(snapshot.windowEnd)}</dd></div>
            </dl>
          </article>
        </section>
      )}

      <section className="card">
        <h2>Recorded transactions</h2>
        <ol className="log">
          <li className="ok">
            <span className="badge">deploy</span>
            <span>Registry deployed</span>
            <a className="mono" href={`${EXPLORER}/transactions/${deployment.deployTxHash ?? ''}`} target="_blank" rel="noreferrer">{short(deployment.deployTxHash ?? deployment.deployTxId)} · block {deployment.deployBlockHeight}</a>
          </li>
          {deployment.events.map((e, i) => (
            <li key={i} className={e.txId ? 'ok' : 'rejected'}>
              <span className="badge">{e.txId ? e.circuit : 'rejected'}</span>
              <span>{e.label}</span>
              {e.txId ? (
                <a className="mono" href={`${EXPLORER}/transactions/${e.txHash ?? ''}`} target="_blank" rel="noreferrer">{short(e.txHash ?? e.txId)} · block {e.blockHeight}</a>
              ) : (
                <span className="mono muted">{e.outcome}</span>
              )}
            </li>
          ))}
        </ol>
        <p className="muted small">
          A rejected double pledge never reaches the chain: the circuit's assertion fails on the borrower's machine,
          so no valid proof, and no transaction, can be produced.
        </p>
      </section>
    </>
  );
}
