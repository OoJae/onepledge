// SPDX-License-Identifier: Apache-2.0
// Multi-signature contract maintenance for the OnePledge registry.
//
// WHY THIS FILE EXISTS
// --------------------
// A deployed Midnight contract has a *contract maintenance authority* (CMA): the committee of
// signature-verifying keys allowed to insert or remove the contract's verifier keys, or to replace
// the authority itself. midnight-js 4.1.1 can only ever drive a 1-of-1 CMA:
// `submitReplaceAuthorityTx` takes a single `signingKey`, hands it to compact-js's
// `ContractExecutable.replaceContractMaintenanceAuthority`, and gets back a `MaintenanceUpdate`
// carrying exactly one signature at index 0. So the moment a 2-of-3 authority is installed,
// midnight-js can no longer authorise ANY maintenance transaction for that contract. The installer
// and this assembler therefore have to ship together: one without the other bricks the upgrade path.
//
// Everything below works one level under midnight-js, on the ledger types directly, and is the only
// supported way to authorise maintenance for a threshold authority.
//
// WHICH MODULE EXPORTS WHAT (verified against the .d.ts files, not assumed)
// ------------------------------------------------------------------------
// `@midnight-ntwrk/midnight-js-protocol/ledger` re-exports `@midnight-ntwrk/ledger-v8` wholesale,
// and that is where `MaintenanceUpdate`, `ReplaceAuthority`, `VerifierKeyInsert`,
// `VerifierKeyRemove`, `ContractOperationVersion`, `ContractOperationVersionedVerifierKey`,
// `Intent`, `Transaction` AND a second copy of `ContractMaintenanceAuthority` all live. It is also
// the path `web/src/wallet/providers.ts` already uses, so we use it here.
//
// This matters: `ContractMaintenanceAuthority` exists TWICE in the dependency tree -- once in
// onchain-runtime-v3 (re-exported by `@midnight-ntwrk/compact-runtime`) and once in ledger-v8.
// They are classes in two separate WASM modules and are not interchangeable. The authority we
// *read* off chain comes back inside an onchain-runtime-v3 `ContractState`, but every authority we
// *construct* to put inside a `ReplaceAuthority` must be the ledger-v8 class. We therefore never
// pass a read authority straight back into an update; we destructure it into plain values
// (`SigningKey`, `SignatureVerifyingKey` and `Signature` are all plain `string`, and `committee` is
// a `string[]`) and rebuild. Crossing the two WASM boundaries with an object is the kind of bug
// that only shows up at submit time.

