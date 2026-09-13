// SPDX-License-Identifier: Apache-2.0
// Off-chain signature checks. The in-circuit verification is covered by the contract tests;
// these check the signer's arithmetic against the same Schnorr equation using compact-runtime.

import { describe, expect, it } from 'vitest';
import { ecAdd, ecMul, ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { Registry } from '@onepledge/contract';
import { JUBJUB_ORDER, publicKeyOf, randomScalar, sign } from '../src/signing.js';

const TWO_248 = 452312848583266388373324160190187140051835877600158453279131187530910662656n;

const verify = (pk: { x: bigint; y: bigint }, msg: bigint[], sig: ReturnType<typeof sign>) => {
  const c = Registry.pureCircuits.schnorrChallenge(sig.announcement.x, sig.announcement.y, pk.x, pk.y, msg) % TWO_248;
  const lhs = ecMulGenerator(sig.response);
  const rhs = ecAdd(sig.announcement, ecMul(pk, c));
  return lhs.x === rhs.x && lhs.y === rhs.y;
};

const msg = () => [1n, 2n, 3n, 4n, 5n];

describe('Schnorr signer', () => {
  it('produces signatures that satisfy the verification equation', () => {
    const sk = randomScalar();
    const m = msg();
    expect(verify(publicKeyOf(sk), m, sign(sk, m))).toBe(true);
  });

  it('keeps the response inside the Jubjub scalar field', () => {
    for (let i = 0; i < 20; i++) {
      const s = sign(randomScalar(), msg()).response;
      expect(s >= 0n && s < JUBJUB_ORDER).toBe(true);
    }
  });

  it('uses a fresh nonce for every signature', () => {
    const sk = randomScalar();
    const a = sign(sk, msg());
    const b = sign(sk, msg());
    expect(a.announcement).not.toEqual(b.announcement);
  });

  it('does not verify under a different key or message', () => {
    const sk = randomScalar();
    const sig = sign(sk, msg());
    expect(verify(publicKeyOf(randomScalar()), msg(), sig)).toBe(false);
    expect(verify(publicKeyOf(sk), [1n, 2n, 3n, 4n, 6n], sig)).toBe(false);
  });

  it('only signs 5-field attestation messages', () => {
    expect(() => sign(randomScalar(), [1n, 2n])).toThrow(/exactly 5 fields/);
  });

  it('draws scalars in [1, order)', () => {
    for (let i = 0; i < 50; i++) {
      const k = randomScalar();
      expect(k > 0n && k < JUBJUB_ORDER).toBe(true);
    }
  });
});
