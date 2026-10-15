// SPDX-License-Identifier: Apache-2.0
// Registry behaviour: deployment, registrar, pledge, double-pledge rejection, forgery, window,
// lender membership and release. Every assert in registry.compact has at least one test that
// makes it fire.

import { describe, expect, it } from 'vitest';
import {
  dayFromIso,
  lenderEncryptionKey,
  openDelivery,
  publicKeyOf,
  randomScalar,
  sign,
} from '@onepledge/attester';
import { pureCircuits } from '../managed/registry/contract/index.js';
import { type Attestation } from '../witnesses.js';
import { RegistrySimulator } from '../simulator.js';
import {
  WINDOW_END,
  WINDOW_START,
  attestInvoice,
  borrowerState,
  invoiceNumber,
  lenderPoolState,
  lenderReleaseState,
  openingOf,
  newAuthority,
  newWorld,
  pledgeAs,
  pledgePool,
  secret,
  type AttestedInvoice,
  type World,
} from './fixtures.js';

const JUBJUB_ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const isoFromDay = (day: bigint) => new Date(Number(day) * 86_400_000).toISOString().slice(0, 10);

const withAttestation = (inv: AttestedInvoice, patch: Partial<Attestation>): AttestedInvoice => ({
  ...inv,
  attestation: { ...inv.attestation, ...patch },
});

const tryPledge = (w: World, inv: AttestedInvoice, lender = w.lenderA, borrower = w.borrower) => () =>
  pledgeAs(w, inv, lender, borrower);

describe('deployment', () => {
  it('stores the committee, tag authority and acceptance window', () => {
    const authority = newAuthority();
    const committee = [secret(), secret(), secret()];
    const sim = new RegistrySimulator(committee[0], publicKeyOf(authority.sk), WINDOW_START, WINDOW_END, {}, {
      committee,
    });
    const l = sim.ledger();
    expect(l.threshold).toBe(2n);
    expect(l.committeeEpoch).toBe(0n);
    expect(l.registrars.firstFree()).toBe(3n);
    for (const sk of committee) {
      const leaf = pureCircuits.committeeLeaf(0n, pureCircuits.registrarKey(sk));
      expect(l.registrars.findPathForLeaf(leaf), 'committee member is not in the tree').toBeDefined();
    }
    expect(l.tagAuthority).toEqual(publicKeyOf(authority.sk));
    expect(l.windowStart).toBe(WINDOW_START);
    expect(l.windowEnd).toBe(WINDOW_END);
    expect(l.pledgeCount).toBe(0n);
    expect(l.releaseCount).toBe(0n);
    expect(l.drawCount).toBe(0n);
    expect(l.tags.isEmpty()).toBe(true);
  });

  it('rejects an empty acceptance window', () => {
    const pk = publicKeyOf(newAuthority().sk);
    expect(() => new RegistrySimulator(secret(), pk, WINDOW_END, WINDOW_START)).toThrow(/Empty acceptance window/);
    expect(() => new RegistrySimulator(secret(), pk, WINDOW_START, WINDOW_START)).toThrow(/Empty acceptance window/);
  });

  it('rejects a committee with a repeated member', () => {
    const pk = publicKeyOf(newAuthority().sk);
    const a = secret();
    const b = secret();
    for (const committee of [[a, a, b], [a, b, b], [a, b, a]]) {
      expect(() => new RegistrySimulator(a, pk, WINDOW_START, WINDOW_END, {}, { committee })).toThrow(
        /Committee members must be distinct/,
      );
    }
  });

  it('stores epoch-bound leaves, never a secret or a bare registrar key', () => {
    const committee = [secret(), secret(), secret()];
    const sim = new RegistrySimulator(committee[0], publicKeyOf(newAuthority().sk), WINDOW_START, WINDOW_END, {}, {
      committee,
    });
    const tree = sim.ledger().registrars;
    for (const sk of committee) {
      const key = pureCircuits.registrarKey(sk);
      expect(tree.findPathForLeaf(sk), 'a secret is a leaf').toBeUndefined();
      expect(tree.findPathForLeaf(key), 'a bare registrar key is a leaf').toBeUndefined();
      expect(tree.findPathForLeaf(pureCircuits.committeeLeaf(0n, key))).toBeDefined();
      // And not under any other epoch, which is what retires a rotated-out member.
      expect(tree.findPathForLeaf(pureCircuits.committeeLeaf(1n, key))).toBeUndefined();
    }
  });
});

