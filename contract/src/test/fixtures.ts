// SPDX-License-Identifier: Apache-2.0
// Test parties and attested invoices. The attester package is exercised as the real signer.

import { randomBytes } from 'node:crypto';
import {
  attest,
  dayFromIso,
  invoiceCommitment,
  newSalt,
  parseKsefNumber,
  publicKeyOf,
  randomScalar,
  receivableTag,
  syntheticKsefNumber,
  type InvoiceFields,
} from '@onepledge/attester';
import { pureCircuits } from '../managed/registry/contract/index.js';
import { type Attestation, type OnePledgePrivateState } from '../witnesses.js';
import { RegistrySimulator } from '../simulator.js';

export const secret = (): Uint8Array => new Uint8Array(randomBytes(32));

export const WINDOW_START = BigInt(dayFromIso('2026-07-01'));
export const WINDOW_END = BigInt(dayFromIso('2026-10-01'));

export const SELLER_NIP = '5265877635';
export const DEBTOR_NIP = '7010002139';

export interface TagAuthority {
  readonly sk: bigint;
  readonly tagSecret: Uint8Array;
}

export const newAuthority = (): TagAuthority => ({ sk: randomScalar(), tagSecret: secret() });

export interface AttestedInvoice {
  readonly fields: InvoiceFields;
  readonly salt: Uint8Array;
  readonly attestation: Attestation;
}

let counter = 0;
export const invoiceNumber = (acceptanceDate = '2026-08-14'): string => {
  counter += 1;
  return syntheticKsefNumber(SELLER_NIP, acceptanceDate, counter.toString(16).toUpperCase().padStart(12, '0'));
};

/** What the tag authority hands a borrower for one invoice. */
export const attestInvoice = (
  authority: TagAuthority,
  borrowerSecret: Uint8Array,
  ksefNumber: string,
  amountGrosz = '12500000',
): AttestedInvoice => {
  const parsed = parseKsefNumber(ksefNumber);
  const fields: InvoiceFields = {
    ksefNumber: parsed.canonical,
    sellerNip: parsed.sellerNip,
    debtorNip: DEBTOR_NIP,
    amountGrosz,
    currency: 'PLN',
    dueDate: '2026-11-12',
  };
  const salt = newSalt();
  const attestation = attest(authority.sk, {
    tag: receivableTag(authority.tagSecret, parsed.canonical),
    invoiceCommit: invoiceCommitment(fields, salt),
    acceptanceDay: parsed.acceptanceDay,
    borrower: pureCircuits.borrowerKey(borrowerSecret),
  });
  return { fields, salt, attestation };
};

export interface World {
  readonly sim: RegistrySimulator;
  readonly authority: TagAuthority;
  readonly registrar: Uint8Array;
  readonly lenderA: Uint8Array;
  readonly lenderB: Uint8Array;
  readonly borrower: Uint8Array;
}

/** A registry with two admitted lenders and one borrower. */
export const newWorld = (overrides: ConstructorParameters<typeof RegistrySimulator>[4] = {}): World => {
  const authority = newAuthority();
  const registrar = secret();
  const sim = new RegistrySimulator(registrar, publicKeyOf(authority.sk), WINDOW_START, WINDOW_END, overrides);
  const lenderA = secret();
  const lenderB = secret();
  sim.as({ secretKey: registrar });
  sim.admitLender(pureCircuits.lenderKey(lenderA));
  sim.admitLender(pureCircuits.lenderKey(lenderB));
  return { sim, authority, registrar, lenderA, lenderB, borrower: secret() };
};

/** Borrower private state ready to pledge `invoice` to `lenderSecret`'s lender key. */
export const borrowerState = (
  borrowerSecret: Uint8Array,
  invoice: AttestedInvoice,
  lenderSecret: Uint8Array,
  noteSalt = secret(),
): OnePledgePrivateState => ({
  secretKey: borrowerSecret,
  attestation: invoice.attestation,
  pledgeLender: pureCircuits.lenderKey(lenderSecret),
  noteSalt,
});

export const pledgeAs = (w: World, invoice: AttestedInvoice, lenderSecret: Uint8Array, borrowerSecret = w.borrower) => {
  const noteSalt = secret();
  w.sim.as(borrowerState(borrowerSecret, invoice, lenderSecret, noteSalt));
  const note = w.sim.pledge(pureCircuits.lenderKey(lenderSecret));
  return { note, noteSalt };
};

export const lenderReleaseState = (lenderSecret: Uint8Array, invoice: AttestedInvoice, noteSalt: Uint8Array) => ({
  secretKey: lenderSecret,
  releaseNote: { tag: invoice.attestation.tag, invoiceCommit: invoice.attestation.invoiceCommit, salt: noteSalt },
});
