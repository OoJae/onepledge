// SPDX-License-Identifier: Apache-2.0
// Every test here is offline. `fetch` is a required constructor argument with no fallback to
// `globalThis.fetch`, so a test that forgot its stub fails to compile rather than quietly reaching
// the Polish Ministry of Finance.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KsefNumberError, dayFromIso, syntheticKsefNumber } from '../src/ksef.js';
import {
  KSEF_TEST_BASE_URL,
  KsefAcceptanceDateMismatchError,
  KsefApiError,
  type KsefFetch,
  KsefHttpStatusError,
  type KsefHttpResponse,
  KsefMalformedResponseError,
  KsefTokenRequiredError,
  KsefTransportError,
  ksefClient,
} from '../src/ksef-client.js';

const OFFICIAL = '5265877635-20250826-0100001AF629-AF';
const LEGACY = '5265877635-20250826-010000-1AF629-AF';
const TOKEN = 'fixture-only-not-a-real-jwt';
const METADATA_URL = `${KSEF_TEST_BASE_URL}/invoices/query/metadata?pageOffset=0&pageSize=10`;

interface Fixture {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Loads a fixture and refuses one that does not declare itself hand-authored.
 *
 * The `provenance` block is load-bearing rather than decorative: nothing in this suite can quietly
 * pass itself off as a capture from a live KSeF run, because a file claiming `recorded: true` fails
 * here until someone actually records it and says which environment and date it came from. A
 * fixture that pretends to be a recording is worse than no fixture at all.
 */
const fixture = (name: string): Fixture => {
  const url = new URL(`./fixtures/ksef/${name}.json`, import.meta.url);
  const raw = JSON.parse(readFileSync(url, 'utf8')) as {
    provenance?: { recorded?: unknown; note?: unknown };
    status?: unknown;
    body?: unknown;
  };
  if (raw.provenance?.recorded !== false) {
    throw new Error(`${name}.json must declare provenance.recorded === false until it is a real recording`);
  }
  if (typeof raw.status !== 'number') throw new Error(`${name}.json must declare the HTTP status it stands for`);
  return { status: raw.status, body: raw.body };
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** A non-JSON body, for the cases where there is no contract shape to author a fixture from. */
const raw = (status: number, text: string) => ({ status, text });

/**
 * A stub `fetch` that answers from a queue and records what it was asked. Running out of queued
 * responses throws, so a test that expects one request cannot pass while the client makes three.
 */
const stub = (...queued: Array<Fixture | Error | { status: number; text: string }>) => {
  const calls: Call[] = [];
  const pending = [...queued];
  const fetch: KsefFetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const next = pending.shift();
    if (next === undefined) throw new Error(`stub fetch called ${calls.length} times; only ${queued.length} queued`);
    if (next instanceof Error) throw next;
    const response: KsefHttpResponse =
      'text' in next
        ? { status: next.status, text: async () => next.text }
        : { status: next.status, text: async () => JSON.stringify(next.body) };
    return response;
  };
  return { fetch, calls };
};

describe('the injected fetch', () => {
  it('accepts the platform fetch without a cast, so production needs no shim', () => {
    // Compile-time assertion: KsefFetch is a real structural slice of WHATWG fetch, not a toy
    // interface only a stub can satisfy. Never called — this suite makes no network request.
    const platform: KsefFetch = globalThis.fetch;
    expect(typeof platform).toBe('function');
  });

  it('defaults to the TEST environment and trims a trailing slash', () => {
    const { fetch } = stub();
    expect(ksefClient({ fetch }).baseUrl).toBe(KSEF_TEST_BASE_URL);
    expect(ksefClient({ fetch, baseUrl: `${KSEF_TEST_BASE_URL}/` }).baseUrl).toBe(KSEF_TEST_BASE_URL);
  });
});

describe('the anonymous challenge', () => {
  it('reads the challenge and timestamp, and sends no Authorization header', async () => {
    const { fetch, calls } = stub(fixture('auth-challenge-200'));
    const challenge = await ksefClient({ fetch }).challenge();

    expect(challenge.challenge).toHaveLength(36);
    expect(challenge.timestampMs).toBe(Date.parse(challenge.timestamp));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${KSEF_TEST_BASE_URL}/auth/challenge`);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.authorization).toBeUndefined();
    // The contract defines no request body for this operation and the client sends none.
    expect(calls[0].body).toBeUndefined();
  });

  it('rejects a challenge response missing the challenge itself', async () => {
    const { fetch } = stub({ status: 200, body: { timestamp: '2026-10-15T09:11:58.420Z' } });
    await expect(ksefClient({ fetch }).challenge()).rejects.toThrow(KsefMalformedResponseError);
  });
});

describe('a successful lookup', () => {
  it('returns the invoice KSeF holds for the number', async () => {
    const { fetch, calls } = stub(fixture('invoice-metadata-200'));
    const found = await ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL);

    expect(found).toBeDefined();
    expect(found!.number.canonical).toBe(OFFICIAL);
    expect(found!.metadata.invoiceNumber).toBe('FV/2025/08/0041');
    expect(found!.metadata.seller.nip).toBe('5265877635');
    expect(found!.acquisitionDay).toBe(dayFromIso('2025-08-26'));
    expect(calls).toHaveLength(1);
  });

  it('asks the documented endpoint, with the token and the filters the contract requires', async () => {
    const { fetch, calls } = stub(fixture('invoice-metadata-200'));
    await ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL);

    expect(calls[0].url).toBe(METADATA_URL);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].headers['content-type']).toBe('application/json');

    const sent = JSON.parse(calls[0].body!) as Record<string, unknown>;
    expect(sent.ksefNumber).toBe(OFFICIAL);
    expect(sent.subjectType).toBe('Subject1');
    // dateRange is required by the contract and derived from the number's own acceptance day.
    expect(sent.dateRange).toEqual({
      dateType: 'Invoicing',
      from: '2025-08-25T00:00:00.000Z',
      to: '2025-08-28T00:00:00.000Z',
    });
  });

  it('sends the canonical 35-character spelling even when handed the KSeF 1.0 form', async () => {
    // Two spellings of one invoice would be two queries and, upstream, two tags. One goes on the wire.
    const { fetch, calls } = stub(fixture('invoice-metadata-200'));
    const found = await ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(LEGACY);

    expect((JSON.parse(calls[0].body!) as { ksefNumber: string }).ksefNumber).toBe(OFFICIAL);
    expect(found!.number.canonical).toBe(OFFICIAL);
  });

  it('lets the caller widen the window and change the subject role', async () => {
    const { fetch, calls } = stub(fixture('invoice-metadata-200'));
    const dateRange = { dateType: 'Issue', from: '2025-06-01T00:00:00Z', to: '2025-09-01T00:00:00Z' } as const;
    await ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL, { subjectType: 'Subject2', dateRange });

    const sent = JSON.parse(calls[0].body!) as Record<string, unknown>;
    expect(sent.subjectType).toBe('Subject2');
    expect(sent.dateRange).toEqual(dateRange);
  });

  it('returns undefined when KSeF reports no such invoice, without calling it a forgery', async () => {
    // KSeF answers a filter that matches nothing with 200 and an empty page, and absence here only
    // means "not in this window, for this subject role, for this token's context".
    const { fetch } = stub(fixture('invoice-metadata-200-empty'));
    await expect(ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL)).resolves.toBeUndefined();
  });

  it('refuses to ask an authenticated endpoint without a token, before any request', async () => {
    const { fetch, calls } = stub();
    await expect(ksefClient({ fetch }).invoiceMetadata(OFFICIAL)).rejects.toThrow(KsefTokenRequiredError);
    expect(calls).toHaveLength(0);
  });
});

describe('the acceptance-day cross-check', () => {
  it('is a hard error when the number and KSeF disagree about the day', async () => {
    const { fetch } = stub(fixture('invoice-metadata-200-date-mismatch'));
    const call = ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL);

    await expect(call).rejects.toThrow(KsefAcceptanceDateMismatchError);
    // Both dates travel on the error: whoever investigates needs to see the disagreement, and the
    // one thing they must not be able to do is silently pick a winner.
    await call.catch((error: unknown) => {
      expect(error).toBeInstanceOf(KsefAcceptanceDateMismatchError);
      const mismatch = error as KsefAcceptanceDateMismatchError;
      expect(mismatch.ksefNumber).toBe(OFFICIAL);
      expect(mismatch.embeddedAcceptanceDate).toBe('2025-08-26');
      expect(mismatch.acquisitionDate).toBe('2025-11-14T00:12:44.512Z');
    });
  });

  it('tolerates one day, because the two dates are different instants by design', async () => {
    // The number embeds the day the invoice was accepted for processing; acquisitionDate is the
    // instant the number was assigned. A session straddling midnight puts those on different days,
    // so an invoice accepted at 23:58 and numbered at 00:12 is healthy and must not be refused.
    const page = fixture('invoice-metadata-200').body as { invoices: Array<Record<string, unknown>> };
    for (const acquisitionDate of ['2025-08-27T00:12:44.512Z', '2025-08-25T23:47:01.000Z']) {
      const { fetch } = stub({ status: 200, body: { ...page, invoices: [{ ...page.invoices[0], acquisitionDate }] } });
      const found = await ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL);
      expect(found, `a one-day gap at ${acquisitionDate} should be tolerated`).toBeDefined();
    }
  });

  it('is still a hard error two days out, so the tolerance is one day and not open-ended', async () => {
    const page = fixture('invoice-metadata-200').body as { invoices: Array<Record<string, unknown>> };
    const { fetch } = stub({
      status: 200,
      body: { ...page, invoices: [{ ...page.invoices[0], acquisitionDate: '2025-08-28T00:12:44.512Z' }] },
    });
    await expect(ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL)).rejects.toThrow(
      KsefAcceptanceDateMismatchError,
    );
  });

  it('accepts any instant on the embedded day, whatever the offset it is written in', async () => {
    const page = fixture('invoice-metadata-200').body as { invoices: Array<Record<string, unknown>> };
    const shifted = {
      ...page,
      // 2025-08-27T01:30+02:00 is 2025-08-26T23:30Z: the same UTC day the number embeds.
      invoices: [{ ...page.invoices[0], acquisitionDate: '2025-08-27T01:30:00+02:00' }],
    };
    const { fetch } = stub({ status: 200, body: shifted });
    const found = await ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL);
    expect(found!.acquisitionDay).toBe(dayFromIso('2025-08-26'));
  });

  it('refuses a date-time with no offset rather than guessing a zone', async () => {
    // ECMAScript reads an unzoned date-time as local time, so trusting one would make the whole
    // check depend on where the attester runs.
    const page = fixture('invoice-metadata-200').body as { invoices: Array<Record<string, unknown>> };
    const unzoned = { ...page, invoices: [{ ...page.invoices[0], acquisitionDate: '2025-08-26T12:41:07' }] };
    const { fetch } = stub({ status: 200, body: unzoned });

    await expect(ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL)).rejects.toThrow(
      /explicit UTC offset/,
    );
  });
});

describe('errors are distinguishable', () => {
  it('reports a business-logic 400 from the current RFC 7807 envelope', async () => {
    const { fetch } = stub(fixture('bad-request-problem-400'));
    const call = ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL);

    await expect(call).rejects.toThrow(KsefApiError);
    await call.catch((error: unknown) => {
      const api = error as KsefApiError;
      expect(api.status).toBe(400);
      expect(api.details).toHaveLength(1);
      expect(api.details[0].code).toBe(21177);
      expect(api.details[0].description).toMatch(/100 dni/);
      expect(api.reference).toBe('00-9f5b3ac1d2e84c6fa0b7d9e1f2c34567-1a2b3c4d5e6f7a8b-01');
    });
  });

  it('reports the deprecated ExceptionResponse envelope as the same business error', async () => {
    // The 2.9.0 contract marks it deprecated but still documents it, so a deployment emitting it must
    // not look like a broken transport.
    const { fetch } = stub(fixture('exception-response-400'));
    const call = ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL);

    await expect(call).rejects.toThrow(KsefApiError);
    await call.catch((error: unknown) => {
      const api = error as KsefApiError;
      expect(api.details[0].code).toBe(21152);
      expect(api.details[0].description).toMatch(/nie zostal znaleziony/);
      expect(api.reference).toBe('20251015-SE-ABCDEF1234-5F6A7B8C9D-00');
    });
  });

  it('reports a transport failure as such, keeping the cause', async () => {
    const cause = new Error('getaddrinfo ENOTFOUND api-test.ksef.mf.gov.pl');
    const { fetch } = stub(cause);
    const call = ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL);

    await expect(call).rejects.toThrow(KsefTransportError);
    await call.catch((error: unknown) => {
      const transport = error as KsefTransportError;
      expect(transport.url).toBe(METADATA_URL);
      expect(transport.cause).toBe(cause);
    });
  });

  it('separates a status with no KSeF envelope from a business error', async () => {
    // A proxy's HTML page is not KSeF speaking, and must not be reported as though it were.
    const { fetch } = stub(raw(502, '<html><head><title>502 Bad Gateway</title></head></html>'));
    const call = ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL);

    await expect(call).rejects.toThrow(KsefHttpStatusError);
    await expect(call).rejects.not.toThrow(KsefApiError);
    await call.catch((error: unknown) => {
      expect((error as KsefHttpStatusError).status).toBe(502);
      expect((error as KsefHttpStatusError).bodySnippet).toMatch(/502 Bad Gateway/);
    });
  });

  it('separates an unparseable 200 body from both of those', async () => {
    const { fetch } = stub(raw(200, 'not json at all'));
    const call = ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL);

    await expect(call).rejects.toThrow(KsefMalformedResponseError);
    await expect(call).rejects.not.toThrow(KsefHttpStatusError);
    await expect(call).rejects.toThrow(/not JSON/);
  });

  it('treats an empty 200 body as malformed, not as an empty result', async () => {
    const { fetch } = stub(raw(200, ''));
    await expect(ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL)).rejects.toThrow(
      KsefMalformedResponseError,
    );
  });

  it('reports a 200 page with no invoices array as malformed', async () => {
    const { fetch } = stub({ status: 200, body: { hasMore: false, isTruncated: false } });
    await expect(ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL)).rejects.toThrow(
      /no invoices array/,
    );
  });

  it('reports an echoed KSeF number it cannot parse as malformed', async () => {
    const page = fixture('invoice-metadata-200').body as { invoices: Array<Record<string, unknown>> };
    const broken = { ...page, invoices: [{ ...page.invoices[0], ksefNumber: 'not-a-ksef-number' }] };
    const { fetch } = stub({ status: 200, body: broken });

    await expect(ksefClient({ fetch, accessToken: TOKEN }).invoiceMetadata(OFFICIAL)).rejects.toThrow(
      /unparseable ksefNumber/,
    );
  });
});

describe('strictNip follows the environment', () => {
  // The ministry documents NIP checksum validation as production-only and tells integrators to use
  // random NIPs on TEST, where roughly ten in eleven fail mod-11. This number is one of those.
  const TEST_NIP = '1111111112';
  const TEST_NUMBER = syntheticKsefNumber(TEST_NIP, '2026-03-01', '0100001AF629');

  it('matches the fixture, so the number under test is the one KSeF would answer with', () => {
    const page = fixture('invoice-metadata-200-test-nip').body as { invoices: Array<{ ksefNumber: string }> };
    expect(page.invoices[0].ksefNumber).toBe(TEST_NUMBER);
  });

  it('accepts a random TEST-style NIP against the default TEST base URL', async () => {
    const { fetch, calls } = stub(fixture('invoice-metadata-200-test-nip'));
    const client = ksefClient({ fetch, accessToken: TOKEN });

    expect(client.strictNip).toBe(false);
    const found = await client.invoiceMetadata(TEST_NUMBER);
    expect(found!.number.sellerNip).toBe(TEST_NIP);
    expect(found!.acquisitionDay).toBe(dayFromIso('2026-03-01'));
    expect(calls).toHaveLength(1);
  });

  it('rejects the same number before any request when strictNip is on', async () => {
    const { fetch, calls } = stub();
    const client = ksefClient({ fetch, accessToken: TOKEN, strictNip: true });

    expect(client.strictNip).toBe(true);
    await expect(client.invoiceMetadata(TEST_NUMBER)).rejects.toThrow(KsefNumberError);
    await expect(client.invoiceMetadata(TEST_NUMBER)).rejects.toThrow(/fails its check digit/);
    // The point of parsing first: a number that cannot be right never costs a round trip.
    expect(calls).toHaveLength(0);
  });

  it('enforces check digits by default against any other base URL', async () => {
    // An exact match on the TEST base URL, not a hostname sniff: guessing "test" out of a hostname is
    // how a production client ends up silently skipping NIP validation.
    const { fetch, calls } = stub();
    const client = ksefClient({ fetch, accessToken: TOKEN, baseUrl: 'https://api.ksef.mf.gov.pl/v2' });

    expect(client.strictNip).toBe(true);
    await expect(client.invoiceMetadata(TEST_NUMBER)).rejects.toThrow(KsefNumberError);
    expect(calls).toHaveLength(0);
  });

  it('can be turned off for one call without reconfiguring the client', async () => {
    const { fetch } = stub(fixture('invoice-metadata-200-test-nip'));
    const client = ksefClient({ fetch, accessToken: TOKEN, strictNip: true });
    const found = await client.invoiceMetadata(TEST_NUMBER, { strictNip: false });
    expect(found!.number.sellerNip).toBe(TEST_NIP);
  });
});

describe('the fixtures', () => {
  it('all declare themselves hand-authored rather than recorded', () => {
    const names = [
      'auth-challenge-200',
      'bad-request-problem-400',
      'exception-response-400',
      'invoice-metadata-200',
      'invoice-metadata-200-date-mismatch',
      'invoice-metadata-200-empty',
      'invoice-metadata-200-test-nip',
    ];
    for (const name of names) {
      const url = new URL(`./fixtures/ksef/${name}.json`, import.meta.url);
      const raw = JSON.parse(readFileSync(url, 'utf8')) as { provenance: Record<string, unknown> };
      expect(raw.provenance.recorded).toBe(false);
      expect(String(raw.provenance.note)).toMatch(/No request was ever sent/);
      expect(raw.provenance.schema).toBeDefined();
      expect(raw.provenance.contract).toBeDefined();
    }
    // Loading every one through the guard proves the guard is wired to all of them, not just the
    // ones the other tests happen to touch.
    for (const name of names) expect(fixture(name).status).toBeGreaterThanOrEqual(200);
  });
});