describe('registrar committee', () => {
  it('admits lenders into the registry tree once two members approve', () => {
    const w = newWorld();
    expect(w.sim.ledger().lenders.findPathForLeaf(pureCircuits.lenderKey(w.lenderA))).toBeDefined();
    expect(w.sim.ledger().lenders.findPathForLeaf(pureCircuits.lenderKey(w.lenderB))).toBeDefined();
    expect(w.sim.ledger().lenders.firstFree()).toBe(2n);
    // Both admissions are spent, and nothing is left pending.
    expect(w.sim.ledger().executed.size()).toBe(2n);
    expect(w.sim.ledger().proposals.isEmpty()).toBe(true);
  });

  it('refuses an admission with only one approval', () => {
    const w = newWorld();
    const lender = pureCircuits.lenderKey(secret());
    w.sim.as({ secretKey: w.committee[0] });
    w.sim.approveAdmit(lender);
    expect(() => w.sim.executeAdmit(lender)).toThrow(/Below the registrar threshold/);
    expect(w.sim.ledger().lenders.firstFree()).toBe(2n);
  });

  it('refuses an admission with no approvals at all', () => {
    const w = newWorld();
    expect(() => w.sim.executeAdmit(pureCircuits.lenderKey(secret()))).toThrow(
      /No approvals recorded for this action/,
    );
  });

  it('counts two different members, not one member twice', () => {
    const w = newWorld();
    const lender = pureCircuits.lenderKey(secret());
    w.sim.as({ secretKey: w.committee[1] });
    w.sim.approveAdmit(lender);
    expect(() => w.sim.approveAdmit(lender)).toThrow(/Already approved by this committee member/);
    w.sim.as({ secretKey: w.committee[2] });
    w.sim.approveAdmit(lender);
    w.sim.executeAdmit(lender);
    expect(w.sim.ledger().lenders.findPathForLeaf(lender)).toBeDefined();
  });

  it('refuses an approval from outside the committee', () => {
    const w = newWorld();
    w.sim.as({ secretKey: w.borrower });
    expect(() => w.sim.approveAdmit(pureCircuits.lenderKey(secret()))).toThrow(
      /Not a member of the current registrar committee/,
    );
  });

  it('refuses to replay one set of approvals on a second admission', () => {
    const w = newWorld();
    const lender = pureCircuits.lenderKey(secret());
    w.sim.admitLender(lender);
    expect(() => w.sim.executeAdmit(lender)).toThrow(/Lender already admitted/);
    expect(w.sim.ledger().lenders.firstFree()).toBe(3n);
  });

  it('refuses to approve a lender that is already admitted', () => {
    const w = newWorld();
    w.sim.as({ secretKey: w.committee[0] });
    expect(() => w.sim.approveAdmit(pureCircuits.lenderKey(w.lenderA))).toThrow(/Lender already admitted/);
  });

  it('binds the encryption key into the approval, so a swapped key has no quorum', () => {
    const w = newWorld();
    const lender = pureCircuits.lenderKey(secret());
    const real = new Uint8Array(32).fill(7);
    const swapped = new Uint8Array(32).fill(8);
    for (const sk of w.committee.slice(0, 2)) {
      w.sim.as({ secretKey: sk });
      w.sim.approveAdmit(lender, real);
    }
    expect(() => w.sim.executeAdmit(lender, swapped)).toThrow(/No approvals recorded for this action/);
    w.sim.executeAdmit(lender, real);
    expect(hex(w.sim.ledger().lenderEncryptionKeys.lookup(lender))).toBe(hex(real));
  });

  it('rotates the whole committee on two approvals, and retires the old one', () => {
    const w = newWorld();
    const next = [secret(), secret(), secret()];
    w.sim.rotateCommittee(next);
    expect(w.sim.ledger().committeeEpoch).toBe(1n);
    expect(w.sim.ledger().registrars.firstFree()).toBe(6n);

    // A retired member cannot even build a membership path for the new epoch.
    w.sim.as({ secretKey: w.committee[0] });
    expect(() => w.sim.approveAdmit(pureCircuits.lenderKey(secret()))).toThrow(
      /Not a member of the current registrar committee/,
    );

    const lender = pureCircuits.lenderKey(secret());
    for (const sk of next.slice(0, 2)) {
      w.sim.as({ secretKey: sk });
      w.sim.approveAdmit(lender);
    }
    w.sim.executeAdmit(lender);
    expect(w.sim.ledger().lenders.findPathForLeaf(lender)).toBeDefined();
  });

  it('refuses a rotation with only one approval', () => {
    const w = newWorld();
    const members = [secret(), secret(), secret()].map((sk) => pureCircuits.registrarKey(sk));
    w.sim.as({ secretKey: w.committee[0] });
    w.sim.approveRotate(members);
    expect(() => w.sim.executeRotate(members)).toThrow(/Below the registrar threshold/);
    expect(w.sim.ledger().committeeEpoch).toBe(0n);
  });

  it('refuses to rotate to a committee with a repeated member', () => {
    const w = newWorld();
    const [a, b] = [secret(), secret()].map((sk) => pureCircuits.registrarKey(sk));
    const members = [a, b, a];
    for (const sk of w.committee.slice(0, 2)) {
      w.sim.as({ secretKey: sk });
      w.sim.approveRotate(members);
    }
    expect(() => w.sim.executeRotate(members)).toThrow(/Committee members must be distinct/);
  });

  it('voids pending proposals when the committee rotates', () => {
    const w = newWorld();
    const lender = pureCircuits.lenderKey(secret());
    // One approval gathered under epoch 0.
    w.sim.as({ secretKey: w.committee[0] });
    w.sim.approveAdmit(lender);

    const next = [w.committee[0], secret(), secret()];
    w.sim.rotateCommittee(next);

    // The surviving member's epoch-0 approval does not carry over: the action is epoch-bound, so a
    // single approval under epoch 1 is still one short.
    w.sim.as({ secretKey: next[1] });
    w.sim.approveAdmit(lender);
    expect(() => w.sim.executeAdmit(lender)).toThrow(/Below the registrar threshold/);
    w.sim.as({ secretKey: next[0] });
    w.sim.approveAdmit(lender);
    w.sim.executeAdmit(lender);
    expect(w.sim.ledger().lenders.findPathForLeaf(lender)).toBeDefined();
  });

  it('refuses to replay a rotation', () => {
    const w = newWorld();
    const next = [secret(), secret(), secret()];
    w.sim.rotateCommittee(next);
    const members = next.map((sk) => pureCircuits.registrarKey(sk));
    expect(() => w.sim.executeRotate(members)).toThrow(/No approvals recorded for this action/);
  });
});

