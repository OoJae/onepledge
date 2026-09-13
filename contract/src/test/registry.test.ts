// SPDX-License-Identifier: Apache-2.0
// Registry behaviour: deployment, registrar, pledge, double-pledge rejection, forgery, window,
// lender membership and release. Every assert in registry.compact has at least one test that
// makes it fire.

import { describe, expect, it } from 'vitest';
import { publicKeyOf, randomScalar, sign, dayFromIso } from '@onepledge/attester';
import { pureCircuits } from '../managed/registry/contract/index.js';
import { type Attestation } from '../witnesses.js';
import { RegistrySimulator } from '../simulator.js';
import {
  WINDOW_END,
  WINDOW_START,
  attestInvoice,
  borrowerState,
  invoiceNumber,
  lenderReleaseState,
  newAuthority,
  newWorld,
  pledgeAs,
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
  it('stores the registrar key, tag authority and acceptance window', () => {
    const authority = newAuthority();
    const registrar = secret();
    const sim = new RegistrySimulator(registrar, publicKeyOf(authority.sk), WINDOW_START, WINDOW_END);
    const l = sim.ledger();
    expect(hex(l.registrar)).toBe(hex(pureCircuits.registrarKey(registrar)));
    expect(l.tagAuthority).toEqual(publicKeyOf(authority.sk));
    expect(l.windowStart).toBe(WINDOW_START);
    expect(l.windowEnd).toBe(WINDOW_END);
    expect(l.pledgeCount).toBe(0n);
    expect(l.releaseCount).toBe(0n);
    expect(l.tags.isEmpty()).toBe(true);
  });

  it('rejects an empty acceptance window', () => {
    const pk = publicKeyOf(newAuthority().sk);
    expect(() => new RegistrySimulator(secret(), pk, WINDOW_END, WINDOW_START)).toThrow(/Empty acceptance window/);
    expect(() => new RegistrySimulator(secret(), pk, WINDOW_START, WINDOW_START)).toThrow(/Empty acceptance window/);
  });

  it('never stores the registrar secret itself', () => {
    const registrar = secret();
    const sim = new RegistrySimulator(registrar, publicKeyOf(newAuthority().sk), WINDOW_START, WINDOW_END);
    expect(hex(sim.ledger().registrar)).not.toBe(hex(registrar));
  });
});

describe('registrar', () => {
  it('admits lenders into the registry tree', () => {
    const w = newWorld();
    expect(w.sim.ledger().lenders.findPathForLeaf(pureCircuits.lenderKey(w.lenderA))).toBeDefined();
    expect(w.sim.ledger().lenders.findPathForLeaf(pureCircuits.lenderKey(w.lenderB))).toBeDefined();
    expect(w.sim.ledger().lenders.firstFree()).toBe(2n);
  });

  it('refuses to let anyone else admit a lender', () => {
    const w = newWorld();
    w.sim.as({ secretKey: w.borrower });
    expect(() => w.sim.admitLender(pureCircuits.lenderKey(secret()))).toThrow(/Only the registrar can admit lenders/);
  });

  it('hands the role over on rotation', () => {
    const w = newWorld();
    const next = secret();
    w.sim.as({ secretKey: w.registrar });
    w.sim.rotateRegistrar(pureCircuits.registrarKey(next));
    expect(() => w.sim.admitLender(pureCircuits.lenderKey(secret()))).toThrow(/Only the registrar/);
    w.sim.as({ secretKey: next });
    w.sim.admitLender(pureCircuits.lenderKey(secret()));
    expect(w.sim.ledger().lenders.firstFree()).toBe(3n);
  });

  it('refuses rotation from a non-registrar', () => {
    const w = newWorld();
    w.sim.as({ secretKey: w.borrower });
    expect(() => w.sim.rotateRegistrar(pureCircuits.registrarKey(w.borrower))).toThrow(
      /Only the registrar can rotate the registrar/,
    );
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
      hex(pureCircuits.noteCommitment(inv.attestation.tag, pureCircuits.lenderKey(w.lenderA), inv.attestation.invoiceCommit, noteSalt)),
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

  it('rejects a signature made without the attestation domain separator', () => {
    const { w, inv } = pledged();
    const a = inv.attestation;
    const msg = pureCircuits.attestationMessage(a.tag, a.invoiceCommit, a.acceptanceDay, a.borrower);
    const signature = sign(w.authority.sk, [0n, msg[1], msg[2], msg[3], msg[4]]);
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

  it('starts every attestation message with the fixed domain separator', () => {
    const msg = pureCircuits.attestationMessage(secret(), secret(), 20_000n, secret());
    expect(msg).toHaveLength(5);
    expect(msg[0]).toBe(pureCircuits.attestationDomain());
    expect(msg[3]).toBe(20_000n);
  });

  it('makes note commitments hiding: same pledge, different salt, unrelated commitments', () => {
    const [tag, lender, commit] = [secret(), secret(), secret()];
    expect(hex(pureCircuits.noteCommitment(tag, lender, commit, secret()))).not.toBe(
      hex(pureCircuits.noteCommitment(tag, lender, commit, secret())),
    );
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
