// SPDX-License-Identifier: Apache-2.0
// Receivable tags and invoice commitments, computed by the tag authority.

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { parseKsefNumber } from './ksef.js';

const TAG_DOMAIN = 'onepledge:tag:v1';
const INVOICE_DOMAIN = 'onepledge:invoice:v1';

/**
 * T = HMAC-SHA256(tagSecret, domain || canonical KSeF number).
 *
 * Deterministic for a given authority and invoice, so the same invoice always yields the same
 * tag no matter who asks or how many times. Without the secret, nobody can compute T from a
 * guessed invoice number, which is what stops public brute-force of the tag set.
 *
 * Corrections must be tagged by their ROOT invoice number (the invoice they correct), otherwise
 * a correction could be pledged separately from the original.
 */
export const receivableTag = (tagSecret: Uint8Array, rootKsefNumber: string): Uint8Array => {
  if (tagSecret.length < 32) throw new Error('Tag secret must be at least 32 bytes');
  const { canonical } = parseKsefNumber(rootKsefNumber);
  return hmac(sha256, tagSecret, utf8ToBytes(`${TAG_DOMAIN}|${canonical}`));
};

export interface InvoiceFields {
  readonly ksefNumber: string;
  readonly sellerNip: string;
  readonly debtorNip: string;
  /** Amount in grosz (1/100 PLN) as a decimal string, to avoid float rounding. */
  readonly amountGrosz: string;
  readonly currency: 'PLN' | 'EUR';
  readonly dueDate: string;
}

/** Canonical encoding: fixed key order, no whitespace. */
const encodeFields = (f: InvoiceFields): string =>
  JSON.stringify([f.ksefNumber, f.sellerNip, f.debtorNip, f.amountGrosz, f.currency, f.dueDate]);

export const newSalt = (): Uint8Array => randomBytes(32);

/** Hiding commitment to the invoice fields; the opening (fields + salt) goes only to the lender. */
export const invoiceCommitment = (fields: InvoiceFields, salt: Uint8Array): Uint8Array => {
  if (salt.length !== 32) throw new Error('Salt must be 32 bytes');
  return sha256(concatBytes(utf8ToBytes(`${INVOICE_DOMAIN}|${encodeFields(fields)}|`), salt));
};

export const verifyInvoiceOpening = (commit: Uint8Array, fields: InvoiceFields, salt: Uint8Array): boolean => {
  const expected = invoiceCommitment(fields, salt);
  return expected.length === commit.length && expected.every((b, i) => b === commit[i]);
};