describe('pledge', () => {
  it('records the tag, a note and the count', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const { note, noteSalt } = pledgeAs(w, inv, w.lenderA);
    const l = w.sim.ledger();
    expect(l.pledgeCount).toBe(1n);
    expect(l.tags.member(inv.attestation.tag)).toBe(true);
    expect(l.notes.findPathForLeaf(note)).toBeDefined();
    expect(hex(note)).toBe(
      hex(
        pureCircuits.noteCommitment(
          inv.attestation.tag,
          pureCircuits.lenderKey(w.lenderA),
          inv.attestation.invoiceCommit,
          inv.attestation.amount,
          noteSalt,
        ),
      ),
    );
  });

  it('accepts distinct invoices from the same borrower', () => {
    const w = newWorld();
    for (let i = 0; i < 5; i++) pledgeAs(w, attestInvoice(w.authority, w.borrower, invoiceNumber()), w.lenderA);
    expect(w.sim.ledger().pledgeCount).toBe(5n);
    expect(w.sim.ledger().tags.size()).toBe(5n);
  });

  it('accepts pledges to different lenders', () => {
    const w = newWorld();
    pledgeAs(w, attestInvoice(w.authority, w.borrower, invoiceNumber()), w.lenderA);
    pledgeAs(w, attestInvoice(w.authority, w.borrower, invoiceNumber()), w.lenderB);
    expect(w.sim.ledger().pledgeCount).toBe(2n);
  });
});

describe('double pledge (the core guarantee)', () => {
  it('rejects the same attestation twice', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    pledgeAs(w, inv, w.lenderA);
    expect(tryPledge(w, inv, w.lenderA)).toThrow(/Receivable already pledged/);
  });

  it('rejects the same invoice at a second lender', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    pledgeAs(w, inv, w.lenderA);
    expect(tryPledge(w, inv, w.lenderB)).toThrow(/Receivable already pledged/);
  });

  it('rejects a fresh re-attestation of the same invoice (new salt, new signature)', () => {
    const w = newWorld();
    const n = invoiceNumber();
    pledgeAs(w, attestInvoice(w.authority, w.borrower, n), w.lenderA);
    const again = attestInvoice(w.authority, w.borrower, n, '99900000');
    expect(tryPledge(w, again, w.lenderB)).toThrow(/Receivable already pledged/);
  });

  it('rejects the same invoice from a brand-new borrower wallet', () => {
    const w = newWorld();
    const n = invoiceNumber();
    pledgeAs(w, attestInvoice(w.authority, w.borrower, n), w.lenderA);
    const newWallet = secret();
    expect(tryPledge(w, attestInvoice(w.authority, newWallet, n), w.lenderB, newWallet)).toThrow(
      /Receivable already pledged/,
    );
  });

  it('keeps the invoice encumbered after the pledge is released', () => {
    const w = newWorld();
    const n = invoiceNumber();
    const inv = attestInvoice(w.authority, w.borrower, n);
    const { noteSalt } = pledgeAs(w, inv, w.lenderA);
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.release();
    expect(tryPledge(w, attestInvoice(w.authority, w.borrower, n), w.lenderB)).toThrow(/Receivable already pledged/);
  });

  it('does not change state when a duplicate is rejected', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    pledgeAs(w, inv, w.lenderA);
    const before = w.sim.ledger();
    expect(tryPledge(w, inv, w.lenderB)).toThrow();
    const after = w.sim.ledger();
    expect(after.pledgeCount).toBe(before.pledgeCount);
    expect(after.notes.firstFree()).toBe(before.notes.firstFree());
  });
});

describe('attestation forgery', () => {
  const pledged = () => {
    const w = newWorld();
    return { w, inv: attestInvoice(w.authority, w.borrower, invoiceNumber()) };
  };

  it('rejects a swapped tag (dodging the duplicate check)', () => {
    const { w, inv } = pledged();
    expect(tryPledge(w, withAttestation(inv, { tag: secret() }))).toThrow(/Invalid attestation signature/);
  });

  it('rejects a swapped invoice commitment', () => {
    const { w, inv } = pledged();
    expect(tryPledge(w, withAttestation(inv, { invoiceCommit: secret() }))).toThrow(/Invalid attestation signature/);
  });

  it('rejects a shifted acceptance day', () => {
    const { w, inv } = pledged();
    const day = inv.attestation.acceptanceDay + 1n;
    expect(tryPledge(w, withAttestation(inv, { acceptanceDay: day }))).toThrow(/Invalid attestation signature/);
  });

  it('rejects a signature from any key other than the tag authority', () => {
    const { w } = pledged();
    const impostor = { sk: randomScalar(), tagSecret: w.authority.tagSecret };
    expect(tryPledge(w, attestInvoice(impostor, w.borrower, invoiceNumber()))).toThrow(/Invalid attestation signature/);
  });

  it('rejects a tampered signature response', () => {
    const { w, inv } = pledged();
    const s = inv.attestation.signature;
    const bad = { ...s, response: (s.response + 1n) % JUBJUB_ORDER };
    expect(tryPledge(w, withAttestation(inv, { signature: bad }))).toThrow(/Invalid attestation signature/);
  });

  it('rejects a tampered announcement point', () => {
    const { w, inv } = pledged();
    const s = inv.attestation.signature;
    const bad = { ...s, announcement: publicKeyOf(randomScalar()) };
    expect(tryPledge(w, withAttestation(inv, { signature: bad }))).toThrow(/Invalid attestation signature/);
  });

  it('rejects a valid signature over a different message', () => {
    const { w, inv } = pledged();
    const other = attestInvoice(w.authority, w.borrower, invoiceNumber());
    expect(tryPledge(w, withAttestation(inv, { signature: other.attestation.signature }))).toThrow(
      /Invalid attestation signature/,
    );
  });

  it('rejects a valid signature over a different digest', () => {
    const { w, inv } = pledged();
    const signature = sign(w.authority.sk, [12345n]);
    expect(tryPledge(w, withAttestation(inv, { signature }))).toThrow(/Invalid attestation signature/);
  });

  it('rejects an out-of-range Schnorr quotient from a malicious prover', () => {
    const w = newWorld({ getSchnorrReduction: ({ privateState }) => [privateState, [116n, 0n]] });
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    expect(tryPledge(w, inv)).toThrow(/Schnorr quotient out of range/);
  });

  it('rejects a forged challenge reduction from a malicious prover', () => {
    const TWO_248 = 452312848583266388373324160190187140051835877600158453279131187530910662656n;
    const w = newWorld({
      getSchnorrReduction: ({ privateState }, c) => [privateState, [c / TWO_248, (c % TWO_248) ^ 1n]],
    });
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    expect(tryPledge(w, inv)).toThrow(/Invalid challenge reduction/);
  });
});