import {
  ContractMaintenanceAuthority,
  ContractOperationVersion,
  ContractOperationVersionedVerifierKey,
  Intent,
  MaintenanceUpdate,
  ReplaceAuthority,
  Transaction,
  VerifierKeyInsert,
  VerifierKeyRemove,
  signData,
  signatureVerifyingKey,
  verifySignature,
  type ContractAddress,
  type Signature,
  type SignatureVerifyingKey,
  type SigningKey,
  type SingleUpdate,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { submitTx } from '@midnight-ntwrk/midnight-js-contracts';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { RegistryProviders } from './providers.js';

/** The on-chain maintenance authority, reduced to plain values that cross module boundaries safely. */
export interface Authority {
  /** Signature-verifying keys, in committee order. `addSignature`'s index is an index into THIS array. */
  readonly committee: readonly SignatureVerifyingKey[];
  /** How many of those keys must sign a maintenance update. */
  readonly threshold: number;
  /** Replay-protection counter. A `MaintenanceUpdate` is valid only against this exact value. */
  readonly counter: bigint;
  /** e.g. "2-of-3, counter 1". For logs and operator confirmation prompts. */
  readonly summary: string;
}

/** One signer's contribution: which committee seat it is, and the key that fills that seat. */
export interface Signer {
  /** Position in `Authority.committee`. NOT an arbitrary label -- a wrong index invalidates the update. */
  readonly index: number;
  readonly signingKey: SigningKey;
}

/** What `signUpdate` needs in order to refuse an under-signed or mis-indexed update. */
export interface SigningPolicy {
  readonly threshold: number;
  readonly committeeSize: number;
}

const describe = (committee: readonly SignatureVerifyingKey[], threshold: number, counter: bigint) =>
  `${threshold}-of-${committee.length}, counter ${counter}`;

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/** First 12 hex characters of a key, for logs. Verifying keys are public; this is only for brevity. */
export const shortKey = (key: string) => key.slice(0, 12);

/**
 * Read the live maintenance authority for a contract.
 *
 * The `ContractState` the indexer returns is an onchain-runtime-v3 object, so we copy the authority
 * out into plain values immediately (see the module header).
 */
export const readAuthority = async (
  providers: Pick<RegistryProviders, 'publicDataProvider'>,
  address: ContractAddress,
): Promise<Authority> => {
  const state = await providers.publicDataProvider.queryContractState(address);
  if (!state) throw new Error(`No contract state on chain for ${address}`);
  const authority = state.maintenanceAuthority;
  const committee = [...authority.committee] as SignatureVerifyingKey[];
  const threshold = Number(authority.threshold);
  const counter = BigInt(authority.counter);
  return { committee, threshold, counter, summary: describe(committee, threshold, counter) };
};

/**
 * Build an unsigned maintenance update.
 *
 * `counter` is the authority's CURRENT counter -- the update is replay-protected against the
 * authority as it stands right now. It is not the counter of whatever the update installs.
 * See `replaceAuthorityUpdate` for the pair of counters in one transaction.
 */
export const buildUpdate = (
  address: ContractAddress,
  updates: SingleUpdate[],
  counter: bigint,
): MaintenanceUpdate => {
  if (updates.length === 0) throw new Error('A maintenance update must carry at least one instruction');
  if (counter < 0n) throw new Error(`Counter must be non-negative, got ${counter}`);
  return new MaintenanceUpdate(address, updates, counter);
};

/**
 * Attach one signature per signer, each at its committee index.
 *
 * Refuses, before signing anything, to produce an update that cannot possibly be accepted:
 *   - fewer signers than `policy.threshold`
 *   - two signers claiming the same committee index
 *   - an index outside `[0, policy.committeeSize)`
 *
 * It also ASSERTS, rather than assumes, that `dataToSign` is stable across `addSignature`. The
 * whole design depends on it: we sign the bytes once and hand them to every signer independently
 * (which is what a real 2-of-3 does -- three people on three machines). If adding a signature
 * perturbed `dataToSign`, every signature after the first would be over stale bytes and would have
 * to be recomputed in order, so we would rather fail loudly here than submit an invalid update.
 */
export const signUpdate = (
  update: MaintenanceUpdate,
  signers: readonly Signer[],
  policy: SigningPolicy,
): MaintenanceUpdate => {
  if (policy.committeeSize <= 0) throw new Error(`Committee size must be positive, got ${policy.committeeSize}`);
  if (policy.threshold <= 0) throw new Error(`Threshold must be positive, got ${policy.threshold}`);
  if (policy.threshold > policy.committeeSize) {
    throw new Error(
      `Threshold ${policy.threshold} exceeds committee size ${policy.committeeSize}: nobody could ever sign`,
    );
  }
  if (signers.length < policy.threshold) {
    throw new Error(
      `Refusing to sign: ${signers.length} signer(s) for a threshold of ${policy.threshold}. ` +
        'An under-signed maintenance update is rejected by the node.',
    );
  }
  const seen = new Set<number>();
  for (const { index } of signers) {
    if (!Number.isInteger(index) || index < 0 || index >= policy.committeeSize) {
      throw new Error(
        `Committee index ${index} is outside the committee [0, ${policy.committeeSize}). ` +
          "addSignature's idx is a position in the committee array, not a label.",
      );
    }
    if (seen.has(index)) {
      throw new Error(`Duplicate committee index ${index}: one seat cannot contribute twice to the threshold`);
    }
    seen.add(index);
  }

  // Copy out of WASM memory once: this is the payload every signer signs.
  const dataToSign = new Uint8Array(update.dataToSign);
  let signed = update;
  for (const { index, signingKey } of signers) {
    const signature = signData(signingKey, dataToSign);
    signed = signed.addSignature(BigInt(index), signature);
    if (!sameBytes(dataToSign, new Uint8Array(signed.dataToSign))) {
      throw new Error(
        'MaintenanceUpdate.dataToSign changed after addSignature. Independent parallel signing is ' +
          'unsound on this ledger version; signatures must be produced sequentially over the ' +
          'latest dataToSign. Fix committee.ts before submitting anything.',
      );
    }
  }
  return signed;
};

/**
 * Check an assembled update the way the node will: every signature must verify against the
 * committee key at the index it was filed under, and there must be at least `threshold` of them.
 *
 * Used as a pre-flight before submitting, and -- more importantly -- by `install-committee.ts` to
 * prove it actually holds the keys of the committee it is about to install. Installing a committee
 * nobody can sign for is the one unrecoverable mistake available here.
 */
export const verifyUpdateSignatures = (
  update: MaintenanceUpdate,
  committee: readonly SignatureVerifyingKey[],
  threshold: number,
): { ok: boolean; verified: number; problems: string[] } => {
  const dataToSign = new Uint8Array(update.dataToSign);
  const problems: string[] = [];
  // Distinct SEATS, not signatures. `signUpdate` already rejects duplicate indices, but this
  // function is also the pre-flight for an update assembled by hand from signatures collected off
  // three machines -- which is the whole point of a 2-of-3 -- and there `addSignature` is called
  // directly, with nothing stopping the same seat being filed twice. Counting signatures rather
  // than seats would report a 2-of-3 satisfied by one signer twice, which the node would refuse.
  const seats = new Set<number>();
  for (const [idx, signature] of update.signatures as [bigint, Signature][]) {
    const i = Number(idx);
    const vk = committee[i];
    if (vk === undefined) {
      problems.push(`signature filed at index ${i}, but the committee has only ${committee.length} seat(s)`);
      continue;
    }
    if (seats.has(i)) {
      problems.push(`two signatures filed at committee index ${i}: one seat counts once towards the threshold`);
      continue;
    }
    if (verifySignature(vk, dataToSign, signature)) seats.add(i);
    else problems.push(`signature at index ${i} does not verify against committee key ${shortKey(vk)}`);
  }
  const verified = seats.size;
  if (verified < threshold) problems.push(`${verified} valid signature(s) for a threshold of ${threshold}`);
  return { ok: problems.length === 0, verified, problems };
};

/** `signatureVerifyingKey` for each signing key, in order: the committee to install. */
export const committeeFromSigningKeys = (signingKeys: readonly SigningKey[]): SignatureVerifyingKey[] =>
  signingKeys.map((sk) => signatureVerifyingKey(sk));

/**
 * THE TWO COUNTERS. This is the single most dangerous detail in the whole flow, so both live here,
 * in one function, and nowhere else.
 *
 *   - The `MaintenanceUpdate` carries `current.counter` -- the CURRENT value. That is replay
 *     protection for this update: the node checks it against the authority on chain as it stands.
 *   - The new `ContractMaintenanceAuthority` inside the `ReplaceAuthority` carries
 *     `current.counter + 1n`. `ContractMaintenanceAuthority`'s own doc comment is explicit: at
 *     deployment the counter must be 0n, and any subsequent update must set it to exactly one
 *     greater than the current value.
 *
 * Swap them and the node either rejects the update, or -- worse -- accepts one whose counter breaks
 * the next update, which on a frozen 2-of-3 is unrecoverable.
 *
 * Measured on the local devnet by `rehearse-committee.ts`: the ledger increments the authority's
 * counter on EVERY applied maintenance update, not only on a `ReplaceAuthority`. One run went
 * 0 (deployed) -> 1 (ReplaceAuthority) -> 2 (VerifierKeyRemove) -> 3 (VerifierKeyInsert), and the
 * F70 repair on Preprod went 0 -> 1 (VerifierKeyRemove) -> 2 (VerifierKeyInsert) with no
 * `ReplaceAuthority` anywhere in it, which confirms the same on a public network. So
 * "current + 1" here is the same value the ledger would have reached on its own, and callers must
 * always re-read the authority with `readAuthority` immediately before building each update rather
 * than keeping a counter in a variable across two submissions.
 */
export const replaceAuthorityUpdate = (
  address: ContractAddress,
  current: Pick<Authority, 'counter'>,
  nextCommittee: readonly SignatureVerifyingKey[],
  nextThreshold: number,
): MaintenanceUpdate => {
  if (nextCommittee.length === 0) throw new Error('Refusing to install an empty committee');
  if (nextThreshold <= 0 || nextThreshold > nextCommittee.length) {
    throw new Error(
      `Refusing to install threshold ${nextThreshold} over ${nextCommittee.length} key(s): ` +
        'a threshold above the committee size makes the contract permanently unmaintainable',
    );
  }
  const nextAuthority = new ContractMaintenanceAuthority(
    [...nextCommittee],
    nextThreshold,
    current.counter + 1n, // the NEW authority's counter: current + 1
  );
  return buildUpdate(
    address,
    [new ReplaceAuthority(nextAuthority)],
    current.counter, // the UPDATE's counter: current, unchanged
  );
};

/** A `VerifierKeyRemove` for one circuit at the only exposed operation version, v3. */
export const removeVerifierKey = (circuit: string): VerifierKeyRemove =>
  new VerifierKeyRemove(circuit, new ContractOperationVersion('v3'));

/** A `VerifierKeyInsert` for one circuit, from the raw bytes of a committed `.verifier` file. */
export const insertVerifierKey = (circuit: string, rawVk: Uint8Array): VerifierKeyInsert =>
  new VerifierKeyInsert(circuit, new ContractOperationVersionedVerifierKey('v3', rawVk));

/**
 * Wrap a signed update in an Intent and a Transaction and submit it.
 *
 * `submitTx` proves, balances through the wallet and submits. Proving is a no-op for a maintenance
 * update -- it carries no ZK proof and no `circuitId` -- but balancing is not: the transaction
 * still pays DUST fees, and hand-rolling that is how you lose an afternoon.
 */
export const submitUpdate = async (
  providers: RegistryProviders,
  update: MaintenanceUpdate,
  opts: { ttl?: Date } = {},
) => {
  const ttl = opts.ttl ?? new Date(Date.now() + 60 * 60 * 1000);
  const intent = Intent.new(ttl).addMaintenanceUpdate(update);
  const unprovenTx = Transaction.fromParts(getNetworkId(), undefined, undefined, intent);
  return submitTx(providers as never, { unprovenTx } as never);
};

export type { ContractAddress, MaintenanceUpdate, Signature, SignatureVerifyingKey, SigningKey, SingleUpdate };
