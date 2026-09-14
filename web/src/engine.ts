// SPDX-License-Identifier: Apache-2.0
// Drives the real compiled registry circuits in the browser (in-memory ledger, no proofs, no chain)
// for the walkthrough. Every accept/reject shown in the UI comes from the circuit itself.

import {
  attest,
  invoiceCommitment,
  newSalt,
  parseKsefNumber,
  publicKeyOf,
  randomScalar,
  receivableTag,
  syntheticKsefNumber,
  verifyInvoiceOpening,
  type InvoiceFields,
} from '@onepledge/attester';
import { Registry, RegistrySimulator, type Attestation } from '@onepledge/contract';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';

const secret = () => randomBytes(32);
const day = (iso: string) => BigInt(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

export const hex = (b: Uint8Array) => bytesToHex(b);
export const short = (b: Uint8Array | string) => {
  const h = typeof b === 'string' ? b : hex(b);
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
};

export type Outcome = { ok: true; detail: string } | { ok: false; detail: string };

export interface PublicView {
  pledgeCount: bigint;
  releaseCount: bigint;
  tags: string[];
  noteCount: bigint;
  lastTranscriptOps: number;
}

export class Walkthrough {
  readonly sim: RegistrySimulator;
  readonly authority = { sk: randomScalar(), tagSecret: secret() };
  readonly registrar = secret();
  readonly borrower = secret();
  readonly lenderA = secret();
  readonly lenderB = secret();
  readonly invoice: InvoiceFields;
  readonly invoiceSalt = newSalt();
  readonly attestation: Attestation;
  noteSalt = newSalt();

  constructor() {
    this.sim = new RegistrySimulator(this.registrar, publicKeyOf(this.authority.sk), day('2026-07-01'), day('2027-01-01'));
    this.sim.as({ secretKey: this.registrar });
    this.sim.admitLender(Registry.pureCircuits.lenderKey(this.lenderA));
    this.sim.admitLender(Registry.pureCircuits.lenderKey(this.lenderB));

    const ksef = syntheticKsefNumber('5265877635', '2026-09-10', hex(randomBytes(6)).toUpperCase());
    const parsed = parseKsefNumber(ksef);
    this.invoice = {
      ksefNumber: parsed.canonical,
      sellerNip: parsed.sellerNip,
      debtorNip: '7010002139',
      amountGrosz: '12500000',
      currency: 'PLN',
      dueDate: '2026-11-30',
    };
    this.attestation = this.attestFresh();
  }

  /** The tag authority attests the invoice (again). Same invoice, same tag, fresh signature. */
  attestFresh(): Attestation {
    const parsed = parseKsefNumber(this.invoice.ksefNumber);
    return attest(this.authority.sk, {
      registry: this.sim.addressBytes(),
      expiresAt: BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400),
      tag: receivableTag(this.authority.tagSecret, parsed.canonical),
      invoiceCommit: invoiceCommitment(this.invoice, this.invoiceSalt),
      acceptanceDay: parsed.acceptanceDay,
      borrower: Registry.pureCircuits.borrowerKey(this.borrower),
    });
  }

  private attempt(fn: () => void, okDetail: string): Outcome {
    try {
      fn();
      return { ok: true, detail: okDetail };
    } catch (e) {
      const message = (e as Error).message;
      const reason = /failed assert: (.*)/.exec(message)?.[1] ?? message;
      return { ok: false, detail: reason };
    }
  }

  pledgeTo(lender: 'A' | 'B'): Outcome {
    const lenderSecret = lender === 'A' ? this.lenderA : this.lenderB;
    const attestation = this.attestFresh();
    this.noteSalt = newSalt();
    this.sim.as({
      secretKey: this.borrower,
      attestation,
      pledgeLender: Registry.pureCircuits.lenderKey(lenderSecret),
      noteSalt: this.noteSalt,
    });
    return this.attempt(
      () => this.sim.pledge(Registry.pureCircuits.lenderKey(lenderSecret)),
      `Pledged to lender ${lender}`,
    );
  }

  releaseByA(noteSalt: Uint8Array): Outcome {
    this.sim.as({
      secretKey: this.lenderA,
      releaseNote: { tag: this.attestation.tag, invoiceCommit: this.attestation.invoiceCommit, salt: noteSalt },
    });
    return this.attempt(() => this.sim.release(), 'Released by lender A');
  }

  /** A lender given the tag checks the public set locally. Nobody learns that it asked. */
  encumbered(): boolean {
    return this.sim.ledger().tags.member(this.attestation.tag);
  }

  lenderAOpensInvoice(): boolean {
    return verifyInvoiceOpening(this.attestation.invoiceCommit, this.invoice, this.invoiceSalt);
  }

  publicView(): PublicView {
    const l = this.sim.ledger();
    return {
      pledgeCount: l.pledgeCount,
      releaseCount: l.releaseCount,
      tags: [...l.tags].map(hex),
      noteCount: l.notes.firstFree(),
      lastTranscriptOps: this.sim.lastResult?.proofData.publicTranscript.length ?? 0,
    };
  }
}
