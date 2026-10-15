// SPDX-License-Identifier: Apache-2.0
// The lender half of encrypted delivery: scan every delivery the deployed registry holds, keep the
// ones that open, and act on them.
//
// A lender's pledges are opaque hashes on chain. Nothing says who a delivery is for, so finding its
// own book means trying to decrypt all of them and keeping what opens — which is also why the count
// of deliveries scanned against the count opened is worth putting on screen: it is the privacy
// property, measured.
//
// Everything heavy lives in this module rather than in pages/Inbox.tsx on purpose. Importing the
// compiled contract drags in Midnight's ledger runtime, about 5 MB of WASM, and the page has to
// render its connect panel — and its "no wallet here" message — long before any of that is needed.
// The page therefore imports this module dynamically, and none of it loads until a wallet connects.
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { lenderEncryptionKey, openDelivery, type NoteOpening } from '@onepledge/attester';
import { POOL_SIZE, Registry, type OnePledgePrivateState } from '@onepledge/contract';
import type { Connection } from './connector.ts';
import type { DemoBundle, DemoInvoice } from './pledge.ts';
import {
  DEFAULT_PROOF_SERVER,
  buildProviders,
  deskContract,
  proofServerReachable,
  provingMode,
} from './providers.ts';

// Re-exported so the page can fetch the bundle without statically importing pledge.ts, which would
// pull the compiled contract into the page's own chunk and undo the split described above.
export { loadBundle } from './pledge.ts';
export type { NoteOpening } from '@onepledge/attester';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`no response within ${ms / 1000}s`)), ms)),
  ]);

// --- Preflight ------------------------------------------------------------------------------------

export type Preflight = {
  readonly shielded: string;
  readonly unshielded: string;
  readonly dust: bigint;
  readonly proving: 'wallet' | 'proof-server';
  readonly proofServer: { readonly uri: string; readonly reachable: boolean } | null;
};

/**
 * The same live checks the desk runs before it will sign. Accepting, declining, releasing and drawing
 * are all transactions, so an inbox that skipped these would fail at the moment of signing instead of
 * saying what is missing.
 */
export const preflight = async (connection: Connection): Promise<Preflight> => {
  const { api } = connection;
  const [shielded, unshielded, dust, config] = await Promise.all([
    api.getShieldedAddresses(),
    api.getUnshieldedAddress(),
    api.getDustBalance(),
    api.getConfiguration(),
  ]);
  const mode = provingMode(api);
  const uri = config.proverServerUri ?? DEFAULT_PROOF_SERVER;
  return {
    shielded: shielded.shieldedAddress,
    unshielded: unshielded.unshieldedAddress,
    dust: dust.balance,
    proving: mode,
    proofServer: mode === 'proof-server' ? { uri, reachable: await proofServerReachable(uri) } : null,
  };
};

// --- Rounds ---------------------------------------------------------------------------------------

const ROUND_PREFIX = 'onepledge:round:';
const PAD = 0x2e; // '.', so a round read back off the chain is still legible as the text it was

/**
 * A round as 32 printable bytes. A hash of the label would be just as valid and would read back off
 * the chain as noise; `draws` publishes the round in the clear, so there is nothing to protect by
 * hiding it, and a legible value lets anyone check what round a draw was made for.
 */
const roundBytes = (label: string): Uint8Array => {
  if (!/^[\x20-\x7e]{1,32}$/.test(label)) throw new Error(`A round must be 1-32 printable ASCII characters: ${label}`);
  const bytes = new Uint8Array(32).fill(PAD);
  for (let i = 0; i < label.length; i++) bytes[i] = label.charCodeAt(i);
  return bytes;
};

/** Reads a round back as its label, or as hex when some other client wrote something non-textual. */
const roundLabel = (bytes: Uint8Array): string =>
  bytes.every((b) => b >= 0x20 && b <= 0x7e)
    ? Array.from(bytes, (b) => String.fromCharCode(b)).join('').replace(/\.+$/, '')
    : hex(bytes);

/**
 * The round this page draws for: the UTC day, and deliberately nothing else.
 *
 * `draws` publishes the round, so a round that named the lender would publish on chain exactly what
 * the draw id exists to hide. The UTC day is stable, visible and shared: every lender drawing today
 * uses this same value, their draw ids differ because the id is keyed on the lender's own secret, and
 * nothing links either draw to either lender. It also gives the one-draw-per-round rule something to
 * bite on — a second draw today is refused by the registry, which is the rule working, not a bug.
 */
const currentRound = (now = new Date()) => {
  const label = `${ROUND_PREFIX}${now.toISOString().slice(0, 10)}`;
  return { label, bytes: roundBytes(label) };
};

// --- Reading the registry -------------------------------------------------------------------------

