// SPDX-License-Identifier: Apache-2.0
// A naive "hash of invoice fields" registry, the design OnePledge replaces. Used only to show its
// two failure modes side by side with the real registry.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export interface NaiveInvoice {
  invoiceNo: string;
  supplier: string;
  amount: string;
  dueDate: string;
}

export const naiveHash = (i: NaiveInvoice) =>
  bytesToHex(sha256(utf8ToBytes(`${i.invoiceNo}|${i.supplier}|${i.amount}|${i.dueDate}`)));

export class NaiveRegistry {
  private readonly entries = new Map<string, { pledgedOn: string }>();

  pledge(i: NaiveInvoice, pledgedOn: string): boolean {
    const h = naiveHash(i);
    if (this.entries.has(h)) return false;
    this.entries.set(h, { pledgedOn });
    return true;
  }

  /** Anyone can run this: the registry is public. */
  lookup(i: NaiveInvoice) {
    return this.entries.get(naiveHash(i));
  }

  get size() {
    return this.entries.size;
  }

  hashes() {
    return [...this.entries.keys()];
  }
}

/** Same invoice, written the way a different bank's system would store it. */
export const reformat = (i: NaiveInvoice): NaiveInvoice => ({
  invoiceNo: i.invoiceNo.replaceAll('/', '-'),
  supplier: i.supplier.startsWith('PL') ? i.supplier.slice(2) : `PL${i.supplier}`,
  amount: i.amount.includes('.') ? i.amount.replace(/\.00$/, '') : `${i.amount}.00`,
  dueDate: i.dueDate,
});
