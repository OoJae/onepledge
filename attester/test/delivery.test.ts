// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { randomBytes } from '@noble/hashes/utils.js';
import { lenderEncryptionKey, lenderEncryptionKeypair, openDelivery, sealOpening } from '../src/delivery.js';

const opening = () => ({
  tag: randomBytes(32),
  invoiceCommit: randomBytes(32),
  amount: 12_500_000n,
  salt: randomBytes(32),
});

describe('encrypted delivery', () => {
  it('round-trips an opening to the lender of record', () => {
    const lender = randomBytes(32);
    const o = opening();
    const opened = openDelivery(lender, sealOpening(lenderEncryptionKey(lender), o));
    expect(opened).toBeDefined();
    expect(opened!.tag).toEqual(o.tag);
    expect(opened!.invoiceCommit).toEqual(o.invoiceCommit);
    expect(opened!.amount).toBe(o.amount);
    expect(opened!.salt).toEqual(o.salt);
  });

  it('preserves a full 64-bit amount', () => {
    const lender = randomBytes(32);
    const o = { ...opening(), amount: 18_446_744_073_709_551_615n };
    expect(openDelivery(lender, sealOpening(lenderEncryptionKey(lender), o))!.amount).toBe(o.amount);
  });

  it('tells another lender nothing', () => {
    const [a, b] = [randomBytes(32), randomBytes(32)];
    expect(openDelivery(b, sealOpening(lenderEncryptionKey(a), opening()))).toBeUndefined();
  });

  it('returns undefined for garbage rather than throwing, so a scan never breaks', () => {
    const lender = randomBytes(32);
    expect(openDelivery(lender, randomBytes(120))).toBeUndefined();
    expect(openDelivery(lender, new Uint8Array())).toBeUndefined();
    expect(openDelivery(lender, randomBytes(8))).toBeUndefined();
  });

  it('rejects a tampered ciphertext', () => {
    const lender = randomBytes(32);
    const sealed = sealOpening(lenderEncryptionKey(lender), opening());
    sealed[sealed.length - 1] ^= 0xff;
    expect(openDelivery(lender, sealed)).toBeUndefined();
  });

  it('shares no bytes between two deliveries to the same lender', () => {
    // Otherwise the map could be grouped by recipient, which is the leak this design avoids.
    const lender = randomBytes(32);
    const key = lenderEncryptionKey(lender);
    const o = opening();
    const first = sealOpening(key, o);
    const second = sealOpening(key, o);
    expect(first).not.toEqual(second);
    expect(first.slice(0, 32)).not.toEqual(second.slice(0, 32));
  });

  it('derives the lender keypair deterministically from the secret it already holds', () => {
    const lender = randomBytes(32);
    expect(lenderEncryptionKeypair(lender).publicKey).toEqual(lenderEncryptionKeypair(lender).publicKey);
    expect(lenderEncryptionKey(lender)).not.toEqual(lenderEncryptionKey(randomBytes(32)));
    expect(lenderEncryptionKey(lender)).toHaveLength(32);
  });

  it('refuses a malformed secret or recipient key', () => {
    expect(() => lenderEncryptionKeypair(randomBytes(16))).toThrow(/32 bytes/);
    expect(() => sealOpening(randomBytes(16), opening())).toThrow(/32 bytes/);
  });
});
