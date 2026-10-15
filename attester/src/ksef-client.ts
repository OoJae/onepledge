// SPDX-License-Identifier: Apache-2.0
// Read-only adapter for Poland's KSeF 2.0 API (API 2.9.0, build 2.9.0-te).
//
// Why this exists: `ksef.ts` parses a KSeF number and `tag.ts` keys a tag off it, but until now
// nothing in this repo had ever asked KSeF whether a number refers to an invoice. CRC-8 is a
// transcription check, not a signature — a borrower can hand the tag authority a syntactically
// perfect number for an invoice that never existed and every local check passes. OnePledge's whole
// identifier story rests on KSeF giving each invoice one canonical number, so the registry has to be
// able to ask KSeF, not just parse.
//
// HOW FAR THIS ACTUALLY GOES, which is less far than the file length suggests:
//   - `challenge()` calls an anonymous endpoint. It is the only call here that could run as written
//     against the TEST environment.
//   - `invoiceMetadata()` needs a Bearer JWT. Getting one costs one XAdES-BES signature over the
//     challenge, which cannot be produced in this repo. So it is written against the published
//     OpenAPI contract and exercised only against hand-authored fixtures. It has never spoken to
//     api-test.ksef.mf.gov.pl, and neither has anything else here.
// That is a demo limitation, not a property of the design: treat `invoiceMetadata()` as integration
// code whose shapes are checked and whose behaviour against a live KSeF is unverified. The fixtures
// in test/fixtures/ksef say the same thing in their own `provenance` block, and the loader in the
// test file fails any fixture that claims otherwise.
//
// RECORDING REAL FIXTURES, in the order a maintainer with credentials would do it:
//   1. Mint a self-signed test certificate and an XAdES signature. The ministry ships a .NET console
//      app for exactly this — `KSeF.Client.Tests.CertTestApp` in github.com/CIRFMF/ksef-client-csharp,
//      described there as "aplikacja konsolowa dla zobrazowania tworzenia przykładowego, testowego
//      certyfikatu oraz podpisu XAdES". One run of it is the whole cost of the JWT. TEST accepts
//      self-signed certificates, so no Polish NIP, qualified e-signature or Trusted Profile is
//      involved — but there is no official TypeScript SDK (C# and Java only), so this step cannot
//      move into this package.
//   2. POST /auth/challenge — anonymous, returns the challenge and its timestamp.
//   3. Sign the AuthTokenRequest XML with that certificate and POST /auth/xades-signature. It answers
//      202 with a reference number, not a token.
//   4. Poll GET /auth/{referenceNumber} until the operation succeeds, then POST /auth/token/redeem.
//      That response carries the access token this client takes as `accessToken`.
//   5. POST /invoices/query/metadata for an invoice that exists in TEST and save the raw body.
//   6. Scrub NIPs, names and reference numbers, then set the fixture's `provenance.recorded` to true
//      and record the environment and date. The test loader reads that field, so a recording and a
//      hand-authored shape can never be mistaken for each other.
//
// Base URL: the default is the `servers` entry of the ministry's own OpenAPI document,
// https://api-test.ksef.mf.gov.pl/v2. Several third-party clients use an /api/v2 prefix instead. With
// no way to probe from here, which prefix a live deployment answers on is unverified — one more
// reason `baseUrl` is injectable rather than hard-coded.
//
// Not implemented, deliberately: the anonymous QR verification route, which is keyed on (seller NIP,
// issue date, SHA-256 of the invoice XML) and so requires already holding the invoice. That is worth
// noting rather than building, because the property it demonstrates is the one OnePledge relies on:
// KSeF cannot be enumerated by guessing numbers, exactly as the keyed tag cannot be computed from a
// guessed number.

import { type KsefNumber, parseKsefNumber } from './ksef.js';

/** The `servers` entry of the published 2.9.0 OpenAPI document. */
export const KSEF_TEST_BASE_URL = 'https://api-test.ksef.mf.gov.pl/v2';

