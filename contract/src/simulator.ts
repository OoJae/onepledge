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

export class RegistrySimulator {
  readonly contract: Contract<OnePledgePrivateState, WitnessSet>;
  context: CircuitContext<OnePledgePrivateState>;
  lastResult?: CircuitResults<OnePledgePrivateState, unknown>;

  constructor(
    registrarSecret: Uint8Array,
    authority: Point,
    windowStart: bigint,
    windowEnd: bigint,
    witnessOverrides: Partial<WitnessSet> = {},
  ) {
    this.contract = new Contract<OnePledgePrivateState, WitnessSet>({ ...witnesses, ...witnessOverrides });
    const init = this.contract.initialState(
      createConstructorContext<OnePledgePrivateState>({ secretKey: registrarSecret }, COIN_PUBLIC_KEY),
      authority,
      windowStart,
      windowEnd,
    );
    this.context = createCircuitContext(
      sampleContractAddress(),
      init.currentZswapLocalState,
      init.currentContractState,
      init.currentPrivateState,
    );
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

  admitLender(lender: Uint8Array): void {
    this.run((ctx) => this.contract.impureCircuits.admitLender(ctx, lender));
  }

  rotateRegistrar(next: Uint8Array): void {
    this.run((ctx) => this.contract.impureCircuits.rotateRegistrar(ctx, next));
  }

  pledge(lender: Uint8Array): Uint8Array {
    return this.run((ctx) => this.contract.impureCircuits.pledge(ctx, lender));
  }

  release(): void {
    this.run((ctx) => this.contract.impureCircuits.release(ctx));
  }

  static readonly pure = pureCircuits;
}
