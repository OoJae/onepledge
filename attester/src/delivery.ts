// SPDX-License-Identifier: Apache-2.0
// Encrypted delivery of a note opening from the borrower to the lender of record.
//
// Why this exists: the pledge note on chain is an opaque hash. A lender knows only its own key and
// cannot brute-force the tag, the invoice commitment or the salt, so before Wave 2 the opening had
// to reach it out of band. Publishing a per-lender index instead would let anyone holding a lender's
// key link that lender's whole book, which is the property OnePledge sells. So the borrower encrypts
// the opening and the lender finds its own by trying every delivery, the way shielded protocols do.
// The ciphertext carries no recipient hint: nothing on chain says who a delivery is for.
//
// The lender's keypair is derived from the secret it already holds, not from its wallet: a wallet
// will not decrypt arbitrary payloads, so the shielded encryption key cannot be used for this.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/** Structural copy of the contract's NoteOpening: attester must not depend on contract, which its
 *  own tests already depend on. */
export type NoteOpening = {
  readonly tag: Uint8Array;
  readonly invoiceCommit: Uint8Array;
  readonly amount: bigint;
  readonly salt: Uint8Array;
};

const KEY_DOMAIN = 'onepledge:lender-enc:v1';
const SHARED_DOMAIN = 'onepledge:delivery:v1';
const NONCE_BYTES = 24;

/** A lender's encryption keypair, derived deterministically from the secret it already holds. */
export const lenderEncryptionKeypair = (lenderSecret: Uint8Array): { secret: Uint8Array; publicKey: Uint8Array } => {
  if (lenderSecret.length !== 32) throw new Error('Lender secret must be 32 bytes');
  const secret = sha256(concatBytes(utf8ToBytes(`${KEY_DOMAIN}|`), lenderSecret));
  return { secret, publicKey: x25519.getPublicKey(secret) };
};

export const lenderEncryptionKey = (lenderSecret: Uint8Array): Uint8Array =>
  lenderEncryptionKeypair(lenderSecret).publicKey;

/** Opening on the wire: tag ‖ invoiceCommit ‖ amount (8 bytes, big-endian) ‖ salt. */
const encodeOpening = (o: NoteOpening): Uint8Array => {
  const amount = new Uint8Array(8);
  new DataView(amount.buffer).setBigUint64(0, o.amount, false);
  return concatBytes(o.tag, o.invoiceCommit, amount, o.salt);
};

const decodeOpening = (b: Uint8Array): NoteOpening => {
  if (b.length !== 104) throw new Error(`Opening must be 104 bytes, got ${b.length}`);
  return {
    tag: b.slice(0, 32),
    invoiceCommit: b.slice(32, 64),
    amount: new DataView(b.buffer, b.byteOffset + 64, 8).getBigUint64(0, false),
    salt: b.slice(72, 104),
  };
};

const sharedKey = (secret: Uint8Array, publicKey: Uint8Array): Uint8Array =>
  sha256(concatBytes(utf8ToBytes(`${SHARED_DOMAIN}|`), x25519.getSharedSecret(secret, publicKey)));

/**
 * Encrypts an opening to a lender. A fresh ephemeral key each time means two deliveries to the same
 * lender share no bytes, so the map cannot be grouped by recipient.
 */
export const sealOpening = (lenderEncryptionPublicKey: Uint8Array, opening: NoteOpening): Uint8Array => {
  if (lenderEncryptionPublicKey.length !== 32) throw new Error('Lender encryption key must be 32 bytes');
  const ephemeralSecret = x25519.utils.randomSecretKey();
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = xchacha20poly1305(sharedKey(ephemeralSecret, lenderEncryptionPublicKey), nonce).encrypt(
    encodeOpening(opening),
  );
  return concatBytes(x25519.getPublicKey(ephemeralSecret), nonce, sealed);
};

/**
 * Tries to open one delivery. Returns undefined when this lender is not the recipient, which is the
 * normal case: a lender scans every delivery and keeps the ones that open.
 */
export const openDelivery = (lenderSecret: Uint8Array, delivery: Uint8Array): NoteOpening | undefined => {
  if (delivery.length < 32 + NONCE_BYTES) return undefined;
  const { secret } = lenderEncryptionKeypair(lenderSecret);
  try {
    const plaintext = xchacha20poly1305(
      sharedKey(secret, delivery.slice(0, 32)),
      delivery.slice(32, 32 + NONCE_BYTES),
    ).decrypt(delivery.slice(32 + NONCE_BYTES));
    return decodeOpening(plaintext);
  } catch {
    // Wrong recipient, or a borrower posted garbage. Both look the same from here, by design.
    return undefined;
  }
};
