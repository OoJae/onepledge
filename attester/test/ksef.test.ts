// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { KsefNumberError, crc8, dayFromIso, isValidNip, parseKsefNumber, syntheticKsefNumber } from '../src/ksef.js';

// The worked example from the Ministry of Finance specification (CIRFMF/ksef-api, numer-ksef.md).
const OFFICIAL = '5265877635-20250826-0100001AF629-AF';

describe('KSeF number parsing', () => {
  it('accepts the official specification example', () => {
    const n = parseKsefNumber(OFFICIAL);
    expect(n).toMatchObject({
      canonical: OFFICIAL,
      sellerNip: '5265877635',
      acceptanceDate: '2025-08-26',
      technical: '0100001AF629',
      checksum: 'AF',
    });
    expect(n.acceptanceDay).toBe(dayFromIso('2025-08-26'));
  });

  it('computes CRC-8 (poly 0x07, init 0x00) matching the example', () => {
    expect(crc8('5265877635-20250826-0100001AF629')).toBe(0xaf);
    expect(crc8('123456789')).toBe(0xf4); // standard CRC-8 check value
  });

  it('tolerates surrounding whitespace only', () => {
    expect(parseKsefNumber(`  ${OFFICIAL}\n`).canonical).toBe(OFFICIAL);
  });

  it.each([
    ['lowercase hex', OFFICIAL.toLowerCase()],
    ['missing dashes', OFFICIAL.replaceAll('-', '')],
    ['too short', OFFICIAL.slice(0, 34)],
    ['too long', `${OFFICIAL}0`],
    ['inner space', OFFICIAL.replace('-', ' ')],
  ])('rejects %s', (_label, value) => {
    expect(() => parseKsefNumber(value)).toThrow(KsefNumberError);
  });

  it('rejects a wrong checksum', () => {
    expect(() => parseKsefNumber(OFFICIAL.replace(/AF$/, 'AE'))).toThrow(/CRC-8 mismatch/);
  });

  it('rejects a single flipped technical character even with the old checksum', () => {
    expect(() => parseKsefNumber(OFFICIAL.replace('0100001AF629', '0100001AF628'))).toThrow(/CRC-8 mismatch/);
  });

  it('rejects a seller NIP with a bad check digit', () => {
    const bad = syntheticKsefNumber('5265877636', '2025-08-26', '0100001AF629');
    expect(() => parseKsefNumber(bad)).toThrow(/check digit/);
  });

  it('rejects impossible calendar dates', () => {
    const bad = syntheticKsefNumber('5265877635', '2026-02-30', '0100001AF629');
    expect(() => parseKsefNumber(bad)).toThrow(/Invalid acceptance date/);
  });
});

describe('NIP check digit', () => {
  it('validates known-good NIPs', () => {
    expect(isValidNip('5265877635')).toBe(true);
    expect(isValidNip('7010002139')).toBe(true);
  });

  it('rejects wrong length, non-digits and bad check digits', () => {
    expect(isValidNip('526587763')).toBe(false);
    expect(isValidNip('52658776AA')).toBe(false);
    expect(isValidNip('5265877630')).toBe(false);
  });
});

describe('synthetic numbers', () => {
  it('round-trips through the parser', () => {
    const n = syntheticKsefNumber('7010002139', '2026-08-14', 'abc123def456');
    const parsed = parseKsefNumber(n);
    expect(parsed.technical).toBe('ABC123DEF456');
    expect(parsed.acceptanceDate).toBe('2026-08-14');
  });

  it('reproduces the official example exactly', () => {
    expect(syntheticKsefNumber('5265877635', '2025-08-26', '0100001AF629')).toBe(OFFICIAL);
  });
});
