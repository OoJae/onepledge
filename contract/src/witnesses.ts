// SPDX-License-Identifier: Apache-2.0
// Private-state witnesses for the OnePledge registry. Everything here stays on the prover's
// machine; the circuit only publishes what `disclose()` marks.

import { type WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { type Ledger, pureCircuits } from './managed/registry/contract/index.js';

export type Point = { x: bigint; y: bigint };

export type SchnorrSignature = { announcement: Point; response: bigint };

export type Attestation = {
  tag: Uint8Array;
  invoiceCommit: Uint8Array;
  /** Face value in grosz, signed by the tag authority. Bound into the note, never published. */
  amount: bigint;
  acceptanceDay: bigint;
  /** Unix seconds (a whole UTC day); the pledge fails once the block time reaches it. */
  expiresAt: bigint;
  borrower: Uint8Array;
  signature: SchnorrSignature;
};

export type NoteOpening = {
  tag: Uint8Array;
  invoiceCommit: Uint8Array;
  /** Face value in grosz, as attested. Bound into the note commitment, never published. */
  amount: bigint;
  salt: Uint8Array;
};

/**
 * One secret per party (registrar, borrower or lender). Role keys are derived from it with
 * domain-separated hashes inside the circuit, so no role ever uses ownPublicKey().
 */
export type OnePledgePrivateState = {
  readonly secretKey: Uint8Array;
  /** Borrower: the attestation for the receivable being pledged next. */
  readonly attestation?: Attestation;
  /** Borrower: the lender key the next pledge targets (used to find its registry path). */
  readonly pledgeLender?: Uint8Array;
  /** Borrower: salt for the next pledge note. */
  readonly noteSalt?: Uint8Array;
  /** Lender: opening of the note being released. */
  readonly releaseNote?: NoteOpening;
  /** Lender: the four note openings a borrowing-base draw is proven over. */
  readonly pool?: readonly NoteOpening[];
};

const TWO_248 = 452312848583266388373324160190187140051835877600158453279131187530910662656n;

type Ctx = WitnessContext<Ledger, OnePledgePrivateState>;

const require32 = (name: string, value: Uint8Array | undefined): Uint8Array => {
  if (!value || value.length !== 32) throw new Error(`${name} is missing or not 32 bytes`);
  return value;
};

/** The pool size the circuit is compiled for. Larger books run a draw per round over a rolling four. */
export const POOL_SIZE = 4;

const requirePool = (pool: readonly NoteOpening[] | undefined): NoteOpening[] => {
  if (!pool || pool.length !== POOL_SIZE) {
    throw new Error(`A borrowing-base pool needs exactly ${POOL_SIZE} note openings`);
  }
  return [...pool];
};

export const witnesses = {
  localSecretKey: ({ privateState }: Ctx): [OnePledgePrivateState, Uint8Array] => [
    privateState,
    require32('secretKey', privateState.secretKey),
  ],

  getAttestation: ({ privateState }: Ctx): [OnePledgePrivateState, Attestation] => {
    if (!privateState.attestation) throw new Error('No attestation loaded for this pledge');
    return [privateState, privateState.attestation];
  },

  getLenderPath: ({ privateState, ledger }: Ctx) => {
    const lender = require32('pledgeLender', privateState.pledgeLender);
    const path = ledger.lenders.findPathForLeaf(lender);
    if (!path) throw new Error('Lender is not in the registry');
    return [privateState, path] as [OnePledgePrivateState, typeof path];
  },

  getNoteSalt: ({ privateState }: Ctx): [OnePledgePrivateState, Uint8Array] => [
    privateState,
    require32('noteSalt', privateState.noteSalt),
  ],

  getNoteOpening: ({ privateState }: Ctx): [OnePledgePrivateState, [Uint8Array, Uint8Array, bigint, Uint8Array]] => {
    const n = privateState.releaseNote;
    if (!n) throw new Error('No note opening loaded for this release');
    return [privateState, [n.tag, n.invoiceCommit, n.amount, n.salt]];
  },

  /** The acting party's leaf in the current committee epoch. A rotated-out member has no leaf for
   *  the current epoch, so this throws before a proof is even attempted. */
  getRegistrarPath: ({ privateState, ledger }: Ctx) => {
    const key = pureCircuits.registrarKey(require32('secretKey', privateState.secretKey));
    const leaf = pureCircuits.committeeLeaf(ledger.committeeEpoch, key);
    const path = ledger.registrars.findPathForLeaf(leaf);
    if (!path) throw new Error('Not a member of the current registrar committee');
    return [privateState, path] as [OnePledgePrivateState, typeof path];
  },

  getNotePath: ({ privateState, ledger }: Ctx) => {
    const n = privateState.releaseNote;
    if (!n) throw new Error('No note opening loaded for this release');
    const lender = pureCircuits.lenderKey(require32('secretKey', privateState.secretKey));
    const note = pureCircuits.noteCommitment(n.tag, lender, n.invoiceCommit, n.amount, n.salt);
    const path = ledger.notes.findPathForLeaf(note);
    if (!path) throw new Error('Pledge note not found on the ledger');
    return [privateState, path] as [OnePledgePrivateState, typeof path];
  },

  getPool: ({ privateState }: Ctx): [OnePledgePrivateState, NoteOpening[]] => [
    privateState,
    requirePool(privateState.pool),
  ],

  getPoolPaths: ({ privateState, ledger }: Ctx) => {
    const lender = pureCircuits.lenderKey(require32('secretKey', privateState.secretKey));
    const paths = requirePool(privateState.pool).map((n, i) => {
      const note = pureCircuits.noteCommitment(n.tag, lender, n.invoiceCommit, n.amount, n.salt);
      const path = ledger.notes.findPathForLeaf(note);
      if (!path) throw new Error(`Pool item ${i} is not a pledge note on the ledger`);
      return path;
    });
    return [privateState, paths] as [OnePledgePrivateState, typeof paths];
  },

  getSchnorrReduction: ({ privateState }: Ctx, challengeHash: bigint): [OnePledgePrivateState, [bigint, bigint]] => [
    privateState,
    [challengeHash / TWO_248, challengeHash % TWO_248],
  ],
};
