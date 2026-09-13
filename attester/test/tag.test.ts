// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { syntheticKsefNumber } from '../src/ksef.js';
import { invoiceCommitment, newSalt, receivableTag, verifyInvoiceOpening, type InvoiceFields } from '../src/tag.js';

const key = () => new Uint8Array(randomBytes(32));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const number = syntheticKsefNumber('5265877635', '2026-08-14', '0000000000A1');

const fields: InvoiceFields = {
  ksefNumber: number,
  sellerNip: '5265877635',
  debtorNip: '7010002139',
  amountGrosz: '12500000',
  currency: 'PLN',
  dueDate: '2026-11-12',
};

describe('receivable tag', () => {
  it('is deterministic for one authority and invoice', () => {
    const k = key();
    expect(hex(receivableTag(k, number))).toBe(hex(receivableTag(k, number)));
  });

  it('is 32 bytes', () => {
    expect(receivableTag(key(), number)).toHaveLength(32);
  });

  it('differs across authorities, so nobody without the secret can predict it', () => {
    expect(hex(receivableTag(key(), number))).not.toBe(hex(receivableTag(key(), number)));
  });

  it('differs across invoices', () => {
    const k = key();
    const other = syntheticKsefNumber('5265877635', '2026-08-14', '0000000000A2');
    expect(hex(receivableTag(k, number))).not.toBe(hex(receivableTag(k, other)));
  });

  it('refuses non-canonical spellings instead of producing a second tag', () => {
    const k = key();
    expect(() => receivableTag(k, number.toLowerCase())).toThrow();
    expect(() => receivableTag(k, number.replaceAll('-', ''))).toThrow();
  });

  it('ignores surrounding whitespace (same tag)', () => {
    const k = key();
    expect(hex(receivableTag(k, ` ${number} `))).toBe(hex(receivableTag(k, number)));
  });

  it('rejects a short tag secret', () => {
    expect(() => receivableTag(new Uint8Array(16), number)).toThrow(/at least 32 bytes/);
  });
});

describe('invoice commitment', () => {
  it('opens with the right fields and salt', () => {
    const salt = newSalt();
    const c = invoiceCommitment(fields, salt);
    expect(verifyInvoiceOpening(c, fields, salt)).toBe(true);
  });

  it('is hiding: same fields, fresh salt, different commitment', () => {
    expect(hex(invoiceCommitment(fields, newSalt()))).not.toBe(hex(invoiceCommitment(fields, newSalt())));
  });

  it.each(Object.keys(fields) as (keyof InvoiceFields)[])('fails to open if %s is changed', (field) => {
    const salt = newSalt();
    const c = invoiceCommitment(fields, salt);
    const tampered = { ...fields, [field]: field === 'currency' ? 'EUR' : `${fields[field]}0` } as InvoiceFields;
    expect(verifyInvoiceOpening(c, tampered, salt)).toBe(false);
  });

  it('fails to open with the wrong salt', () => {
    const c = invoiceCommitment(fields, newSalt());
    expect(verifyInvoiceOpening(c, fields, newSalt())).toBe(false);
  });

  it('rejects a salt that is not 32 bytes', () => {
    expect(() => invoiceCommitment(fields, new Uint8Array(31))).toThrow(/32 bytes/);
  });
});
