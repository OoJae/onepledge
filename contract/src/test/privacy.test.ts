// SPDX-License-Identifier: Apache-2.0
// Privacy-leak tests.
//  1. Allowlist: every value in each circuit's public transcript must be something the design
//     intends to publish (tag, note leaf hash, roots, nullifier, registry address, expiry, public
//     ledger reads) or a short constant. Any other value, in either byte order, fails. This catches
//     leaks of Field-typed, hashed or derived values that a search for known encodings would miss.
//  2. Denylist: known private values are searched for in the transcript and the full ledger state.

import { describe, expect, it } from 'vitest';
import { CompactTypeBytes, leafHash } from '@midnight-ntwrk/compact-runtime';
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

// ---------- allowlist machinery ----------

const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex');
const reverseHex = (h: string) => (h.match(/../g) ?? []).reverse().join('');
const asBig = (h: string) => BigInt(`0x${h || '0'}`);

/** Every byte string in a transcript, as hex. */
const transcriptValues = (transcript: unknown): string[] => {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (v instanceof Uint8Array) out.push(hexOf(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(transcript);
  return [...new Set(out)];
};

/** Values up to this many bytes are treated as constants (ledger indices, counters, booleans). */
const CONSTANT_BYTES = 2;

type Allowed = Uint8Array | bigint;
const allowedSet = (values: Allowed[]) => {
  const set = new Set<bigint>();
  for (const v of values) {
    if (typeof v === 'bigint') set.add(v);
    else {
      set.add(asBig(hexOf(v)));
      set.add(asBig(reverseHex(hexOf(v))));
    }
  }
  return set;
};

/** Values in the transcript that are neither short constants nor allowlisted (in either byte order). */
const unexpectedValues = (values: string[], allowed: Allowed[]): string[] => {
  const set = allowedSet(allowed);
  return values.filter((h) => h.length / 2 > CONSTANT_BYTES && !set.has(asBig(h)) && !set.has(asBig(reverseHex(h))));
};

const bytes32 = new CompactTypeBytes(32);
/** The hash a HistoricMerkleTree stores for a Bytes<32> leaf. */
const merkleLeaf = (leaf: Uint8Array): Uint8Array[] => {
  const hashed = leafHash({ value: bytes32.toValue(leaf), alignment: bytes32.alignment() } as never) as unknown as {
    value: Uint8Array[];
  };
  return hashed.value;
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

describe('allowlist: a transcript publishes only what the design intends', () => {
  it('pledge publishes only the tag, note leaf, lender root, registry, expiry and public ledger reads', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const before = w.sim.ledger();
    const { note } = pledgeAs(w, inv, w.lenderA);
    const values = transcriptValues(w.sim.lastResult!.proofData.publicTranscript);
    const extra = unexpectedValues(values, [
      inv.attestation.tag,
      ...merkleLeaf(note),
      before.lenders.root().field,
      w.sim.addressBytes(),
      inv.attestation.expiresAt,
      before.tagAuthority.x,
      before.tagAuthority.y,
      before.windowStart,
      before.windowEnd,
    ]);
    expect(extra, `unexpected public values: ${extra.join(', ')}`).toEqual([]);
    // Short private values would pass the size filter, so check the one that matters explicitly.
    const day = inv.attestation.acceptanceDay;
    const dayHex = day.toString(16).padStart(4, '0');
    const leaksDay = values.some((h) => (asBig(h) === day || asBig(reverseHex(h)) === day) && day !== before.windowStart && day !== before.windowEnd);
    expect(leaksDay, `acceptance day ${dayHex} published`).toBe(false);
  });

  it('release publishes only the nullifier and the notes root', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const { note, noteSalt } = pledgeAs(w, inv, w.lenderA);
    const notesRoot = w.sim.ledger().notes.root().field;
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.release();
    const values = transcriptValues(w.sim.lastResult!.proofData.publicTranscript);
    const extra = unexpectedValues(values, [pureCircuits.releaseNullifier(note, w.lenderA), notesRoot]);
    expect(extra, `unexpected public values: ${extra.join(', ')}`).toEqual([]);
  });

  it('admitLender and rotateRegistrar publish only the registrar key and the admitted or next key', () => {
    const w = newWorld();
    const newLender = pureCircuits.lenderKey(new Uint8Array(32).fill(7));
    const registrarKey = w.sim.ledger().registrar;
    w.sim.as({ secretKey: w.registrar });
    w.sim.admitLender(newLender);
    let extra = unexpectedValues(transcriptValues(w.sim.lastResult!.proofData.publicTranscript), [
      registrarKey,
      newLender,
      ...merkleLeaf(newLender),
    ]);
    expect(extra, `admitLender: ${extra.join(', ')}`).toEqual([]);

    const next = pureCircuits.registrarKey(new Uint8Array(32).fill(9));
    w.sim.rotateRegistrar(next);
    extra = unexpectedValues(transcriptValues(w.sim.lastResult!.proofData.publicTranscript), [registrarKey, next]);
    expect(extra, `rotateRegistrar: ${extra.join(', ')}`).toEqual([]);
    expectAbsent(toJson(w.sim.lastResult!.proofData.publicTranscript), 'registrar secret', w.registrar);
  });

  it('positive control: the allowlist flags an injected 32-byte private value in either byte order', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const borrowerKey = pureCircuits.borrowerKey(w.borrower);
    const allowed = [inv.attestation.tag];
    expect(unexpectedValues([hexOf(inv.attestation.tag), hexOf(borrowerKey)], allowed)).toEqual([hexOf(borrowerKey)]);
    const le = reverseHex(hexOf(borrowerKey));
    expect(unexpectedValues([le], allowed)).toEqual([le]);
  });

  it('positive control: the allowlist flags an injected Field in its trimmed little-endian form', () => {
    const secretField = inputField();
    const leTrimmed = reverseHex(secretField.toString(16).padStart(64, '0')).replace(/(00)+$/, '');
    expect(unexpectedValues([leTrimmed], [])).toEqual([leTrimmed]);
  });
});

function inputField(): bigint {
  return 0x1234567890abcdef1234567890abcdef1234567890abcdef123456789n;
}
