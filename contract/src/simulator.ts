// SPDX-License-Identifier: Apache-2.0
// In-process simulator for the registry (tests and the browser demo): runs the compiled circuits against an in-memory ledger,
// switching the private state to act as the registrar, a borrower, or a lender.

import {
  type CircuitContext,
  type CircuitResults,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, type Ledger, ledger, pureCircuits } from './managed/registry/contract/index.js';
import { type OnePledgePrivateState, type Point, witnesses } from './witnesses.js';

type WitnessSet = typeof witnesses;

export const COIN_PUBLIC_KEY = '0'.repeat(64);

export interface SimulatorOptions {
  /** Contract address (32-byte hex). Defaults to a sample address. */
  readonly address?: string;
  /** Block time in unix seconds. Defaults to the wall clock. */
  readonly time?: number;
  /** The three registrar-committee secrets. Defaults to the deployer's secret plus two fresh ones,
   *  so a test that does not care about the committee still has a quorum to call. */
  readonly committee?: readonly Uint8Array[];
}

export class RegistrySimulator {
  readonly contract: Contract<OnePledgePrivateState, WitnessSet>;
  readonly address: string;
  /** The committee secrets this world was deployed with, so tests can act as any member. */
  committeeSecrets: readonly Uint8Array[];
  context: CircuitContext<OnePledgePrivateState>;
  lastResult?: CircuitResults<OnePledgePrivateState, unknown>;

  constructor(
    /** The deployer's secret. It is no longer the registrar: `committee` decides that. */
    registrarSecret: Uint8Array,
    authority: Point,
    windowStart: bigint,
    windowEnd: bigint,
    witnessOverrides: Partial<WitnessSet> = {},
    options: SimulatorOptions = {},
  ) {
    this.address = options.address ?? sampleContractAddress();
    this.contract = new Contract<OnePledgePrivateState, WitnessSet>({ ...witnesses, ...witnessOverrides });
    // globalThis.crypto, not node:crypto: the web walkthrough runs this simulator in the browser.
    const committee =
      options.committee ??
      [registrarSecret, ...[1, 2].map(() => crypto.getRandomValues(new Uint8Array(32)))];
    this.committeeSecrets = committee;
    const init = this.contract.initialState(
      createConstructorContext<OnePledgePrivateState>({ secretKey: registrarSecret }, COIN_PUBLIC_KEY),
      authority,
      windowStart,
      windowEnd,
      committee.map((sk) => pureCircuits.registrarKey(sk)),
    );
    this.context = createCircuitContext(
      this.address,
      init.currentZswapLocalState,
      init.currentContractState,
      init.currentPrivateState,
      undefined,
      undefined,
      options.time,
    );
  }

  /** The address as the raw bytes the circuit reads through kernel.self(). */
  addressBytes(): Uint8Array {
    const hex = this.address.replace(/^0x/, '');
    return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
  }

  /** Move the simulated block time (unix seconds). */
  setTime(unixSeconds: number): this {
    const q = this.context.currentQueryContext;
    q.block = { ...q.block, secondsSinceEpoch: BigInt(unixSeconds) };
    return this;
  }

  /** Swap the acting party's private state (the ledger is shared). */
  as(state: OnePledgePrivateState): this {
    this.context = { ...this.context, currentPrivateState: state };
    return this;
  }

  ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }

  private run<R>(fn: (ctx: CircuitContext<OnePledgePrivateState>) => CircuitResults<OnePledgePrivateState, R>): R {
    const result = fn(this.context);
    this.lastResult = result;
    this.context = result.context;
    return result.result;
  }

  approveAdmit(lender: Uint8Array, encryptionKey: Uint8Array = new Uint8Array(32)): void {
    this.run((ctx) => this.contract.impureCircuits.approveAdmit(ctx, lender, encryptionKey));
  }

  executeAdmit(lender: Uint8Array, encryptionKey: Uint8Array = new Uint8Array(32)): void {
    this.run((ctx) => this.contract.impureCircuits.executeAdmit(ctx, lender, encryptionKey));
  }

  approveRotate(members: readonly Uint8Array[]): void {
    this.run((ctx) => this.contract.impureCircuits.approveRotate(ctx, [...members]));
  }

  executeRotate(members: readonly Uint8Array[]): void {
    this.run((ctx) => this.contract.impureCircuits.executeRotate(ctx, [...members]));
  }

  /**
   * Admit a lender the way a 2-of-3 committee does: two members approve, then anyone executes.
   * encryptionKey defaults to zeros: tests that exercise authorization do not care about it, and
   * the real callers (CLI, web) always pass the lender's derived key.
   */
  admitLender(lender: Uint8Array, encryptionKey: Uint8Array = new Uint8Array(32)): void {
    const acting = this.context.currentPrivateState;
    for (const sk of this.committeeSecrets.slice(0, 2)) {
      this.as({ secretKey: sk });
      this.approveAdmit(lender, encryptionKey);
    }
    this.as(acting);
    this.executeAdmit(lender, encryptionKey);
  }

  /** Rotate the committee the way a 2-of-3 does, and track the new secrets. */
  rotateCommittee(next: readonly Uint8Array[]): void {
    const members = next.map((sk) => pureCircuits.registrarKey(sk));
    const acting = this.context.currentPrivateState;
    for (const sk of this.committeeSecrets.slice(0, 2)) {
      this.as({ secretKey: sk });
      this.approveRotate(members);
    }
    this.as(acting);
    this.executeRotate(members);
    this.committeeSecrets = next;
  }

  proveBorrowingBase(round: Uint8Array, floor: bigint): void {
    this.run((ctx) => this.contract.impureCircuits.proveBorrowingBase(ctx, round, floor));
  }

  pledge(lender: Uint8Array, delivery: Uint8Array = new Uint8Array()): Uint8Array {
    return this.run((ctx) => this.contract.impureCircuits.pledge(ctx, lender, delivery));
  }

  release(): void {
    this.run((ctx) => this.contract.impureCircuits.release(ctx));
  }

  acceptPledge(): void {
    this.run((ctx) => this.contract.impureCircuits.acceptPledge(ctx));
  }

  declinePledge(): void {
    this.run((ctx) => this.contract.impureCircuits.declinePledge(ctx));
  }

  static readonly pure = pureCircuits;
}