// Same-origin proxy onto the Blockfrost Preprod indexer (web/api/indexer.js); the token stays server
// side and the page stays inside `connect-src 'self'`. Deliberately not providers.buildProviders():
// that set includes a proof provider, and a lender whose proof server is down should still be able to
// read its inbox. Scanning is not signing.
let reader: ReturnType<typeof indexerPublicDataProvider> | undefined;
const indexer = () => {
  const origin = window.location.origin;
  // The network id is aligned with the wallet by connector.connect(), which the page runs first.
  reader ??= indexerPublicDataProvider(`${origin}/api/indexer`, `${origin.replace(/^http/, 'ws')}/api/indexer`);
  return reader;
};

export type Opened = {
  /** The map key this delivery was filed under: the note commitment the pledge published. */
  readonly filedUnder: string;
  readonly opening: NoteOpening;
  /** noteCommitment() recomputed from the opening and this lender's key. */
  readonly recomputed: string;
  /** True when the opening really is the opening of the note it was filed under. */
  readonly binds: boolean;
  readonly accepted: boolean;
  readonly declined: boolean;
  readonly released: boolean;
  /**
   * The invoice behind the tag, found in the demo bundle the visitor already holds. The chain says
   * nothing of the kind: a lender in the real flow knows its own invoices because it financed them.
   */
  readonly invoice?: DemoInvoice;
};

export type Scan = {
  /** Every delivery on the registry, all of which were tried. */
  readonly scanned: number;
  readonly opened: readonly Opened[];
  /** The openings a borrowing-base draw would be proven over; see poolFrom. */
  readonly pool: readonly Opened[];
  /** The pool size the circuit is compiled for, so the page never hardcodes four. */
  readonly poolSize: number;
  readonly pledgeCount: bigint;
  /** Whether the registry holds an entry for this lender's key at all. */
  readonly admitted: boolean;
  /**
   * And whether the encryption key it published is the one this secret derives. False means the
   * bundle's secret does not belong to the admitted lender, so no delivery sealed to that lender
   * could ever open here — worth saying out loud rather than reporting an empty inbox.
   */
  readonly encryptionKeyMatches: boolean;
  readonly round: { readonly label: string; readonly drawId: string };
  /** The draw already recorded for this lender and this round, if there is one. */
  readonly draw?: { readonly round: string; readonly floor: bigint };
  readonly readAt: string;
};

/**
 * Trial-decrypts every delivery with one lender's secret. Call it only after connect(): that is what
 * aligns the SDK's network id with the wallet, and this read decodes state with the contract's own
 * compiled ledger reader, which is network-id sensitive.
 */
export const scanInbox = async (bundle: DemoBundle, lenderSecret: Uint8Array): Promise<Scan> => {
  const state = await withTimeout(indexer().queryContractState(bundle.contractAddress), 20_000);
  if (!state) {
    throw new Error(
      `The indexer has no state for ${bundle.contractAddress.slice(0, 12)}…. The bundle may name a registry that is no longer deployed.`,
    );
  }
  const l = Registry.ledger(state.data);
  const lenderKey = Registry.pureCircuits.lenderKey(lenderSecret);

  const opened: Opened[] = [];
  let scanned = 0;
  for (const [filedUnder, ciphertext] of l.deliveries) {
    scanned += 1;
    const opening = openDelivery(lenderSecret, ciphertext);
    // Wrong recipient and borrower-posted garbage are indistinguishable from here, by design.
    if (!opening) continue;
    const recomputed = Registry.pureCircuits.noteCommitment(
      opening.tag,
      lenderKey,
      opening.invoiceCommit,
      opening.amount,
      opening.salt,
    );
    const binds = sameBytes(recomputed, filedUnder);
    // Both nullifiers are keyed on the lender's secret, so this lender can read its own decision and
    // release history off a public set that tells everyone else nothing.
    const decision = Registry.pureCircuits.decisionNullifier(recomputed, lenderSecret);
    const release = Registry.pureCircuits.releaseNullifier(recomputed, lenderSecret);
    opened.push({
      filedUnder: hex(filedUnder),
      opening,
      recomputed: hex(recomputed),
      binds,
      // Meaningless unless the opening binds: a nullifier over the wrong note is just another hash.
      accepted: binds && l.accepted.member(decision),
      declined: binds && l.declined.member(decision),
      released: binds && l.releases.member(release),
      invoice: bundle.attestations.find((a) => sameBytes(a.attestation.tag, opening.tag))?.fields,
    });
  }

  const admitted = l.lenderEncryptionKeys.member(lenderKey);
  const round = currentRound();
  const drawId = Registry.pureCircuits.drawId(round.bytes, lenderSecret);
  const recorded = l.draws.member(drawId) ? l.draws.lookup(drawId) : undefined;
  return {
    scanned,
    opened,
    pool: poolFrom(opened),
    poolSize: POOL_SIZE,
    pledgeCount: l.pledgeCount,
    admitted,
    encryptionKeyMatches:
      admitted && sameBytes(l.lenderEncryptionKeys.lookup(lenderKey), lenderEncryptionKey(lenderSecret)),
    round: { label: round.label, drawId: hex(drawId) },
    draw: recorded && { round: roundLabel(recorded.round), floor: recorded.floor },
    readAt: new Date().toISOString(),
  };
};