describe('borrower binding (anti-front-running)', () => {
  it('rejects an attestation used by someone other than its borrower', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const thief = secret();
    expect(tryPledge(w, inv, w.lenderA, thief)).toThrow(/bound to a different borrower/);
  });

  it('rejects a thief who also rewrites the borrower field', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const thief = secret();
    const stolen = withAttestation(inv, { borrower: pureCircuits.borrowerKey(thief) });
    expect(tryPledge(w, stolen, w.lenderA, thief)).toThrow(/Invalid attestation signature/);
  });

  it('lets the true borrower pledge after a failed theft', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    expect(tryPledge(w, inv, w.lenderA, secret())).toThrow();
    pledgeAs(w, inv, w.lenderA);
    expect(w.sim.ledger().pledgeCount).toBe(1n);
  });
});

describe('acceptance window', () => {
  const at = (w: World, day: bigint) => attestInvoice(w.authority, w.borrower, invoiceNumber(isoFromDay(day)));

  it('accepts the first day of the window', () => {
    const w = newWorld();
    pledgeAs(w, at(w, WINDOW_START), w.lenderA);
    expect(w.sim.ledger().pledgeCount).toBe(1n);
  });

  it('accepts the last day of the window', () => {
    const w = newWorld();
    pledgeAs(w, at(w, WINDOW_END - 1n), w.lenderA);
    expect(w.sim.ledger().pledgeCount).toBe(1n);
  });

  it('rejects the day before the window', () => {
    const w = newWorld();
    expect(tryPledge(w, at(w, WINDOW_START - 1n))).toThrow(/accepted before this registry's window/);
  });

  it('rejects the day the window closes', () => {
    const w = newWorld();
    expect(tryPledge(w, at(w, WINDOW_END))).toThrow(/accepted after this registry's window/);
  });

  it('uses the acceptance date embedded in the KSeF number', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber('2026-08-14'));
    expect(inv.attestation.acceptanceDay).toBe(BigInt(dayFromIso('2026-08-14')));
  });
});

describe('lender membership', () => {
  it('fails to build a pledge to a lender the registrar never admitted', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    expect(tryPledge(w, inv, secret())).toThrow(/Lender is not in the registry/);
  });

  it('rejects a registry path that belongs to a different lender', () => {
    const w = newWorld({
      getLenderPath: ({ privateState, ledger }) => {
        const path = ledger.lenders.findPathForLeaf(pureCircuits.lenderKey(w.lenderA))!;
        return [privateState, path];
      },
    });
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    expect(tryPledge(w, inv, w.lenderB)).toThrow(/Lender path does not match the lender/);
  });

  it('rejects a forged registry path for an unadmitted lender', () => {
    const outsider = secret();
    const w = newWorld({
      getLenderPath: ({ privateState, ledger }) => {
        const real = ledger.lenders.findPathForLeaf(pureCircuits.lenderKey(w.lenderA))!;
        return [privateState, { ...real, leaf: pureCircuits.lenderKey(outsider) }];
      },
    });
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    expect(tryPledge(w, inv, outsider)).toThrow(/Lender is not admitted/);
  });

  it('accepts a pledge against a historic registry root after more lenders join', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const stalePath = w.sim.ledger().lenders.findPathForLeaf(pureCircuits.lenderKey(w.lenderA))!;
    w.sim.as({ secretKey: w.registrar });
    w.sim.admitLender(pureCircuits.lenderKey(secret()));
    const sim2 = w.sim;
    const original = sim2.contract.witnesses.getLenderPath;
    sim2.contract.witnesses.getLenderPath = ({ privateState }) => [privateState, stalePath];
    pledgeAs(w, inv, w.lenderA);
    sim2.contract.witnesses.getLenderPath = original;
    expect(w.sim.ledger().pledgeCount).toBe(1n);
  });
});

describe('release', () => {
  const pledgedTo = (lender: 'A' | 'B' = 'A') => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const lenderSecret = lender === 'A' ? w.lenderA : w.lenderB;
    const { note, noteSalt } = pledgeAs(w, inv, lenderSecret);
    return { w, inv, note, noteSalt, lenderSecret };
  };

  it('lets the lender of record release, publishing only a nullifier', () => {
    const { w, inv, note, noteSalt } = pledgedTo();
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.release();
    const l = w.sim.ledger();
    expect(l.releaseCount).toBe(1n);
    expect(l.releases.member(pureCircuits.releaseNullifier(note, w.lenderA))).toBe(true);
    expect(l.releases.member(note)).toBe(false);
  });

  it('rejects a second release of the same pledge', () => {
    const { w, inv, noteSalt } = pledgedTo();
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.release();
    expect(() => w.sim.release()).toThrow(/Pledge already released/);
  });

  it('stops another lender from releasing the pledge', () => {
    const { w, inv, noteSalt } = pledgedTo();
    w.sim.as(lenderReleaseState(w.lenderB, inv, noteSalt));
    expect(() => w.sim.release()).toThrow(/Pledge note not found/);
  });

  it('stops another lender who supplies the real note path', () => {
    const { w, inv, note, noteSalt } = pledgedTo();
    const sim = w.sim;
    sim.contract.witnesses.getNotePath = ({ privateState, ledger }) => [privateState, ledger.notes.findPathForLeaf(note)!];
    sim.as(lenderReleaseState(w.lenderB, inv, noteSalt));
    expect(() => sim.release()).toThrow(/Note path does not match the note opening/);
  });

  it('rejects a release with the wrong note salt', () => {
    const { w, inv } = pledgedTo();
    w.sim.as(lenderReleaseState(w.lenderA, inv, secret()));
    expect(() => w.sim.release()).toThrow(/Pledge note not found/);
  });

  it('rejects a forged note path', () => {
    const { w, inv, note, noteSalt } = pledgedTo();
    const sim = w.sim;
    sim.contract.witnesses.getNotePath = ({ privateState, ledger }) => {
      const real = ledger.notes.findPathForLeaf(note)!;
      const [first, ...rest] = real.path;
      return [privateState, { ...real, path: [{ ...first, sibling: { field: first.sibling.field + 1n } }, ...rest] }];
    };
    sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    expect(() => sim.release()).toThrow(/Unknown pledge note/);
  });
});

