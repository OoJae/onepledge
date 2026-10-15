// SPDX-License-Identifier: Apache-2.0
// KSeF invoice numbers (Poland's national e-invoicing system).
// Format, per the Ministry of Finance spec (github.com/CIRFMF/ksef-api, faktury/numer-ksef.md):
//   NNNNNNNNNN-YYYYMMDD-TTTTTTTTTTTT-CC   (35 characters)
//   N = seller NIP (10 digits), YYYYMMDD = acceptance date, T = 12 uppercase hex chars,
//   CC = CRC-8 (poly 0x07, init 0x00) of the first 32 characters, as 2 uppercase hex chars.
//
// KSeF 1.0 spelled the same twelve technical characters with an inner dash, and the ministry's
// OpenAPI still accepts it (`([0-9A-F]{6})-?([0-9A-F]{6})`, maxLength 36) for backward compatibility.
// Two spellings of one invoice is exactly what OnePledge exists to prevent, so the 36-character form is
// normalized to 35 here and both yield the same tag. The checksum is only defined over the 35-character
// form, so normalization always happens before the CRC is checked — never validate the 36-char form in
// place. (The ministry's own C# validator rejects 36 outright, so their spec and their SDK disagree.)

export interface KsefNumber {
  /** Canonical form: exactly as issued by KSeF (uppercase, 35 characters). */
  readonly canonical: string;
  readonly sellerNip: string;
  /** ISO date (YYYY-MM-DD) the invoice was accepted by KSeF. */
  readonly acceptanceDate: string;
  /** Acceptance date as whole days since 1970-01-01 (UTC). */
  readonly acceptanceDay: number;
  readonly technical: string;
  readonly checksum: string;
}

export class KsefNumberError extends Error {}

const PATTERN = /^(\d{10})-(\d{4})(\d{2})(\d{2})-([0-9A-F]{6})-?([0-9A-F]{6})-([0-9A-F]{2})$/;
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];
const MS_PER_DAY = 86_400_000;

export const crc8 = (data: string): number => {
  let crc = 0;
  for (const byte of new TextEncoder().encode(data)) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
};

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/** Polish NIP check digit: weighted sum of the first 9 digits mod 11 must equal the 10th. */
export const isValidNip = (nip: string): boolean => {
  if (!/^\d{10}$/.test(nip)) return false;
  const sum = NIP_WEIGHTS.reduce((acc, w, i) => acc + w * Number(nip[i]), 0);
  const check = sum % 11;
  return check !== 10 && check === Number(nip[9]);
};

export interface ParseOptions {
  /**
   * Validate the seller NIP's check digit. Production KSeF guarantees it, but the ministry documents
   * NIP checksum validation as production-only and tells integrators to use random NIPs on TEST, where
   * roughly ten in eleven fail mod-11. Leave it on for real invoices; turn it off for test fixtures.
   */
  readonly strictNip?: boolean;
}

export const parseKsefNumber = (input: string, options: ParseOptions = {}): KsefNumber => {
  // Surrounding whitespace and the KSeF 1.0 inner dash are tolerated; everything else (lowercase,
  // other missing dashes) is rejected, so one invoice has exactly one canonical spelling.
  const raw = input.trim();
  if (raw.length !== 35 && raw.length !== 36) {
    throw new KsefNumberError(`KSeF number must be 35 or 36 characters, got ${raw.length}`);
  }
  const m = PATTERN.exec(raw);
  if (!m) throw new KsefNumberError('KSeF number does not match NIP-YYYYMMDD-HEX12-CRC');
  const [, nip, yyyy, mm, dd, techA, techB, checksum] = m;
  const technical = `${techA}${techB}`;
  // Canonical form is always 35 characters, whichever spelling arrived.
  const value = `${nip}-${yyyy}${mm}${dd}-${technical}-${checksum}`;
  if ((options.strictNip ?? true) && !isValidNip(nip)) {
    throw new KsefNumberError(`Seller NIP ${nip} fails its check digit`);
  }

  const time = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd));
  const date = new Date(time);
  if (date.getUTCFullYear() !== Number(yyyy) || date.getUTCMonth() !== Number(mm) - 1 || date.getUTCDate() !== Number(dd)) {
    throw new KsefNumberError(`Invalid acceptance date ${yyyy}-${mm}-${dd}`);
  }
  const expected = hex2(crc8(value.slice(0, 32)));
  if (expected !== checksum) throw new KsefNumberError(`CRC-8 mismatch: expected ${expected}, got ${checksum}`);

  return {
    canonical: value,
    sellerNip: nip,
    acceptanceDate: `${yyyy}-${mm}-${dd}`,
    acceptanceDay: time / MS_PER_DAY,
    technical,
    checksum,
  };
};

/**
 * Builds a well-formed KSeF number for demos and tests. Clearly synthetic: real numbers are
 * assigned by KSeF, never by OnePledge.
 */
export const syntheticKsefNumber = (sellerNip: string, acceptanceDate: string, technical: string): string => {
  const data = `${sellerNip}-${acceptanceDate.replaceAll('-', '')}-${technical.toUpperCase()}`;
  return `${data}-${hex2(crc8(data))}`;
};

export const dayFromIso = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY;
