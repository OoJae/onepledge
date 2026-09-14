// SPDX-License-Identifier: Apache-2.0
// Regression tests for the Wave 1 security review (docs/security-review.md).
//   F01  v1 signed a 248-bit truncation of the tag, so one attestation could be pledged again with
//        a different last byte. Every bit of every signed field must now be bound.
//   F32  attestations are bound to one registry deployment.
//   F33  attestations expire.
//   F67  the identity point is refused as the tag authority.

import { describe, expect, it } from 'vitest';
import { publicKeyOf, roundUpToDay, verifyAttestation } from '@onepledge/attester';
import { RegistrySimulator } from '../simulator.js';
import { type Attestation } from '../witnesses.js';
import {
  NOW,
  SIM_ADDRESS,
  WINDOW_END,
  WINDOW_START,
  addressBytesOf,
  attestInvoice,
  invoiceNumber,
  newAuthority,
  newWorld,
  pledgeAs,
  secret,
  type AttestedInvoice,
} from './fixtures.js';

const withAttestation = (inv: AttestedInvoice, patch: Partial<Attestation>): AttestedInvoice => ({
  ...inv,
  attestation: { ...inv.attestation, ...patch },
});

const flipped = (bytes: Uint8Array, index: number) => {
  const copy = new Uint8Array(bytes);
  copy[index] ^= 0x01;
  return copy;
};

describe('F01: every bit of the signed attestation is bound', () => {
  it.each([...Array(32).keys()])('refuses a second pledge after flipping tag byte %i', (i) => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    pledgeAs(w, inv, w.lenderA);
    const replay = withAttestation(inv, { tag: flipped(inv.attestation.tag, i) });
    expect(() => pledgeAs(w, replay, w.lenderB)).toThrow(/Invalid attestation signature/);
    expect(w.sim.ledger().pledgeCount).toBe(1n);
  });

  it.each([...Array(32).keys()])('refuses an invoice commitment with byte %i flipped', (i) => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const forged = withAttestation(inv, { invoiceCommit: flipped(inv.attestation.invoiceCommit, i) });
    expect(() => pledgeAs(w, forged, w.lenderA)).toThrow(/Invalid attestation signature/);
  });

  it('refuses a stretched expiry', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    const stretched = withAttestation(inv, { expiresAt: inv.attestation.expiresAt + 86_400n });
    expect(() => pledgeAs(w, stretched, w.lenderA)).toThrow(/Invalid attestation signature/);
  });
});

describe('F32: attestations are bound to one registry', () => {
  it('refuses an attestation signed for a different registry address', () => {
    const w = newWorld();
    const other = addressBytesOf(SIM_ADDRESS).map((b, i) => (i === 0 ? b ^ 0xff : b));
    const hex = Array.from(other, (b) => b.toString(16).padStart(2, '0')).join('');
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber(), undefined, { registry: hex });
    expect(() => pledgeAs(w, inv, w.lenderA)).toThrow(/Invalid attestation signature/);
  });

  it('refuses replaying one attestation on a second deployment with the same authority and window', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    pledgeAs(w, inv, w.lenderA);

    const otherAddress = SIM_ADDRESS.replace(/^../, (b) => (parseInt(b, 16) ^ 0x0f).toString(16).padStart(2, '0'));
    const second = new RegistrySimulator(w.registrar, publicKeyOf(w.authority.sk), WINDOW_START, WINDOW_END, {}, {
      address: otherAddress,
      time: NOW,
    });
    const world2 = { ...w, sim: second };
    second.as({ secretKey: w.registrar });
    second.admitLender(RegistrySimulator.pure.lenderKey(w.lenderB));
    expect(() => pledgeAs(world2, inv, w.lenderB)).toThrow(/Invalid attestation signature/);
  });
});

describe('F33: attestations expire', () => {
  it('rounds the expiry up to a whole UTC day', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber(), undefined, { expiresAt: BigInt(NOW + 1) });
    expect(inv.attestation.expiresAt).toBe(roundUpToDay(BigInt(NOW + 1)));
    expect(inv.attestation.expiresAt % 86_400n).toBe(0n);
  });

  it('accepts a pledge one second before expiry', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    w.sim.setTime(Number(inv.attestation.expiresAt) - 1);
    pledgeAs(w, inv, w.lenderA);
    expect(w.sim.ledger().pledgeCount).toBe(1n);
  });

  it('refuses a pledge at the expiry second', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    w.sim.setTime(Number(inv.attestation.expiresAt));
    expect(() => pledgeAs(w, inv, w.lenderA)).toThrow(/Attestation expired/);
  });

  it('refuses a pledge long after expiry', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber(), undefined, { expiresAt: BigInt(NOW - 86_400 * 3) });
    expect(() => pledgeAs(w, inv, w.lenderA)).toThrow(/Attestation expired/);
  });
});

describe('F67: the tag authority key is validated', () => {
  it('refuses the identity point at deployment', () => {
    expect(() => new RegistrySimulator(secret(), { x: 0n, y: 1n }, WINDOW_START, WINDOW_END)).toThrow(/identity point/);
  });

  it('refuses out-of-range signing keys', () => {
    expect(() => publicKeyOf(0n)).toThrow(/0 < sk/);
    expect(() => publicKeyOf(6554484396890773809930967563523245729705921265872317281365359162392183254199n)).toThrow(/0 < sk/);
  });
});

describe('off-chain attestation verification (what a lender runs before funding)', () => {
  const setup = () => {
    const authority = newAuthority();
    const borrower = secret();
    const inv = attestInvoice(authority, borrower, invoiceNumber());
    return { authority, inv, pk: publicKeyOf(authority.sk), registry: addressBytesOf(SIM_ADDRESS) };
  };

  it('accepts a genuine attestation for this registry', () => {
    const { inv, pk, registry } = setup();
    expect(verifyAttestation(pk, registry, inv.attestation)).toBe(true);
  });

  it('rejects a flipped last tag byte, another registry, another authority and the identity key', () => {
    const { inv, pk, registry } = setup();
    expect(verifyAttestation(pk, registry, { ...inv.attestation, tag: flipped(inv.attestation.tag, 31) })).toBe(false);
    expect(verifyAttestation(pk, flipped(registry, 0), inv.attestation)).toBe(false);
    expect(verifyAttestation(publicKeyOf(newAuthority().sk), registry, inv.attestation)).toBe(false);
    expect(verifyAttestation({ x: 0n, y: 1n }, registry, inv.attestation)).toBe(false);
  });

  it('agrees with the circuit: whatever it verifies, the registry accepts', () => {
    const w = newWorld();
    const inv = attestInvoice(w.authority, w.borrower, invoiceNumber());
    expect(verifyAttestation(publicKeyOf(w.authority.sk), addressBytesOf(SIM_ADDRESS), inv.attestation)).toBe(true);
    pledgeAs(w, inv, w.lenderA);
    expect(w.sim.ledger().tags.member(inv.attestation.tag)).toBe(true);
  });
});