describe('encrypted delivery and the lender inbox', () => {
  const deliveriesOf = (w: ReturnType<typeof newWorld>) => [...w.sim.ledger().deliveries];

  it('lets the lender of record find its own pledge by scanning', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const { note, noteSalt } = pledgeAs(w, inv, w.lenderA, w.borrower, true);

    // The inbox: try every delivery, keep the ones that open. Nothing on chain says which is yours.
    const opened = deliveriesOf(w)
      .map(([key, ct]) => ({ key, opening: openDelivery(w.lenderA, ct) }))
      .filter((d) => d.opening !== undefined);

    expect(opened).toHaveLength(1);
    expect(opened[0].opening!.tag).toEqual(inv.attestation.tag);
    expect(opened[0].opening!.amount).toBe(inv.attestation.amount);
    expect(opened[0].opening!.salt).toEqual(noteSalt);

    // The opening must recompute to the note it was filed under, or it is not this pledge.
    const o = opened[0].opening!;
    expect(
      hex(pureCircuits.noteCommitment(o.tag, pureCircuits.lenderKey(w.lenderA), o.invoiceCommit, o.amount, o.salt)),
    ).toBe(hex(note));
    expect(hex(opened[0].key)).toBe(hex(note));
  });

  it('tells a different lender nothing, even scanning every delivery', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    pledgeAs(w, inv, w.lenderA, w.borrower, true);
    expect(deliveriesOf(w).filter(([, ct]) => openDelivery(w.lenderB, ct) !== undefined)).toHaveLength(0);
  });

  it('files each pledge under its own note, so two lenders each find only theirs', () => {
    const w = newWorld();
    const first = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const second = attestInvoice(w.authority, w.borrower, invoiceNumber());
    pledgeAs(w, first, w.lenderA, w.borrower, true);
    pledgeAs(w, second, w.lenderB, w.borrower, true);

    expect(deliveriesOf(w)).toHaveLength(2);
    const forA = deliveriesOf(w).filter(([, ct]) => openDelivery(w.lenderA, ct) !== undefined);
    const forB = deliveriesOf(w).filter(([, ct]) => openDelivery(w.lenderB, ct) !== undefined);
    expect(forA).toHaveLength(1);
    expect(forB).toHaveLength(1);
    expect(hex(forA[0][0])).not.toBe(hex(forB[0][0]));
  });

  it('survives a borrower posting garbage: the lender simply finds nothing and can decline', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const noteSalt = secret();
    w.sim.as(borrowerState(w.borrower, inv, w.lenderA, noteSalt));
    // The circuit cannot constrain an opaque value, so this is accepted on chain.
    w.sim.pledge(pureCircuits.lenderKey(w.lenderA), new Uint8Array([1, 2, 3, 4]));

    expect(deliveriesOf(w).filter(([, ct]) => openDelivery(w.lenderA, ct) !== undefined)).toHaveLength(0);

    // The void path is the remedy, and it still works.
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.declinePledge();
    expect(w.sim.ledger().tags.member(inv.attestation.tag)).toBe(false);
  });

  it("publishes each admitted lender's encryption key, so a borrower can address it", () => {
    const w = newWorld();
    const keys = w.sim.ledger().lenderEncryptionKeys;
    expect(keys.member(pureCircuits.lenderKey(w.lenderA))).toBe(true);
    expect(hex(keys.lookup(pureCircuits.lenderKey(w.lenderA)))).toBe(hex(lenderEncryptionKey(w.lenderA)));
    expect(hex(keys.lookup(pureCircuits.lenderKey(w.lenderB)))).toBe(hex(lenderEncryptionKey(w.lenderB)));
  });
});

