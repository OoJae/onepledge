// SPDX-License-Identifier: Apache-2.0
// Privacy-leak tests. They serialize everything an outside observer can see (the public ledger
// state and the circuit's public transcript) and assert that no private value appears in it,
// in any of several encodings.

import { describe, expect, it } from 'vitest';
import { pureCircuits } from '../managed/registry/contract/index.js';
import {
  attestInvoice,
  invoiceNumber,
  lenderReleaseState,
  newWorld,
  pledgeAs,
  type AttestedInvoice,
  type World,
} from './fixtures.js';

const toJson = (value: unknown) =>
  JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return `${v.toString()}|${v.toString(16)}`;
    if (v instanceof Uint8Array) return Buffer.from(v).toString('hex');
    return v;
  });

/** Everything public after the last circuit call: the transcript and the full contract state. */
const observerView = (w: World): string => {
  const proof = w.sim.lastResult!.proofData;
  // ChargedState.toString renders every cell, map key and Merkle leaf hash in hex.
  const state = w.sim.context.currentQueryContext.state.toString(false);
  return [toJson(proof.publicTranscript), state].join('\n');
};

/** Encodings a private value could leak in: raw hex, reversed hex (little-endian), decimal and ASCII. */
const encodings = (value: Uint8Array | string | bigint): string[] => {
  if (typeof value === 'bigint') return [value.toString(), value.toString(16)];
  if (typeof value === 'string') return [value, Buffer.from(value, 'ascii').toString('hex')];
  const h = Buffer.from(value).toString('hex');
  return [h, Buffer.from(value).reverse().toString('hex')];
};

const expectAbsent = (view: string, label: string, value: Uint8Array | string | bigint) => {
  for (const enc of encodings(value)) {
    expect(view.includes(enc.toLowerCase()) || view.includes(enc), `${label} leaked as ${enc}`).toBe(false);
  }
};

const pledgeOne = (): { w: World; inv: AttestedInvoice; note: Uint8Array; noteSalt: Uint8Array } => {
  const w = newWorld();
  const inv = attestInvoice(w.authority, w.borrower, invoiceNumber(), '48213377');
  const { note, noteSalt } = pledgeAs(w, inv, w.lenderA);
  return { w, inv, note, noteSalt };
};

describe('what an observer learns from a pledge', () => {
  it('does not see the borrower secret or borrower key', () => {
    const { w } = pledgeOne();
    const view = observerView(w);
    expectAbsent(view, 'borrower secret', w.borrower);
    expectAbsent(view, 'borrower key', pureCircuits.borrowerKey(w.borrower));
  });

  it('does not see which lender financed the invoice', () => {
    const { w } = pledgeOne();
    const proof = toJson(w.sim.lastResult!.proofData.publicTranscript);
    expectAbsent(proof, 'lender key in transcript', pureCircuits.lenderKey(w.lenderA));
    expectAbsent(observerView(w), 'lender secret', w.lenderA);
  });

  it('does not see the invoice number, amount, debtor or commitment', () => {
    const { w, inv } = pledgeOne();
    const view = observerView(w);
    expectAbsent(view, 'KSeF number', inv.fields.ksefNumber);
    expectAbsent(view, 'amount', inv.fields.amountGrosz);
    expectAbsent(view, 'debtor NIP', inv.fields.debtorNip);
    expectAbsent(view, 'invoice commitment', inv.attestation.invoiceCommit);
    expectAbsent(view, 'invoice salt', inv.salt);
  });

  it('does not see the note salt or the signature', () => {
    const { w, inv, noteSalt } = pledgeOne();
    const view = observerView(w);
    expectAbsent(view, 'note salt', noteSalt);
    expectAbsent(view, 'signature response', inv.attestation.signature.response);
    expectAbsent(view, 'announcement x', inv.attestation.signature.announcement.x);
  });

  it('sees the tag and the note commitment, as designed', () => {
    const { w, inv, note } = pledgeOne();
    const view = observerView(w);
    expect(view.includes(Buffer.from(inv.attestation.tag).toString('hex'))).toBe(true);
    expect(w.sim.ledger().notes.findPathForLeaf(note)).toBeDefined();
  });

  it('cannot link two pledges by the same borrower to the same lender', () => {
    const w = newWorld();
    const a = pledgeAs(w, attestInvoice(w.authority, w.borrower, invoiceNumber()), w.lenderA);
    const viewA = toJson(w.sim.lastResult!.proofData.publicTranscript);
    const b = pledgeAs(w, attestInvoice(w.authority, w.borrower, invoiceNumber()), w.lenderA);
    const viewB = toJson(w.sim.lastResult!.proofData.publicTranscript);
    expect(Buffer.from(a.note).toString('hex')).not.toBe(Buffer.from(b.note).toString('hex'));
    expectAbsent(viewB, 'first note in second pledge', a.note);
    expectAbsent(viewA, 'second note in first pledge', b.note);
  });
});

describe('what an observer learns from a release', () => {
  it('does not see which note, tag or lender was released', () => {
    const { w, inv, note, noteSalt } = pledgeOne();
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.release();
    const proof = toJson(w.sim.lastResult!.proofData.publicTranscript);
    expectAbsent(proof, 'released note', note);
    expectAbsent(proof, 'released tag', inv.attestation.tag);
    expectAbsent(proof, 'lender key', pureCircuits.lenderKey(w.lenderA));
    expectAbsent(proof, 'lender secret', w.lenderA);
  });
});