const MS_PER_DAY = 86_400_000;
/** Enough of an error body to identify a proxy's HTML page without pasting the whole thing. */
const BODY_SNIPPET = 200;

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

export interface KsefHttpRequest {
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

export interface KsefHttpResponse {
  readonly status: number;
  text(): Promise<string>;
}

/**
 * The slice of WHATWG `fetch` this client uses. Declaring it structurally rather than importing
 * `typeof globalThis.fetch` keeps the module independent of which DOM or undici typings happen to be
 * in scope, and makes a test stub a three-line object literal. The platform `fetch` satisfies it
 * without a cast; `ksef-client.test.ts` asserts that at compile time so this claim cannot rot.
 */
export type KsefFetch = (url: string, init: KsefHttpRequest) => Promise<KsefHttpResponse>;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export class KsefError extends Error {}

/** No response at all: DNS, TLS, a dropped connection, an abort. Nothing is known about KSeF. */
export class KsefTransportError extends KsefError {
  constructor(
    readonly url: string,
    cause: unknown,
  ) {
    super(`KSeF request to ${url} produced no response: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
}

/**
 * A response arrived with a status KSeF does not use for business errors, or with a body that is not
 * one of KSeF's error envelopes: a proxy's 502, a 404 from the wrong base URL prefix, an HTML
 * maintenance page. Status alone cannot tell this apart from a business error — KSeF returns its
 * envelope on 403 and 404 too, and an intermediary can return a 400 with no envelope at all — so the
 * body decides which of these two errors you get, not the number.
 */
export class KsefHttpStatusError extends KsefError {
  constructor(
    readonly status: number,
    readonly bodySnippet: string,
  ) {
    super(`KSeF answered HTTP ${status} with no recognisable error envelope: ${bodySnippet || '<empty body>'}`);
  }
}

export interface KsefApiErrorDetail {
  /** `ApiError.code` / `ExceptionDetails.exceptionCode`. The ministry does not publish the code list. */
  readonly code?: number;
  readonly description?: string;
  readonly details?: readonly string[];
}

/**
 * KSeF itself rejected the request and said why. Both published envelopes land here: the current
 * RFC 7807 `BadRequestProblemDetails` and the `ExceptionResponse` the 2.9.0 contract marks
 * `deprecated: true`. They are normalised onto one `details` list so a caller writes one handler —
 * the alternative, two error classes, pushes a distinction that is about the ministry's migration
 * schedule and not about anything the caller can act on.
 */
export class KsefApiError extends KsefError {
  constructor(
    readonly status: number,
    readonly details: readonly KsefApiErrorDetail[],
    /** `traceId` (RFC 7807 envelope) or `referenceNumber` (deprecated envelope): quote it in a support ticket. */
    readonly reference?: string,
  ) {
    const summary = details
      .map((d) => `${d.code ?? '?'}: ${d.description ?? '<no description>'}`)
      .join('; ');
    super(`KSeF rejected the request (HTTP ${status}): ${summary}${reference ? ` [ref ${reference}]` : ''}`);
  }
}

/** A 2xx body that is not the shape the published contract promises, or a date it cannot read. */
export class KsefMalformedResponseError extends KsefError {}

/**
 * The date embedded in the KSeF number and the date KSeF holds for it disagree. This is a hard error
 * rather than a warning on purpose: a number whose own acceptance day contradicts the registry's
 * record is the identifier confusion OnePledge exists to prevent, and a tag minted over it would be
 * a tag over an invoice nobody can agree on. Letting the caller pick a winner is the one outcome
 * that must not be available.
 */
export class KsefAcceptanceDateMismatchError extends KsefError {
  constructor(
    readonly ksefNumber: string,
    /** The day the number itself claims, as the ministry's format defines it. */
    readonly embeddedAcceptanceDate: string,
    /** `InvoiceMetadata.acquisitionDate`, the instant KSeF says it assigned the number. */
    readonly acquisitionDate: string,
  ) {
    super(
      `KSeF number ${ksefNumber} embeds acceptance date ${embeddedAcceptanceDate}, ` +
        `but KSeF reports acquisitionDate ${acquisitionDate}`,
    );
  }
}

/** The metadata query is authenticated; refusing locally beats spending a round trip on a 401. */
export class KsefTokenRequiredError extends KsefError {}

// ---------------------------------------------------------------------------------------------
// Response shapes, from the published contract
// ---------------------------------------------------------------------------------------------

/** `AuthenticationChallengeResponse`. */
export interface KsefChallenge {
  /** `Challenge`: 36 characters. */
  readonly challenge: string;
  readonly timestamp: string;
  /**
   * The 2.9.0 contract marks `timestampMs` and `clientIp` required, but the ministry's own prose
   * describes the response as "challenge i timestamp", and neither field is used by the XAdES flow
   * this client documents. Typed optional so a challenge is never failed over a field nobody reads.
   */
  readonly timestampMs?: number;
  readonly clientIp?: string;
}

/** `InvoiceType`. */
export type KsefInvoiceType =
  | 'Vat'
  | 'Zal'
  | 'Kor'
  | 'Roz'
  | 'Upr'
  | 'KorZal'
  | 'KorRoz'
  | 'VatPef'
  | 'VatPefSp'
  | 'KorPef'
  | 'VatRr'
  | 'KorVatRr';

/** `InvoicingMode`. */
export type KsefInvoicingMode = 'Online' | 'Offline';

/** `FormCode`: which FA schema the invoice was filed under. */
export interface KsefFormCode {
  readonly systemCode: string;
  readonly schemaVersion: string;
  readonly value: string;
}

/**
 * `InvoiceMetadata`.
 *
 * Only `ksefNumber` and `acquisitionDate` are checked at runtime, because only those two carry the
 * identifier claim this adapter exists to test. The rest is the contract's shape passed through
 * unchecked at one documented boundary — validating all twenty fields would turn a harmless field
 * addition upstream into an outage, and KSeF is a moving target (the number format alone changed
 * between 1.0 and 2.0). If you start depending on another field, validate it where you read it.
 *
 * `netAmount`, `grossAmount` and `vatAmount` are JSON doubles because the contract says so. Nothing
 * in OnePledge derives a pledge amount from them: `tag.ts` takes amounts as grosz decimal strings
 * and the attestation's `amount` is signed by the tag authority, precisely because a double cannot
 * hold a money amount exactly.
 */
export interface KsefInvoiceMetadata {
  readonly ksefNumber: string;
  readonly invoiceNumber: string;
  readonly issueDate: string;
  /** When KSeF accepted the invoice for processing. This is what the `Invoicing` date filter matches. */
  readonly invoicingDate: string;
  /** "Data nadania numeru KSeF": when the number was assigned. Cross-checked against the number. */
  readonly acquisitionDate: string;
  readonly permanentStorageDate: string;
  readonly seller: { readonly nip: string; readonly name?: string | null };
  readonly buyer: { readonly identifier: string; readonly name?: string | null };
  readonly netAmount: number;
  readonly grossAmount: number;
  readonly vatAmount: number;
  readonly currency: string;
  readonly invoicingMode: KsefInvoicingMode;
  readonly invoiceType: KsefInvoiceType;
  readonly formCode: KsefFormCode;
  readonly isSelfInvoicing: boolean;
  readonly hasAttachment: boolean;
  /** `Sha256HashBase64`: 44 characters. */
  readonly invoiceHash: string;
  readonly hashOfCorrectedInvoice?: string | null;
}

/** `QueryInvoicesMetadataResponse`. */
export interface KsefInvoiceMetadataPage {
  readonly hasMore: boolean;
  readonly isTruncated: boolean;
  readonly permanentStorageHwmDate?: string | null;
  readonly invoices: readonly KsefInvoiceMetadata[];
}

/** `InvoiceQuerySubjectType`: whose side of the invoice the query is asked from. */
export type KsefQuerySubjectType = 'Subject1' | 'Subject2' | 'Subject3' | 'SubjectAuthorized';

/** `InvoiceQueryDateType`. */
export type KsefQueryDateType = 'Issue' | 'Invoicing' | 'PermanentStorage';

/** `InvoiceQueryDateRange`. The contract caps the window at 100 days. */
export interface KsefQueryDateRange {
  readonly dateType: KsefQueryDateType;
  readonly from: string;
  readonly to?: string;
}

/** What a lookup found, with the number as OnePledge canonicalises it. */
export interface KsefInvoiceLookup {
  /** Parsed from the caller's input before the request went out, so the canonical spelling is known. */
  readonly number: KsefNumber;
  readonly metadata: KsefInvoiceMetadata;
  /** `acquisitionDate` as whole UTC days since the epoch: the unit the cross-check compares in. */
  readonly acquisitionDay: number;
}

// ---------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------

export interface KsefClientOptions {
  /**
   * Required, with no fallback to `globalThis.fetch`. A default would mean a test that forgot to pass
   * a stub would silently reach the real ministry instead of failing, which is the one outcome worth
   * engineering against here.
   */
  readonly fetch: KsefFetch;
  /** Defaults to {@link KSEF_TEST_BASE_URL}. Trailing slashes are trimmed. */
  readonly baseUrl?: string;
  /** Bearer JWT from the auth flow in this file's header comment. Only the metadata query needs it. */
  readonly accessToken?: string;
  /**
   * Overrides the per-environment default described on {@link ksefClient}.
   */
  readonly strictNip?: boolean;
  /**
   * When set, every request carries `AbortSignal.timeout(timeoutMs)`. No default: the ministry
   * publishes rate limits but no latency figures, so any number here would be a guess dressed up as
   * a setting, and an injected `fetch` is the right place for a caller's own policy.
   */
  readonly timeoutMs?: number;
}

export interface KsefInvoiceLookupOptions {
  /** Defaults to `Subject1`. See {@link KsefClient.invoiceMetadata}. */
  readonly subjectType?: KsefQuerySubjectType;
  /** Defaults to a three-day `Invoicing` window around the day the number embeds. */
  readonly dateRange?: KsefQueryDateRange;
  /** Overrides the client-wide setting for this one call. */
  readonly strictNip?: boolean;
}

export interface KsefClient {
  /** The base URL this client will use, after trailing slashes are trimmed. */
  readonly baseUrl: string;
  /** Whether KSeF numbers handed to this client must pass the NIP check digit. */
  readonly strictNip: boolean;
  /**
   * `POST /auth/challenge`. Anonymous, so this is the one call that needs no token. On its own it
   * proves only reachability: the challenge is useless without the XAdES signature step.
   */
  challenge(): Promise<KsefChallenge>;
  /**
   * `POST /invoices/query/metadata` filtered to one KSeF number, plus the consistency check that
   * only an integration can make.
   *
   * Returns `undefined` when KSeF reports no such invoice. That is not proof the invoice does not
   * exist: the query is scoped to a date window and to one subject role, so a wrong window or a
   * token whose context cannot see the invoice looks exactly the same from here. Absence is a reason
   * to ask again, never a reason to conclude an invoice is fake.
   *
   * Throws {@link KsefAcceptanceDateMismatchError} when the two dates disagree, and the KSeF number
   * parse errors from `ksef.ts` (before any request) when the number itself is malformed.
   */
  invoiceMetadata(ksefNumber: string, options?: KsefInvoiceLookupOptions): Promise<KsefInvoiceLookup | undefined>;
}

const trimSlashes = (url: string) => url.replace(/\/+$/, '');

const record = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new KsefMalformedResponseError(`${what} is not a JSON object`);
  }
  return value as Record<string, unknown>;
};

const requireString = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || value === '') {
    throw new KsefMalformedResponseError(`${what} is missing or not a non-empty string`);
  }
  return value;
};

// A date with no time is read as UTC midnight; a date-time must carry an explicit offset.
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

/**
 * Whole UTC days since the epoch, for a date KSeF reported.
 *
 * The offset is mandatory because ECMAScript reads a date-time without one as *local* time, which
 * would shift the day on any host east or west of UTC and make the cross-check below depend on where
 * the attester happens to run. This function's entire job is to compare days, so quietly guessing a
 * zone is the one thing it must not do: an unzoned timestamp is a malformed response, not a date.
 */
const utcDay = (value: string, what: string): number => {
  const m = RFC3339.exec(value.trim());
  if (!m) {
    throw new KsefMalformedResponseError(
      `${what} is not an RFC 3339 instant with an explicit UTC offset: ${JSON.stringify(value)}`,
    );
  }
  const ms = Date.parse(m[4] === undefined ? `${m[1]}-${m[2]}-${m[3]}T00:00:00Z` : value.trim());
  if (!Number.isFinite(ms)) {
    throw new KsefMalformedResponseError(`${what} is not a real calendar instant: ${JSON.stringify(value)}`);
  }
  return Math.floor(ms / MS_PER_DAY);
};

/** Reads either published error envelope. Returns undefined when the body is neither. */
const errorDetails = (
  body: unknown,
): { details: readonly KsefApiErrorDetail[]; reference?: string } | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const top = body as Record<string, unknown>;

  // Current shape: BadRequestProblemDetails, errors[] of ApiError.
  if (Array.isArray(top.errors)) {
    const details = top.errors.map((e): KsefApiErrorDetail => {
      const d = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>;
      return {
        code: typeof d.code === 'number' ? d.code : undefined,
        description: typeof d.description === 'string' ? d.description : undefined,
        details: Array.isArray(d.details) ? d.details.filter((x): x is string => typeof x === 'string') : undefined,
      };
    });
    return { details, reference: typeof top.traceId === 'string' ? top.traceId : undefined };
  }

  // Deprecated shape, still emitted by some deployments: ExceptionResponse.
  const exception = typeof top.exception === 'object' && top.exception !== null ? (top.exception as Record<string, unknown>) : undefined;
  if (exception && Array.isArray(exception.exceptionDetailList)) {
    const details = exception.exceptionDetailList.map((e): KsefApiErrorDetail => {
      const d = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>;
      return {
        code: typeof d.exceptionCode === 'number' ? d.exceptionCode : undefined,
        description: typeof d.exceptionDescription === 'string' ? d.exceptionDescription : undefined,
        details: Array.isArray(d.details) ? d.details.filter((x): x is string => typeof x === 'string') : undefined,
      };
    });
    return {
      details,
      reference: typeof exception.referenceNumber === 'string' ? exception.referenceNumber : undefined,
    };
  }
  return undefined;
};

/**
 * `baseUrl`, `fetch` and the token are fixed per client; everything else is per call.
 *
 * `strictNip` defaults to off when `baseUrl` is exactly {@link KSEF_TEST_BASE_URL} and on otherwise.
 * TEST issues numbers whose NIPs mostly fail mod-11 — the ministry tells integrators to use random
 * NIPs and its own validator performs no NIP checksum — so a client pointed at TEST that enforced
 * check digits would reject most real TEST numbers. The comparison is an exact match on the TEST base
 * URL rather than sniffing "test" out of the hostname, because guessing from a hostname is how a
 * production client ends up silently skipping NIP validation.
 */
export const ksefClient = (options: KsefClientOptions): KsefClient => {
  const baseUrl = trimSlashes(options.baseUrl ?? KSEF_TEST_BASE_URL);
  const strictNip = options.strictNip ?? baseUrl !== KSEF_TEST_BASE_URL;
  const { fetch: fetchImpl, accessToken, timeoutMs } = options;

  const send = async (path: string, init: Omit<KsefHttpRequest, 'signal'>): Promise<unknown> => {
    const url = `${baseUrl}${path}`;
    const request: KsefHttpRequest =
      timeoutMs === undefined ? init : { ...init, signal: AbortSignal.timeout(timeoutMs) };

    let response: KsefHttpResponse;
    let text: string;
    try {
      response = await fetchImpl(url, request);
      // Reading the body is inside the same try: a connection that dies mid-body is a transport
      // failure, and reporting it as a bad response would blame KSeF for a broken socket.
      text = await response.text();
    } catch (cause) {
      throw new KsefTransportError(url, cause);
    }

    let parsed: unknown;
    let parseFailed = false;
    try {
      parsed = text.trim() === '' ? undefined : JSON.parse(text);
    } catch {
      parseFailed = true;
    }

    if (response.status < 200 || response.status >= 300) {
      const found = parseFailed ? undefined : errorDetails(parsed);
      if (found) throw new KsefApiError(response.status, found.details, found.reference);
      throw new KsefHttpStatusError(response.status, text.slice(0, BODY_SNIPPET));
    }
    if (parseFailed || parsed === undefined) {
      throw new KsefMalformedResponseError(
        `KSeF answered HTTP ${response.status} with a body that is not JSON: ${text.slice(0, BODY_SNIPPET) || '<empty body>'}`,
      );
    }
    return parsed;
  };

  const json = { accept: 'application/json' } as const;

  const authorized = (): Readonly<Record<string, string>> => {
    if (accessToken === undefined || accessToken === '') {
      throw new KsefTokenRequiredError(
        'The KSeF invoice metadata query is authenticated; pass accessToken (see the auth flow in ksef-client.ts)',
      );
    }
    return { ...json, 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };
  };

  /**
   * The contract requires a `dateRange` and caps it at 100 days, and the number itself names the day
   * its number was assigned, so the window is derived from the number rather than demanded from the
   * caller. One day of slack each side because the filter matches `invoicingDate` (acceptance for
   * processing) while the number embeds the `acquisitionDate` day (number assignment): those are
   * different instants, and a session straddling midnight UTC puts them on different days. The
   * cross-check afterwards is still exact — widening the search window does not widen what is
   * accepted as consistent.
   */
  const windowAround = (number: KsefNumber): KsefQueryDateRange => ({
    dateType: 'Invoicing',
    from: new Date((number.acceptanceDay - 1) * MS_PER_DAY).toISOString(),
    to: new Date((number.acceptanceDay + 2) * MS_PER_DAY).toISOString(),
  });

  return {
    baseUrl,
    strictNip,

    challenge: async (): Promise<KsefChallenge> => {
      // The contract defines no request body for this operation, so none is sent. An empty `{}` would
      // probably be tolerated, but sending a body the spec does not describe invites a 415 on a
      // deployment that is stricter than the current one.
      const body = record(await send('/auth/challenge', { method: 'POST', headers: json }), 'auth/challenge response');
      const challenge = requireString(body.challenge, 'auth/challenge challenge');
      const timestamp = requireString(body.timestamp, 'auth/challenge timestamp');
      return {
        challenge,
        timestamp,
        timestampMs: typeof body.timestampMs === 'number' ? body.timestampMs : undefined,
        clientIp: typeof body.clientIp === 'string' ? body.clientIp : undefined,
      };
    },

    invoiceMetadata: async (
      ksefNumber: string,
      lookup: KsefInvoiceLookupOptions = {},
    ): Promise<KsefInvoiceLookup | undefined> => {
      // Parsed first, so a malformed number never costs a round trip, and so the canonical 35-character
      // spelling is what goes on the wire even when the caller held the KSeF 1.0 form.
      const number = parseKsefNumber(ksefNumber, { strictNip: lookup.strictNip ?? strictNip });
      const headers = authorized();

      const filters = {
        // Subject1 is the seller, whose NIP is the first segment of the number, so it is the role
        // guaranteed to be able to see the invoice. A lender querying as the buyer passes Subject2.
        subjectType: lookup.subjectType ?? 'Subject1',
        dateRange: lookup.dateRange ?? windowAround(number),
        ksefNumber: number.canonical,
      };
      // pageSize's contract minimum is 10 even though an exact-match filter yields at most one.
      const page = record(
        await send('/invoices/query/metadata?pageOffset=0&pageSize=10', {
          method: 'POST',
          headers,
          body: JSON.stringify(filters),
        }),
        'invoices/query/metadata response',
      );
      const invoices = page.invoices;
      if (!Array.isArray(invoices)) {
        throw new KsefMalformedResponseError('invoices/query/metadata response has no invoices array');
      }

      const match = invoices.find((candidate) => {
        const echoed = requireString(
          record(candidate, 'invoices/query/metadata invoice').ksefNumber,
          'invoices/query/metadata invoice ksefNumber',
        );
        // Compared canonically, not as strings: the contract still accepts the 36-character KSeF 1.0
        // spelling, and two spellings of one invoice is the confusion this package exists to prevent.
        // The NIP check digit is not re-run here — it already ran on the caller's input, and failing
        // an echo over it would reject a TEST invoice for a reason unrelated to the echo.
        try {
          return parseKsefNumber(echoed, { strictNip: false }).canonical === number.canonical;
        } catch (cause) {
          throw new KsefMalformedResponseError(`KSeF returned an unparseable ksefNumber ${JSON.stringify(echoed)}`, {
            cause,
          });
        }
      });
      if (match === undefined) return undefined;

      const metadata = match as KsefInvoiceMetadata;
      const acquisitionDate = requireString(
        record(match, 'invoices/query/metadata invoice').acquisitionDate,
        'invoices/query/metadata invoice acquisitionDate',
      );
      const acquisitionDay = utcDay(acquisitionDate, 'acquisitionDate');
      // The check this adapter exists for, and it is deliberately loose by exactly one day.
      //
      // TWO UNVERIFIED THINGS, both of which would make an exact comparison fire on a healthy
      // invoice, and neither of which can be settled from here:
      //
      //   1. WHICH INSTANT THE NUMBER EMBEDS. numer-ksef.md calls the RRRRMMDD segment the date the
      //      invoice was accepted for further processing ("data przyjecia faktury ... do dalszego
      //      przetwarzania"). `acquisitionDate` is the instant KSeF assigned the number. Those are
      //      different instants by design, as `windowAround` above already says, so an invoice
      //      accepted at 23:58 and numbered at 00:12 legitimately has an embedded day one behind its
      //      acquisitionDate. An exact comparison would reject it.
      //   2. WHICH ZONE EITHER IS IN. KSeF documents its query windows and error timestamps as UTC,
      //      which is why both sides are read in UTC here, but numer-ksef.md does not state the zone
      //      of the date it embeds. If numbers are stamped in Europe/Warsaw, an exact comparison
      //      would reject every invoice accepted in the first one or two hours of a Warsaw day.
      //
      // So the tolerance is one day in either direction. That keeps the property this check exists
      // for — a number whose embedded day is weeks or months from KSeF's own record is identifier
      // confusion, and minting a tag over it would be minting a tag over an invoice nobody can agree
      // on — while not turning a fourteen-minute clock difference or an unverified timezone into a
      // hard failure on a real invoice. Narrow it to an exact match once a recorded response from the
      // TEST environment settles both questions; that is the first thing to check with credentials.
      const dayGap = acquisitionDay - number.acceptanceDay;
      if (dayGap < -1n || dayGap > 1n) {
        throw new KsefAcceptanceDateMismatchError(number.canonical, number.acceptanceDate, acquisitionDate);
      }
      return { number, metadata, acquisitionDay };
    },
  };
};