describe('lender acceptance and the void path', () => {
  const pledgedTo = (lender: 'A' | 'B' = 'A') => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const lenderSecret = lender === 'A' ? w.lenderA : w.lenderB;
    const { note, noteSalt } = pledgeAs(w, inv, lenderSecret);
    return { w, inv, note, noteSalt, lenderSecret };
  };

  it('lets the named lender accept, publishing only a decision nullifier', () => {
    const { w, inv, note, noteSalt } = pledgedTo();
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.acceptPledge();
    const l = w.sim.ledger();
    expect(l.acceptCount).toBe(1n);
    expect(l.accepted.member(pureCircuits.decisionNullifier(note, w.lenderA))).toBe(true);
    expect(l.accepted.member(note)).toBe(false);
    expect(l.declined.isEmpty()).toBe(true);
    // Accepting does not free the receivable.
    expect(l.tags.member(inv.attestation.tag)).toBe(true);
  });

  it('frees the receivable when the named lender declines', () => {
    const { w, inv, note, noteSalt } = pledgedTo();
    expect(w.sim.ledger().tags.member(inv.attestation.tag)).toBe(true);

    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.declinePledge();

    const l = w.sim.ledger();
    expect(l.declineCount).toBe(1n);
    expect(l.declined.member(pureCircuits.decisionNullifier(note, w.lenderA))).toBe(true);
    expect(l.tags.member(inv.attestation.tag)).toBe(false);
  });

  it('lets the borrower pledge the same invoice elsewhere after a decline', () => {
    const { w, inv, noteSalt } = pledgedTo();
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.declinePledge();

    // The whole point of the void path: a refused pledge must not burn the receivable.
    const second = pledgeAs(w, inv, w.lenderB);
    expect(w.sim.ledger().tags.member(inv.attestation.tag)).toBe(true);
    expect(w.sim.ledger().pledgeCount).toBe(2n);
    expect(second.note).not.toEqual(new Uint8Array(32));
  });

  it('still refuses a second pledge while the first is undecided', () => {
    const { w, inv } = pledgedTo();
    expect(() => pledgeAs(w, inv, w.lenderB)).toThrow(/Receivable already pledged/);
  });

  it('still refuses a second pledge after the lender accepted', () => {
    const { w, inv, noteSalt } = pledgedTo();
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.acceptPledge();
    expect(() => pledgeAs(w, inv, w.lenderB)).toThrow(/Receivable already pledged/);
  });

  it('rejects a second decision on the same pledge', () => {
    const { w, inv, noteSalt } = pledgedTo();
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.acceptPledge();
    expect(() => w.sim.acceptPledge()).toThrow(/Pledge already accepted/);
    expect(() => w.sim.declinePledge()).toThrow(/Pledge already accepted/);
  });

  it('rejects an accept after a decline', () => {
    const { w, inv, noteSalt } = pledgedTo();
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.declinePledge();
    expect(() => w.sim.acceptPledge()).toThrow(/Pledge already declined/);
    expect(() => w.sim.declinePledge()).toThrow(/Pledge already declined/);
  });

  it('stops another lender from deciding on the pledge', () => {
    const { w, inv, noteSalt } = pledgedTo();
    w.sim.as(lenderReleaseState(w.lenderB, inv, noteSalt));
    expect(() => w.sim.acceptPledge()).toThrow(/Pledge note not found/);
    expect(() => w.sim.declinePledge()).toThrow(/Pledge note not found/);
  });

  it('stops another lender who supplies the real note path', () => {
    const { w, inv, note, noteSalt } = pledgedTo();
    const sim = w.sim;
    sim.contract.witnesses.getNotePath = ({ privateState, ledger }) => [privateState, ledger.notes.findPathForLeaf(note)!];
    sim.as(lenderReleaseState(w.lenderB, inv, noteSalt));
    expect(() => sim.declinePledge()).toThrow(/Note path does not match the note opening/);
  });

  it('rejects a decision with the wrong note salt', () => {
    const { w, inv } = pledgedTo();
    w.sim.as(lenderReleaseState(w.lenderA, inv, secret()));
    expect(() => w.sim.acceptPledge()).toThrow(/Pledge note not found/);
  });

  it('keeps release available to the lender of record after accepting', () => {
    const { w, inv, noteSalt } = pledgedTo();
    w.sim.as(lenderReleaseState(w.lenderA, inv, noteSalt));
    w.sim.acceptPledge();
    w.sim.release();
    expect(w.sim.ledger().releaseCount).toBe(1n);
  });

  it('gives each lender a distinct decision nullifier for the same note', () => {
    const { note } = pledgedTo();
    const w = newWorld();
    expect(pureCircuits.decisionNullifier(note, w.lenderA)).not.toEqual(
      pureCircuits.decisionNullifier(note, w.lenderB),
    );
  });

  it('separates decision nullifiers from release nullifiers', () => {
    const { w, note } = pledgedTo();
    expect(pureCircuits.decisionNullifier(note, w.lenderA)).not.toEqual(
      pureCircuits.releaseNullifier(note, w.lenderA),
    );
  });
});

describe('pure helpers', () => {
  it('separates role keys derived from the same secret', () => {
    const s = secret();
    const keys = [pureCircuits.registrarKey(s), pureCircuits.borrowerKey(s), pureCircuits.lenderKey(s)].map(hex);
    expect(new Set(keys).size).toBe(3);
    expect(keys).not.toContain(hex(s));
  });

  it('gives each lender a distinct nullifier for the same note', () => {
    const note = secret();
    expect(hex(pureCircuits.releaseNullifier(note, secret()))).not.toBe(hex(pureCircuits.releaseNullifier(note, secret())));
  });

  it('reduces the whole attestation body to one digest that changes with every field', () => {
    const [registry, tag, commit, borrower] = [secret(), secret(), secret(), secret()];
    const amount = 12_500_000n;
    const base = pureCircuits.attestationMessage(registry, tag, commit, amount, 20_000n, 1_800_000_000n, borrower);
    expect(base).toHaveLength(1);
    const variants = [
      pureCircuits.attestationMessage(secret(), tag, commit, amount, 20_000n, 1_800_000_000n, borrower),
      pureCircuits.attestationMessage(registry, secret(), commit, amount, 20_000n, 1_800_000_000n, borrower),
      pureCircuits.attestationMessage(registry, tag, secret(), amount, 20_000n, 1_800_000_000n, borrower),
      // One grosz more is a different signed body: a borrowing-base proof cannot inflate the amount.
      pureCircuits.attestationMessage(registry, tag, commit, amount + 1n, 20_000n, 1_800_000_000n, borrower),
      pureCircuits.attestationMessage(registry, tag, commit, amount, 20_001n, 1_800_000_000n, borrower),
      pureCircuits.attestationMessage(registry, tag, commit, amount, 20_000n, 1_800_086_400n, borrower),
      pureCircuits.attestationMessage(registry, tag, commit, amount, 20_000n, 1_800_000_000n, secret()),
    ];
    for (const v of variants) expect(v[0]).not.toBe(base[0]);
  });

  it('makes note commitments hiding: same pledge, different salt, unrelated commitments', () => {
    const [tag, lender, commit] = [secret(), secret(), secret()];
    expect(hex(pureCircuits.noteCommitment(tag, lender, commit, 12_500_000n, secret()))).not.toBe(
      hex(pureCircuits.noteCommitment(tag, lender, commit, 12_500_000n, secret())),
    );
  });

  it('binds the amount into the note commitment', () => {
    const [tag, lender, commit, salt] = [secret(), secret(), secret(), secret()];
    expect(hex(pureCircuits.noteCommitment(tag, lender, commit, 12_500_000n, salt))).not.toBe(
      hex(pureCircuits.noteCommitment(tag, lender, commit, 12_500_001n, salt)),
    );
  });
});

