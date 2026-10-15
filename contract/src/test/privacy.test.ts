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
  lenderPoolState,
  lenderReleaseState,
  newWorld,
  pledgeAs,
  pledgePool,
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
      // The raw note commitment is now also a map key, because the delivery is stored under it so the
      // lender of record can find its own. It is a hiding commitment over tag, lender, invoice
      // commitment, amount and salt, and the Merkle leaf already committed to it, so this publishes
      // no fact that was not already public.
      note,
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

    // The amount is signed by the authority and bound into the note, but it is the borrower's
    // commercial information: a pledge must never publish what the receivable is worth.
    const amount = inv.attestation.amount;
    const leaksAmount = values.some((h) => asBig(h) === amount || asBig(reverseHex(h)) === amount);
    expect(leaksAmount, `invoice amount ${amount} published`).toBe(false);
  });

  it('positive control: the same search finds the expiry, which a pledge does publish', () => {
    // Without this, "the amount is absent" could pass simply because the search never matches
    // anything. The expiry is published by design (threat model, disclose ledger), so it must be found.
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber(), '987654321');
    pledgeAs(w, inv, w.lenderA);
    const values = transcriptValues(w.sim.lastResult!.proofData.publicTranscript);
    const expiry = inv.attestation.expiresAt;
    expect(
      values.some((h) => asBig(h) === expiry || asBig(reverseHex(h)) === expiry),
      'expiry not found: the amount checks below would be vacuous',
    ).toBe(true);
  });

  it('a pledge of a large invoice publishes nothing the amount could be read from', () => {
    // A distinctive amount that cannot collide with a day, a counter or a window bound.
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber(), '987654321');
    pledgeAs(w, inv, w.lenderA);
    const values = transcriptValues(w.sim.lastResult!.proofData.publicTranscript);
    expect(values.some((h) => asBig(h) === 987654321n || asBig(reverseHex(h)) === 987654321n)).toBe(false);
    expectAbsent(toJson(w.sim.lastResult!.proofData.publicTranscript), 'invoice amount', 987654321n);
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

  it('approveAdmit publishes the action, the committee root and one nullifier, and names no member', () => {
    const w = newWorld();
    const newLender = pureCircuits.lenderKey(new Uint8Array(32).fill(7));
    const encryptionKey = new Uint8Array(32).fill(5);
    const l = w.sim.ledger();
    const action = pureCircuits.admitAction(l.committeeEpoch, newLender, encryptionKey);
    const committeeRoot = l.registrars.root().field;

    w.sim.as({ secretKey: w.committee[1] });
    w.sim.approveAdmit(newLender, encryptionKey);
    const values = transcriptValues(w.sim.lastResult!.proofData.publicTranscript);
    const extra = unexpectedValues(values, [
      action,
      committeeRoot,
      pureCircuits.approvalNullifier(action, w.committee[1]),
      // The lender key is read as a map key by the already-admitted guard, so it is public here.
      newLender,
    ]);
    expect(extra, `approveAdmit: ${extra.join(', ')}`).toEqual([]);

    // Which of the three approved is the whole point of the Merkle-path design.
    const proof = toJson(w.sim.lastResult!.proofData.publicTranscript);
    for (const [i, sk] of w.committee.entries()) {
      expectAbsent(proof, `committee[${i}] secret`, sk);
      expectAbsent(proof, `committee[${i}] registrar key`, pureCircuits.registrarKey(sk));
      expectAbsent(proof, `committee[${i}] leaf`, pureCircuits.committeeLeaf(l.committeeEpoch, pureCircuits.registrarKey(sk)));
    }
  });

  it('executeAdmit publishes the action and the admitted lender, and nothing about the approvers', () => {
    const w = newWorld();
    const newLender = pureCircuits.lenderKey(new Uint8Array(32).fill(7));
    const encryptionKey = new Uint8Array(32).fill(5);
    const epoch = w.sim.ledger().committeeEpoch;
    const action = pureCircuits.admitAction(epoch, newLender, encryptionKey);
    for (const sk of w.committee.slice(0, 2)) {
      w.sim.as({ secretKey: sk });
      w.sim.approveAdmit(newLender, encryptionKey);
    }
    w.sim.executeAdmit(newLender, encryptionKey);
    const extra = unexpectedValues(transcriptValues(w.sim.lastResult!.proofData.publicTranscript), [
      action,
      newLender,
      encryptionKey,
      ...merkleLeaf(newLender),
    ]);
    expect(extra, `executeAdmit: ${extra.join(', ')}`).toEqual([]);
    const proof = toJson(w.sim.lastResult!.proofData.publicTranscript);
    for (const [i, sk] of w.committee.entries()) {
      expectAbsent(proof, `committee[${i}] secret`, sk);
      expectAbsent(proof, `committee[${i}] approval nullifier`, pureCircuits.approvalNullifier(action, sk));
    }
  });

  it('a rotation publishes the new committee but never says who approved it', () => {
    const w = newWorld();
    const next = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), new Uint8Array(32).fill(3)];
    const members = next.map((sk) => pureCircuits.registrarKey(sk));
    const epoch = w.sim.ledger().committeeEpoch;
    const action = pureCircuits.rotateAction(epoch, members[0], members[1], members[2]);
    const committeeRoot = w.sim.ledger().registrars.root().field;

    w.sim.as({ secretKey: w.committee[2] });
    w.sim.approveRotate(members);
    // An approval of a rotation is even quieter than an admission: only the action hash, the root
    // and the nullifier. The proposed members travel with the proposal, off chain, until execution.
    let extra = unexpectedValues(transcriptValues(w.sim.lastResult!.proofData.publicTranscript), [
      action,
      committeeRoot,
      pureCircuits.approvalNullifier(action, w.committee[2]),
    ]);
    expect(extra, `approveRotate: ${extra.join(', ')}`).toEqual([]);
    expectAbsent(toJson(w.sim.lastResult!.proofData.publicTranscript), 'approver secret', w.committee[2]);

    w.sim.as({ secretKey: w.committee[0] });
    w.sim.approveRotate(members);
    w.sim.executeRotate(members);
    extra = unexpectedValues(transcriptValues(w.sim.lastResult!.proofData.publicTranscript), [
      action,
      ...members,
      ...next.flatMap((sk) => {
        const leaf = pureCircuits.committeeLeaf(epoch + 1n, pureCircuits.registrarKey(sk));
        return [leaf, ...merkleLeaf(leaf)];
      }),
    ]);
    expect(extra, `executeRotate: ${extra.join(', ')}`).toEqual([]);
  });

  it('acceptPledge publishes only the decision nullifier and the notes root', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const { note, noteSalt } = pledgeAs(w, inv, w.lenderA);
    const notesRoot = w.sim.ledger().notes.root().field;
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.acceptPledge();
    const values = transcriptValues(w.sim.lastResult!.proofData.publicTranscript);
    // Accepting must not say which receivable was accepted: the tag stays out of the transcript.
    const extra = unexpectedValues(values, [pureCircuits.decisionNullifier(note, w.lenderA), notesRoot]);
    expect(extra, `unexpected public values: ${extra.join(', ')}`).toEqual([]);
  });

  it('declinePledge publishes the tag it frees, and nothing else beyond the nullifier and root', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const { note, noteSalt } = pledgeAs(w, inv, w.lenderA);
    const notesRoot = w.sim.ledger().notes.root().field;
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.declinePledge();
    const values = transcriptValues(w.sim.lastResult!.proofData.publicTranscript);
    // The tag is deliberate here and only here: the ledger has to stop claiming the receivable is
    // encumbered, and it was already public from the pledge.
    const extra = unexpectedValues(values, [
      pureCircuits.decisionNullifier(note, w.lenderA),
      notesRoot,
      inv.attestation.tag,
    ]);
    expect(extra, `unexpected public values: ${extra.join(', ')}`).toEqual([]);
  });

  it('proveBorrowingBase publishes the floor, the round and one draw id, and no amount', () => {
    const w = newWorld();
    // Distinctive amounts that cannot collide with a day, a counter, a window bound or the floor.
    const amounts = ['111111101', '222222202', '333333303', '444444404'];
    const total = amounts.reduce((sum, a) => sum + BigInt(a), 0n);
    const floor = 1_000_000_000n; // strictly below the total, so the two cannot be confused
    const pool = pledgePool(w, w.lenderA, amounts);
    const notesRoot = w.sim.ledger().notes.root().field;
    const round = new Uint8Array(32).fill(3);

    w.sim.as(lenderPoolState(w.lenderA, pool));
    w.sim.proveBorrowingBase(round, floor);

    const values = transcriptValues(w.sim.lastResult!.proofData.publicTranscript);
    const extra = unexpectedValues(values, [notesRoot, pureCircuits.drawId(round, w.lenderA), round, floor]);
    expect(extra, `unexpected public values: ${extra.join(', ')}`).toEqual([]);

    // The claim is "at least this much", so the floor is published and nothing else about the money is.
    const view = observerView(w);
    const found = (v: bigint) => values.some((h) => asBig(h) === v || asBig(reverseHex(h)) === v);
    expect(found(floor), 'the floor is the claim and must be public').toBe(true);
    expect(found(total), `the pool total ${total} is published`).toBe(false);
    for (const a of amounts) expectAbsent(view, `pool amount ${a}`, BigInt(a));

    // Nor which receivables are in the pool, nor whose book it is. The tag and the note commitment
    // are already public from each pledge, so for those the test is that this draw does not repeat
    // them — which is what would let an observer match a draw to the receivables behind it.
    const lenderKey = pureCircuits.lenderKey(w.lenderA);
    const proof = toJson(w.sim.lastResult!.proofData.publicTranscript);
    for (const [i, n] of pool.entries()) {
      expectAbsent(proof, `pool item ${i} tag`, n.tag);
      expectAbsent(
        proof,
        `pool item ${i} note commitment`,
        pureCircuits.noteCommitment(n.tag, lenderKey, n.invoiceCommit, n.amount, n.salt),
      );
      // These two are never published anywhere, so they are checked against the whole public view.
      expectAbsent(view, `pool item ${i} invoice commitment`, n.invoiceCommit);
      expectAbsent(view, `pool item ${i} salt`, n.salt);
    }
    // Admitted lenders are a public set, so the key is in the state by design; what must not happen
    // is this draw naming one of them.
    expectAbsent(proof, 'lender key', lenderKey);
    expectAbsent(view, 'lender secret', w.lenderA);
  });

  it('two draws by the same lender in different rounds are unlinkable', () => {
    const w = newWorld();
    const pool = pledgePool(w, w.lenderA, ['1000000', '2000000', '3000000', '4000000']);
    w.sim.as(lenderPoolState(w.lenderA, pool));
    w.sim.proveBorrowingBase(new Uint8Array(32).fill(1), 1n);
    const first = toJson(w.sim.lastResult!.proofData.publicTranscript);
    w.sim.proveBorrowingBase(new Uint8Array(32).fill(2), 1n);
    const second = toJson(w.sim.lastResult!.proofData.publicTranscript);
    const idA = pureCircuits.drawId(new Uint8Array(32).fill(1), w.lenderA);
    const idB = pureCircuits.drawId(new Uint8Array(32).fill(2), w.lenderA);
    expect(Buffer.from(idA).toString('hex')).not.toBe(Buffer.from(idB).toString('hex'));
    expectAbsent(second, 'first draw id', idA);
    expectAbsent(first, 'second draw id', idB);
  });

  it('a decision does not reveal the note, the lender or the invoice', () => {
    const { w, inv, note, noteSalt } = pledgeOne();
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.acceptPledge();
    const proof = toJson(w.sim.lastResult!.proofData.publicTranscript);
    expectAbsent(proof, 'accepted note', note);
    expectAbsent(proof, 'accepted tag', inv.attestation.tag);
    expectAbsent(proof, 'lender key', pureCircuits.lenderKey(w.lenderA));
    expectAbsent(proof, 'lender secret', w.lenderA);
    expectAbsent(proof, 'invoice commitment', inv.attestation.invoiceCommit);
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
