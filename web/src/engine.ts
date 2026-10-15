// SPDX-License-Identifier: Apache-2.0
// Drives the real compiled registry circuits in the browser (in-memory ledger, no proofs, no chain)
// for the walkthrough. Every accept/reject shown in the UI comes from the circuit itself.

import {
  attest,
  invoiceCommitment,
  lenderEncryptionKey,
  newSalt,
  openDelivery,
  parseKsefNumber,
  publicKeyOf,
  randomScalar,
  receivableTag,
  sealOpening,
  syntheticKsefNumber,
  type InvoiceFields,
  verifyInvoiceOpening,
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

/** One receivable in lender A's book, as the inbox decrypted it. */
export interface BookItem {
  opening: { tag: Uint8Array; invoiceCommit: Uint8Array; amount: bigint; salt: Uint8Array };
}

export interface PublicView {
  pledgeCount: bigint;
  releaseCount: bigint;
  acceptCount: bigint;
  declineCount: bigint;
  drawCount: bigint;
  tags: string[];
  noteCount: bigint;
  lastTranscriptOps: number;
}

export class Walkthrough {
  readonly sim: RegistrySimulator;
  readonly authority = { sk: randomScalar(), tagSecret: secret() };
  /** The three registrar seats. Two of them have to agree before a lender is admitted. */
  readonly committee = [secret(), secret(), secret()];
  readonly registrar = this.committee[0];
  readonly borrower = secret();
  readonly lenderA = secret();
  readonly lenderB = secret();
  /** A lender nobody has admitted yet, so the committee act has something to decide about. */
  readonly lenderC = secret();
  readonly invoice: InvoiceFields;
  readonly invoiceSalt = newSalt();
  readonly attestation: Attestation;
  noteSalt = newSalt();
  /** Lender A's book, built by the borrowing-base act. */
  book: BookItem[] = [];

  constructor() {
    this.sim = new RegistrySimulator(
      this.registrar,
      publicKeyOf(this.authority.sk),
      day('2026-07-01'),
      day('2027-01-01'),
      {},
      { committee: this.committee },
    );
    this.sim.as({ secretKey: this.registrar });
    this.sim.admitLender(Registry.pureCircuits.lenderKey(this.lenderA), lenderEncryptionKey(this.lenderA));
    this.sim.admitLender(Registry.pureCircuits.lenderKey(this.lenderB), lenderEncryptionKey(this.lenderB));

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
    amount: BigInt(this.invoice.amountGrosz),
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
      () =>
        this.sim.pledge(
          Registry.pureCircuits.lenderKey(lenderSecret),
          sealOpening(lenderEncryptionKey(lenderSecret), {
            tag: attestation.tag,
            invoiceCommit: attestation.invoiceCommit,
            amount: attestation.amount,
            salt: this.noteSalt,
          }),
        ),
      `Pledged to lender ${lender}`,
    );
  }

  /** The lender of record takes the pledge. Until this runs, a pledge is a one-sided claim. */
  decideByA(decision: 'accept' | 'decline', noteSalt: Uint8Array): Outcome {
    this.asLenderA(noteSalt);
    return decision === 'accept'
      ? this.attempt(() => this.sim.acceptPledge(), 'Accepted by lender A')
      : this.attempt(() => this.sim.declinePledge(), 'Declined by lender A; the receivable is free again');
  }

  private asLenderA(noteSalt: Uint8Array): void {
    this.sim.as({
      secretKey: this.lenderA,
      releaseNote: {
        tag: this.attestation.tag,
        invoiceCommit: this.attestation.invoiceCommit,
        amount: this.attestation.amount,
        salt: noteSalt,
      },
    });
  }

  releaseByA(noteSalt: Uint8Array): Outcome {
    this.sim.as({
      secretKey: this.lenderA,
      releaseNote: {
        tag: this.attestation.tag,
        invoiceCommit: this.attestation.invoiceCommit,
        amount: this.attestation.amount,
        salt: noteSalt,
      },
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

  // --- The registrar committee -----------------------------------------------------------------

  /** Seat `seat` approves admitting lender C. Nothing on chain says which seat it was. */
  approveAdmitC(seat: number): Outcome {
    this.sim.as({ secretKey: this.committee[seat] });
    return this.attempt(
      () => this.sim.approveAdmit(Registry.pureCircuits.lenderKey(this.lenderC), lenderEncryptionKey(this.lenderC)),
      `Registrar ${seat + 1} approves; the ledger records an approval that names no seat`,
    );
  }

  /** Anyone may carry out an admission once it has enough approvals. */
  executeAdmitC(): Outcome {
    return this.attempt(
      () => this.sim.executeAdmit(Registry.pureCircuits.lenderKey(this.lenderC), lenderEncryptionKey(this.lenderC)),
      'Lender C admitted',
    );
  }

  /** How many approvals the pending admission of lender C has gathered. */
  approvalsForC(): number {
    const l = this.sim.ledger();
    const action = Registry.pureCircuits.admitAction(
      l.committeeEpoch,
      Registry.pureCircuits.lenderKey(this.lenderC),
      lenderEncryptionKey(this.lenderC),
    );
    return l.proposals.member(action) ? Number(l.proposals.lookup(action).size()) : 0;
  }

  committeeView(): { epoch: bigint; threshold: bigint; seats: number; admitted: number } {
    const l = this.sim.ledger();
    return { epoch: l.committeeEpoch, threshold: l.threshold, seats: 3, admitted: Number(l.lenders.firstFree()) };
  }

  // --- The borrowing base ----------------------------------------------------------------------

  /**
   * Four more receivables pledged to lender A, each with its opening sealed to it. The lender then
   * finds them the way it would on chain: by trying to decrypt every delivery, keeping what opens.
   * That scan is the inbox, and its output is the pool the draw proof is built from.
   */
  buildBook(): Outcome {
    const amounts = ['3150000', '2480000', '5090000', '1760000'];
    const sealedNotes: Uint8Array[] = [];
    for (const [i, amountGrosz] of amounts.entries()) {
      const ksef = syntheticKsefNumber('5265877635', `2026-09-${String(20 + i).padStart(2, '0')}`, hex(randomBytes(6)).toUpperCase());
      const parsed = parseKsefNumber(ksef);
      const fields: InvoiceFields = {
        ksefNumber: parsed.canonical,
        sellerNip: parsed.sellerNip,
        debtorNip: '7010002139',
        amountGrosz,
        currency: 'PLN',
        dueDate: '2026-12-15',
      };
      const invoiceSalt = newSalt();
      const attestation = attest(this.authority.sk, {
        amount: BigInt(amountGrosz),
        registry: this.sim.addressBytes(),
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400),
        tag: receivableTag(this.authority.tagSecret, parsed.canonical),
        invoiceCommit: invoiceCommitment(fields, invoiceSalt),
        acceptanceDay: parsed.acceptanceDay,
        borrower: Registry.pureCircuits.borrowerKey(this.borrower),
      });
      const noteSalt = newSalt();
      this.sim.as({
        secretKey: this.borrower,
        attestation,
        pledgeLender: Registry.pureCircuits.lenderKey(this.lenderA),
        noteSalt,
      });
      const outcome = this.attempt(
        () =>
          sealedNotes.push(
            this.sim.pledge(
              Registry.pureCircuits.lenderKey(this.lenderA),
              sealOpening(lenderEncryptionKey(this.lenderA), {
                tag: attestation.tag,
                invoiceCommit: attestation.invoiceCommit,
                amount: attestation.amount,
                salt: noteSalt,
              }),
            ),
          ),
        '',
      );
      if (!outcome.ok) return outcome;
    }

    // The inbox scan. No delivery says who it is for, so the lender tries them all.
    const scanned = [...this.sim.ledger().deliveries]
      .map(([, ciphertext]) => openDelivery(this.lenderA, ciphertext))
      .filter((o): o is NonNullable<typeof o> => o !== undefined);
    this.book = scanned.map((opening) => ({ opening }));
    return {
      ok: true,
      detail: `Lender A scanned ${this.sim.ledger().deliveries.size()} deliveries and opened ${scanned.length}`,
    };
  }

  bookTotal(): bigint {
    return this.pool().reduce((sum, n) => sum + n.amount, 0n);
  }

  /** The four most recent openings: the pool size the circuit is compiled for. */
  private pool() {
    return this.book.slice(-4).map((b) => b.opening);
  }

  proveBase(floor: bigint, round = 'onepledge:walkthrough'): Outcome {
    const pool = this.pool();
    if (pool.length < 4) return { ok: false, detail: 'A borrowing-base pool needs four receivables' };
    this.sim.as({ secretKey: this.lenderA, pool });
    const roundBytes = new Uint8Array(32);
    roundBytes.set(new TextEncoder().encode(round).slice(0, 32));
    return this.attempt(
      () => this.sim.proveBorrowingBase(roundBytes, floor),
      `Proved a borrowing base of at least ${(Number(floor) / 100).toLocaleString('pl-PL')} zł`,
    );
  }

  drawView(): { count: bigint; floors: string[] } {
    const l = this.sim.ledger();
    return { count: l.drawCount, floors: [...l.draws].map(([, r]) => r.floor.toString()) };
  }

  publicView(): PublicView {
    const l = this.sim.ledger();
    return {
      pledgeCount: l.pledgeCount,
      releaseCount: l.releaseCount,
      acceptCount: l.acceptCount,
      declineCount: l.declineCount,
      drawCount: l.drawCount,
      tags: [...l.tags].map(hex),
      noteCount: l.notes.firstFree(),
      lastTranscriptOps: this.sim.lastResult?.proofData.publicTranscript.length ?? 0,
    };
  }
}