describe('borrowing base', () => {
  const ROUND = new Uint8Array(32).fill(1);
  // Four receivables worth 10.00, 20.00, 30.00 and 40.00 PLN in grosz: 10,000,000 together.
  const AMOUNTS = ['1000000', '2000000', '3000000', '4000000'];
  const TOTAL = 10_000_000n;

  const withPool = (lender?: Uint8Array) => {
    const w = newWorld();
    const sk = lender ?? w.lenderA;
    const pool = pledgePool(w, sk, AMOUNTS);
    w.sim.as(lenderPoolState(sk, pool));
    return { w, pool, sk };
  };

  it('proves a floor the book clears, and records the round and the floor', () => {
    const { w, sk } = withPool();
    w.sim.proveBorrowingBase(ROUND, TOTAL);
    const l = w.sim.ledger();
    expect(l.drawCount).toBe(1n);
    const id = pureCircuits.drawId(ROUND, sk);
    expect(l.draws.member(id)).toBe(true);
    const record = l.draws.lookup(id);
    expect(hex(record.round)).toBe(hex(ROUND));
    expect(record.floor).toBe(TOTAL);
  });

  it('clears a floor below the total, and refuses one above it', () => {
    const { w } = withPool();
    w.sim.proveBorrowingBase(ROUND, TOTAL - 1n);
    expect(w.sim.ledger().drawCount).toBe(1n);

    const other = withPool();
    expect(() => other.w.sim.proveBorrowingBase(ROUND, TOTAL + 1n)).toThrow(/Pool does not clear the floor/);
    expect(other.w.sim.ledger().drawCount).toBe(0n);
  });

  it('refuses the same receivable counted four times', () => {
    const { w, pool, sk } = withPool();
    w.sim.as(lenderPoolState(sk, [pool[0], pool[0], pool[0], pool[0]]));
    expect(() => w.sim.proveBorrowingBase(ROUND, 1n)).toThrow(/A receivable appears twice in the pool/);
  });

  it('refuses a pool with one receivable repeated', () => {
    const { w, pool, sk } = withPool();
    for (const dup of [
      [pool[0], pool[1], pool[2], pool[0]],
      [pool[0], pool[1], pool[1], pool[3]],
    ]) {
      w.sim.as(lenderPoolState(sk, dup));
      expect(() => w.sim.proveBorrowingBase(ROUND, 1n)).toThrow(/A receivable appears twice in the pool/);
    }
  });

  it('one draw per round, and a new round starts fresh', () => {
    const { w } = withPool();
    w.sim.proveBorrowingBase(ROUND, TOTAL);
    expect(() => w.sim.proveBorrowingBase(ROUND, TOTAL)).toThrow(
      /A borrowing base was already proven for this round/,
    );
    w.sim.proveBorrowingBase(new Uint8Array(32).fill(2), TOTAL);
    expect(w.sim.ledger().drawCount).toBe(2n);
  });

  it('two lenders draw over their own books without colliding', () => {
    const w = newWorld();
    const poolA = pledgePool(w, w.lenderA, AMOUNTS);
    const poolB = pledgePool(w, w.lenderB, AMOUNTS);
    w.sim.as(lenderPoolState(w.lenderA, poolA));
    w.sim.proveBorrowingBase(ROUND, TOTAL);
    w.sim.as(lenderPoolState(w.lenderB, poolB));
    w.sim.proveBorrowingBase(ROUND, TOTAL);
    expect(w.sim.ledger().drawCount).toBe(2n);
    expect(hex(pureCircuits.drawId(ROUND, w.lenderA))).not.toBe(hex(pureCircuits.drawId(ROUND, w.lenderB)));
  });

  it('refuses a pool holding another lender\'s receivable', () => {
    const w = newWorld();
    const poolA = pledgePool(w, w.lenderA, AMOUNTS.slice(0, 3));
    const poolB = pledgePool(w, w.lenderB, AMOUNTS.slice(3));
    w.sim.as(lenderPoolState(w.lenderA, [...poolA, ...poolB]));
    // The note commitment binds the lender, so lender A cannot even find a path for B's note.
    expect(() => w.sim.proveBorrowingBase(ROUND, 1n)).toThrow(/Pool item 3 is not a pledge note on the ledger/);
  });

  it('refuses another lender who supplies the real note paths', () => {
    const w = newWorld();
    const pool = pledgePool(w, w.lenderA, AMOUNTS);
    const lenderAKey = pureCircuits.lenderKey(w.lenderA);
    w.sim.contract.witnesses.getPoolPaths = ({ privateState, ledger }) => [
      privateState,
      pool.map(
        (n) =>
          ledger.notes.findPathForLeaf(
            pureCircuits.noteCommitment(n.tag, lenderAKey, n.invoiceCommit, n.amount, n.salt),
          )!,
      ),
    ];
    w.sim.as(lenderPoolState(w.lenderB, pool));
    expect(() => w.sim.proveBorrowingBase(ROUND, 1n)).toThrow(/Pool note path does not match its opening/);
  });

  it('refuses an inflated amount, because the note commitment binds what was attested', () => {
    const { w, pool, sk } = withPool();
    const inflated = [{ ...pool[0], amount: pool[0].amount * 1000n }, pool[1], pool[2], pool[3]];
    w.sim.as(lenderPoolState(sk, inflated));
    expect(() => w.sim.proveBorrowingBase(ROUND, TOTAL * 100n)).toThrow(
      /Pool item 0 is not a pledge note on the ledger/,
    );
  });

  it('rejects a forged note path', () => {
    const { w, pool, sk } = withPool();
    const lenderKey = pureCircuits.lenderKey(sk);
    w.sim.contract.witnesses.getPoolPaths = ({ privateState, ledger }) => [
      privateState,
      pool.map((n, i) => {
        const real = ledger.notes.findPathForLeaf(
          pureCircuits.noteCommitment(n.tag, lenderKey, n.invoiceCommit, n.amount, n.salt),
        )!;
        if (i !== 2) return real;
        const [first, ...rest] = real.path;
        return { ...real, path: [{ ...first, sibling: { field: first.sibling.field + 1n } }, ...rest] };
      }),
    ];
    expect(() => w.sim.proveBorrowingBase(ROUND, 1n)).toThrow(/Unknown pool note/);
  });

  it('needs exactly four openings', () => {
    const { w, pool, sk } = withPool();
    for (const wrong of [pool.slice(0, 3), [...pool, pool[0]], []]) {
      w.sim.as(lenderPoolState(sk, wrong));
      expect(() => w.sim.proveBorrowingBase(ROUND, 1n)).toThrow(
        /A borrowing-base pool needs exactly 4 note openings/,
      );
    }
  });

  it('refuses one receivable counted twice, pledged under two notes after a decline', () => {
    // The hole this closes: declining frees the tag but leaves the note in the append-only tree, and
    // the declining lender keeps its opening. So a lender that declines and is then pledged the same
    // invoice again holds two distinct note commitments for one receivable, and a check that only
    // compared commitments let it count the invoice twice. Before the fix this proved a floor of
    // 20,000,000 grosz against a book genuinely worth 11,000,000.
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber(), '9000000');
    const first = pledgeAs(w, inv, w.lenderA);
    w.sim.as(lenderReleaseState(w.lenderA, inv, first.noteSalt));
    w.sim.declinePledge();
    const second = pledgeAs(w, inv, w.lenderA);

    const filler = [1, 2].map(() => {
      const other = attestInvoice(w.authority, w.borrower, invoiceNumber(), '1000000');
      return openingOf(other, pledgeAs(w, other, w.lenderA).noteSalt);
    });
    const pool = [openingOf(inv, first.noteSalt), openingOf(inv, second.noteSalt), ...filler];

    // Two genuinely different notes for one receivable: the premise of the attack.
    expect(hex(pool[0].tag)).toBe(hex(pool[1].tag));
    const lenderAKey = pureCircuits.lenderKey(w.lenderA);
    expect(hex(pureCircuits.noteCommitment(pool[0].tag, lenderAKey, pool[0].invoiceCommit, pool[0].amount, pool[0].salt))).not.toBe(
      hex(pureCircuits.noteCommitment(pool[1].tag, lenderAKey, pool[1].invoiceCommit, pool[1].amount, pool[1].salt)),
    );

    w.sim.as(lenderPoolState(w.lenderA, pool));
    expect(() => w.sim.proveBorrowingBase(ROUND, 20_000_000n)).toThrow(/A receivable appears twice in the pool/);
    // And it is refused even at a floor the real book clears, because the pool itself is invalid.
    expect(() => w.sim.proveBorrowingBase(ROUND, 1n)).toThrow(/A receivable appears twice in the pool/);
    expect(w.sim.ledger().drawCount).toBe(0n);
  });

  it('still accepts a pool of four genuinely different receivables after a decline', () => {
    // The positive control for the test above: a decline in the lender's history must not make its
    // book unprovable, only the duplicated receivable.
    const w = newWorld();
    const declined = attestInvoice(w.authority, w.borrower, invoiceNumber(), '9000000');
    const { noteSalt } = pledgeAs(w, declined, w.lenderA);
    w.sim.as(lenderReleaseState(w.lenderA, declined, noteSalt));
    w.sim.declinePledge();

    const pool = pledgePool(w, w.lenderA, AMOUNTS);
    w.sim.as(lenderPoolState(w.lenderA, pool));
    w.sim.proveBorrowingBase(ROUND, TOTAL);
    expect(w.sim.ledger().drawCount).toBe(1n);
  });

  it('is what a lender does with the openings its inbox decrypted', () => {
    // The whole chain, end to end: the borrower seals four openings to the lender, the lender finds
    // them by scanning, accepts them, and proves its book clears a floor — without the funder ever
    // seeing an invoice, an amount or which receivables are in the pool.
    const w = newWorld();
    const invoices = AMOUNTS.map((amount) => attestInvoice(w.authority, w.borrower, invoiceNumber(), amount));
    for (const inv of invoices) pledgeAs(w, inv, w.lenderA, w.borrower, true);

    const decrypted = [...w.sim.ledger().deliveries]
      .map(([, ciphertext]) => openDelivery(w.lenderA, ciphertext))
      .filter((o): o is NonNullable<typeof o> => o !== undefined);
    expect(decrypted).toHaveLength(4);

    for (const opening of decrypted) {
      w.sim.as({ secretKey: w.lenderA, releaseNote: opening });
      w.sim.acceptPledge();
    }
    expect(w.sim.ledger().acceptCount).toBe(4n);

    w.sim.as(lenderPoolState(w.lenderA, decrypted));
    w.sim.proveBorrowingBase(ROUND, TOTAL);
    expect(w.sim.ledger().draws.lookup(pureCircuits.drawId(ROUND, w.lenderA)).floor).toBe(TOTAL);
  });
});

describe('borrower state helper', () => {
  it('targets the requested lender key', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const state = borrowerState(w.borrower, inv, w.lenderB);
    expect(hex(state.pledgeLender!)).toBe(hex(pureCircuits.lenderKey(w.lenderB)));
  });
});
