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
}

export class RegistrySimulator {
  readonly contract: Contract<OnePledgePrivateState, WitnessSet>;
  readonly address: string;
  context: CircuitContext<OnePledgePrivateState>;
  lastResult?: CircuitResults<OnePledgePrivateState, unknown>;

  constructor(
    registrarSecret: Uint8Array,
    authority: Point,
    windowStart: bigint,
    windowEnd: bigint,
    witnessOverrides: Partial<WitnessSet> = {},
    options: SimulatorOptions = {},
  ) {
    this.address = options.address ?? sampleContractAddress();
    this.contract = new Contract<OnePledgePrivateState, WitnessSet>({ ...witnesses, ...witnessOverrides });
    const init = this.contract.initialState(
      createConstructorContext<OnePledgePrivateState>({ secretKey: registrarSecret }, COIN_PUBLIC_KEY),
      authority,
      windowStart,
      windowEnd,
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
