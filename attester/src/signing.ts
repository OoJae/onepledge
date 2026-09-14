// SPDX-License-Identifier: Apache-2.0
// Jubjub Schnorr signing for tag-authority attestations. The message is computed with the
// contract's own pure circuits, so the bytes the signer hashes are exactly what the circuit hashes.
// Signing scheme adapted from midnightntwrk/example-zkloan (Apache-2.0).

import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { ecAdd, ecMul, ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { Registry, type Attestation, type Point, type SchnorrSignature } from '@onepledge/contract';

export const JUBJUB_ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const TWO_248 = 452312848583266388373324160190187140051835877600158453279131187530910662656n;
const DAY_SECONDS = 86_400n;

const mod = (a: bigint, m: bigint) => ((a % m) + m) % m;

/** Uniform scalar in [1, order): 64 extra bits of randomness make the modular bias negligible. */
export const randomScalar = (): bigint => {
  const v = BigInt(`0x${bytesToHex(randomBytes(40))}`);
  return mod(v, JUBJUB_ORDER - 1n) + 1n;
};

/** A signing key must be a non-zero scalar below the group order; anything else is rejected. */
export const assertSigningKey = (sk: bigint): bigint => {
  if (sk <= 0n || sk >= JUBJUB_ORDER) throw new Error('Signing key must satisfy 0 < sk < Jubjub order');
  return sk;
};

export const publicKeyOf = (sk: bigint): Point => ecMulGenerator(assertSigningKey(sk));

export const isIdentity = (p: Point): boolean => p.x === 0n && p.y === 1n;

/** Contract addresses are 32-byte hex strings; the circuit sees their raw bytes via kernel.self(). */
export const addressBytes = (address: string): Uint8Array => {
  const bytes = hexToBytes(address.replace(/^0x/, ''));
  if (bytes.length !== 32) throw new Error('Contract address must be 32 bytes');
  return bytes;
};

/** Expiry is published by the pledge, so it is rounded up to a whole UTC day to avoid fingerprinting. */
export const roundUpToDay = (unixSeconds: bigint): bigint => ((unixSeconds + DAY_SECONDS - 1n) / DAY_SECONDS) * DAY_SECONDS;

const challenge = (R: Point, pk: Point, msg: bigint[]) =>
  Registry.pureCircuits.schnorrChallenge(R.x, R.y, pk.x, pk.y, msg) % TWO_248;

export const sign = (sk: bigint, msg: bigint[]): SchnorrSignature => {
  if (msg.length !== 1) throw new Error('OnePledge attestations sign exactly one digest field');
  const secret = assertSigningKey(sk);
  const pk = ecMulGenerator(secret);
  const k = randomScalar();
  const R = ecMulGenerator(k);
  return { announcement: R, response: mod(k + challenge(R, pk, msg) * secret, JUBJUB_ORDER) };
};

export interface AttestationRequest {
  /** Address of the registry deployment this attestation is valid for. */
  readonly registry: Uint8Array;
  readonly tag: Uint8Array;
  readonly invoiceCommit: Uint8Array;
  readonly acceptanceDay: number;
  /** Unix seconds; rounded up to the next whole UTC day. */
  readonly expiresAt: bigint;
  readonly borrower: Uint8Array;
}

const messageFor = (registry: Uint8Array, a: Omit<Attestation, 'signature'>) =>
  Registry.pureCircuits.attestationMessage(registry, a.tag, a.invoiceCommit, a.acceptanceDay, a.expiresAt, a.borrower);

export const attest = (authoritySk: bigint, req: AttestationRequest): Attestation => {
  const body = {
    tag: req.tag,
    invoiceCommit: req.invoiceCommit,
    acceptanceDay: BigInt(req.acceptanceDay),
    expiresAt: roundUpToDay(req.expiresAt),
    borrower: req.borrower,
  };
  return { ...body, signature: sign(authoritySk, messageFor(req.registry, body)) };
};

/**
 * Off-chain check a lender runs before funding: does this attestation carry a valid signature from
 * the registry's tag authority, for this registry? Mirrors the circuit's checks exactly.
 */
export const verifyAttestation = (authority: Point, registry: Uint8Array, att: Attestation): boolean => {
  if (isIdentity(authority)) return false;
  const { announcement: R, response: s } = att.signature;
  if (s < 0n || s >= JUBJUB_ORDER) return false;
  try {
    const c = challenge(R, authority, messageFor(registry, att));
    const lhs = ecMulGenerator(s);
    const rhs = ecAdd(R, ecMul(authority, c));
    return lhs.x === rhs.x && lhs.y === rhs.y;
  } catch {
    return false;
  }
};