/**
 * The four openings a draw would be proven over. The circuit asks only for four distinct notes
 * pledged to this lender, so which four is this page's choice; accepted ones come first because a
 * pledge the lender has taken is the strongest thing it can put behind a drawdown.
 *
 * Declined and released receivables are left out: a declined pledge was never financed and a released
 * one has been paid, so neither belongs in a borrowing base. The circuit does not enforce either
 * exclusion — it is this page's filter, and a lender running its own client could include them.
 */
const poolFrom = (opened: readonly Opened[]): readonly Opened[] =>
  [...opened.filter((d) => d.binds && !d.declined && !d.released)]
    .sort((a, b) => Number(b.accepted) - Number(a.accepted))
    .slice(0, POOL_SIZE);

// --- Writing to the registry ----------------------------------------------------------------------

export type Sent = { readonly txHash: string; readonly blockHeight: number };

/** Same shape the desk and the CLI use (cli/src/demo.ts): the generated contract type is not expressible here. */
type CallTx = { callTx: Record<string, (...args: unknown[]) => Promise<{ public: Sent }>> };

const joinAsLender = async (
  connection: Connection,
  bundle: DemoBundle,
  privateState: OnePledgePrivateState,
): Promise<CallTx> => {
  const providers = await buildProviders(connection);
  // A no-op against the in-memory store this build uses (providers.ts keys it by party and drops the
  // address), kept because the interface exists for the persisting providers, where a lender's state
  // must not carry across deployments. The desk does the same before its pledge.
  providers.privateStateProvider.setContractAddress(bundle.contractAddress);
  await providers.privateStateProvider.set('lender', privateState);
  return (await findDeployedContract(providers, {
    contractAddress: bundle.contractAddress,
    compiledContract: deskContract(),
    privateStateId: 'lender' as const,
    initialPrivateState: privateState,
  } as never)) as unknown as CallTx;
};

export type LenderAction = 'accept' | 'decline' | 'release';

const CIRCUIT: Record<LenderAction, 'acceptPledge' | 'declinePledge' | 'release'> = {
  accept: 'acceptPledge',
  decline: 'declinePledge',
  release: 'release',
};

/**
 * Accepts, declines or releases one pledge. All three take the same private state because all three
 * recompute the note commitment from the lender's own secret and the opening — that recompute is what
 * makes the lender of record the only party able to act, with no owner field on chain to check.
 */
export const act = async (
  connection: Connection,
  bundle: DemoBundle,
  lenderSecret: Uint8Array,
  opening: NoteOpening,
  action: LenderAction,
): Promise<Sent> => {
  const contract = await joinAsLender(connection, bundle, { secretKey: lenderSecret, releaseNote: opening });
  const tx = await contract.callTx[CIRCUIT[action]]();
  return { txHash: tx.public.txHash, blockHeight: tx.public.blockHeight };
};

export type Draw = Sent & { readonly drawId: string; readonly floor: bigint; readonly round: string };

/**
 * Proves four receivables pledged to this lender are together worth at least `floor` grosz. What the
 * chain gets is the floor and an unlinkable draw id; the amounts, which receivables they are, and
 * which lender drew all stay here.
 *
 * An overstated floor is refused while the proof is being built, so it costs no transaction and
 * leaves nothing on chain to say it was tried.
 */
export const proveBorrowingBase = async (
  connection: Connection,
  bundle: DemoBundle,
  lenderSecret: Uint8Array,
  pool: readonly NoteOpening[],
  floor: bigint,
  // The round the caller displayed, rather than currentRound() again: a tab left open across UTC
  // midnight would otherwise submit a round the page never showed, and the draw id with it.
  round: string,
): Promise<Draw> => {
  if (pool.length !== POOL_SIZE) {
    throw new Error(`A borrowing-base draw needs exactly ${POOL_SIZE} openings; this one has ${pool.length}.`);
  }
  const bytes = roundBytes(round);
  const contract = await joinAsLender(connection, bundle, { secretKey: lenderSecret, pool });
  const tx = await contract.callTx.proveBorrowingBase(bytes, floor);
  return {
    txHash: tx.public.txHash,
    blockHeight: tx.public.blockHeight,
    drawId: hex(Registry.pureCircuits.drawId(bytes, lenderSecret)),
    floor,
    round,
  };
};
