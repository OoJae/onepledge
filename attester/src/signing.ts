// SPDX-License-Identifier: Apache-2.0
// Jubjub Schnorr signing for tag-authority attestations. The challenge is computed with the
// contract's own pure circuits, so the bytes the signer hashes are exactly what the circuit hashes.
// Signing scheme adapted from midnightntwrk/example-zkloan (Apache-2.0).

import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { Registry, type Attestation, type Point, type SchnorrSignature } from '@onepledge/contract';

export const JUBJUB_ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const TWO_248 = 452312848583266388373324160190187140051835877600158453279131187530910662656n;

const mod = (a: bigint, m: bigint) => ((a % m) + m) % m;

/** Uniform scalar in [1, order): rejection-free via 64 extra bits of randomness. */
export const randomScalar = (): bigint => {
  const v = BigInt(`0x${bytesToHex(randomBytes(40))}`);
  return mod(v, JUBJUB_ORDER - 1n) + 1n;
};

export const publicKeyOf = (sk: bigint): Point => ecMulGenerator(mod(sk, JUBJUB_ORDER));

export const sign = (sk: bigint, msg: bigint[]): SchnorrSignature => {
  if (msg.length !== 5) throw new Error('OnePledge attestations sign exactly 5 fields');
  const secret = mod(sk, JUBJUB_ORDER);
  const pk = ecMulGenerator(secret);
  const k = randomScalar();
  const R = ecMulGenerator(k);
  const c = Registry.pureCircuits.schnorrChallenge(R.x, R.y, pk.x, pk.y, msg) % TWO_248;
  return { announcement: R, response: mod(k + c * secret, JUBJUB_ORDER) };
};

export interface AttestationRequest {
  readonly tag: Uint8Array;
  readonly invoiceCommit: Uint8Array;
  readonly acceptanceDay: number;
  readonly borrower: Uint8Array;
}

export const attest = (authoritySk: bigint, req: AttestationRequest): Attestation => {
  const acceptanceDay = BigInt(req.acceptanceDay);
  const msg = Registry.pureCircuits.attestationMessage(req.tag, req.invoiceCommit, acceptanceDay, req.borrower);
  return {
    tag: req.tag,
    invoiceCommit: req.invoiceCommit,
    acceptanceDay,
    borrower: req.borrower,
    signature: sign(authoritySk, msg),
  };
};
