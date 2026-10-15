// SPDX-License-Identifier: Apache-2.0
// End-to-end scenario against a deployed registry:
//   1. two of the three registrars approve lender A; one approval alone is refused
//   2. the committee admits lender B the same way
//   3. borrower pledges a KSeF invoice to lender A
//   4. borrower tries to pledge the same invoice to lender B  -> rejected, no proof can be built
//   5. lender A accepts; lender B declines a second invoice, which frees the receivable
//   6. the freed invoice is financed by lender A instead
//   7. lender A builds a book of four and proves it clears a floor, revealing no amount
//   8. lender A releases the first pledge (invoice paid)
//   9. the committee rotates itself, retiring the previous epoch's membership
// Every accepted step is a real transaction; tx ids are appended to deployments/<network>.json.
// The public record names invoices only as "invoice 1/2": publishing their KSeF numbers next to
// transaction hashes would create exactly the link the registry exists to avoid.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import {
  addressBytes,
  attest,
  invoiceCommitment,
  lenderEncryptionKey,
  newSalt,
  parseKsefNumber,
  receivableTag,
  sealOpening,
  syntheticKsefNumber,
  type InvoiceFields,
} from '@onepledge/attester';
import { Registry, type Attestation, type OnePledgePrivateState } from '@onepledge/contract';
import { secretsDir, selectNetwork } from './config.js';
import {
  type DeploymentRecord,
  type PartyId,
  type RegistryProviders,
  configureProviders,
  loadParties,
  loadTagAuthority,
  readDeployment,
  registryContract,
  writeDeployment,
} from './providers.js';
import { startWallet, walletSeed } from './wallet.js';

const network = selectNetwork();
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const record: DeploymentRecord = readDeployment(network);
const parties = loadParties(network);
const authority = loadTagAuthority(network);

// Preprod's RPC drops the WebSocket often enough that a nineteen-transaction scenario will not
// finish in one go. Steps already recorded are skipped on a rerun, which only works if the salts
// are the same ones the earlier run pledged under: a fresh salt is a different note, and the lender
// could not decide on a note it never received. So the run's raw material is persisted and reused.
// RESET_DEMO=1 starts a new scenario.
const runFile = path.join(secretsDir, `${network.name}-demo-run.json`);
interface RunState {
  contractAddress: string;
  suffix: string;
  invoiceSalts: string[];
  noteSalts: string[];
}
const hex32 = () => Buffer.from(newSalt()).toString('hex');
const freshRun = (): RunState => ({
  contractAddress: record.contractAddress,
  suffix: randomBytes(5).toString('hex').toUpperCase(),
  invoiceSalts: Array.from({ length: 6 }, hex32),
  noteSalts: Array.from({ length: 6 }, hex32),
});
const loadRun = (): RunState => {
  if (process.env.RESET_DEMO !== '1' && fs.existsSync(runFile)) {
    const saved = JSON.parse(fs.readFileSync(runFile, 'utf8')) as RunState;
    if (saved.contractAddress === record.contractAddress) return saved;
    log('Recorded scenario belongs to an older deployment; starting a new one.');
  }
  const fresh = freshRun();
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(runFile, `${JSON.stringify(fresh, null, 2)}\n`, { mode: 0o600 });
  return fresh;
};
const run = loadRun();
const bytes = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));

/** True once a step with this label has landed, so a rerun does not repeat it. */
const already = (label: string) =>
  record.events.some((e) => e.label === label && e.outcome.startsWith('accepted'));

/** True once a step that deliberately fails has been recorded, so a rerun does not duplicate it. */
const alreadyRefused = (label: string) => record.events.some((e) => e.label === label);

const ctx = await startWallet(await walletSeed(network), network);

// The RPC closes the socket during the initial sync as readily as it does during a submission, and
// the wallet surfaces that as a Wallet.Sync rejection. Nothing has been spent at this point, so
// retrying is free; giving up here would mean a scenario that can only start when Preprod feels like it.
log('Waiting for wallet sync...');
for (let attempt = 1; ; attempt++) {
  try {
    await ctx.wallet.waitForSyncedState();
    break;
  } catch (e) {
    if (attempt >= 6) throw e;
    const tag = (e as { _tag?: string })._tag ?? 'unknown';
    log(`wallet sync failed (${tag}); retrying in 20s (attempt ${attempt} of 6)...`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
}
const providers: RegistryProviders = await configureProviders(ctx, network);
// Time each proof on the local proof server.
let lastProveSeconds: number | undefined;
const proveTx = providers.proofProvider.proveTx.bind(providers.proofProvider);
providers.proofProvider.proveTx = async (...args: Parameters<typeof proveTx>) => {
  const started = performance.now();
  const proven = await proveTx(...args);
  lastProveSeconds = Math.round((performance.now() - started) / 100) / 10;
  return proven;
};
// Private state is scoped per contract; bind the store to this deployment before writing to it.
providers.privateStateProvider.setContractAddress(record.contractAddress);

type TxPublic = { txId: string; txHash: string; blockHeight: number };

const join = async (party: PartyId, state: OnePledgePrivateState) => {
  await providers.privateStateProvider.set(party, state);
  return findDeployedContract(providers, {
    contractAddress: record.contractAddress,
    compiledContract: registryContract,
    privateStateId: party,
    initialPrivateState: state,
  } as never) as Promise<{ callTx: Record<string, (...args: unknown[]) => Promise<{ public: TxPublic }>> }>;
};

let callStarted = performance.now();
const startCall = () => {
  callStarted = performance.now();
  lastProveSeconds = undefined;
};

const note = (label: string, circuit: string, outcome: string, tx?: TxPublic) => {
  const totalSeconds = tx ? Math.round((performance.now() - callStarted) / 100) / 10 : undefined;
  record.events.push({
    label,
    circuit,
    txId: tx?.txId,
    txHash: tx?.txHash,
    blockHeight: tx?.blockHeight,
    outcome,
    at: new Date().toISOString(),
    proveSeconds: tx ? lastProveSeconds : undefined,
    totalSeconds,
  });
  writeDeployment(network, record);
  const timing = tx ? `, proved in ${lastProveSeconds}s, finalized after ${totalSeconds}s` : '';
  log(`${label}: ${outcome}${tx ? ` (tx hash ${tx.txHash}, block ${tx.blockHeight}${timing})` : ''}`);
};

const lenderKey = (s: Uint8Array) => Registry.pureCircuits.lenderKey(s);

type Ledger = ReturnType<typeof Registry.ledger>;

// The Preprod RPC sometimes closes the WebSocket as a transaction is sent ("Normal Closure").
// Retry only that failure, and only if a public counter shows nothing landed. An approval moves no
// counter of its own, so the caller passes a probe for those (the approval count of its action).
const probeFor = (circuit: string): ((l: Ledger) => bigint) => {
  if (circuit === 'executeAdmit') return (l) => l.lenders.firstFree();
  if (circuit === 'executeRotate') return (l) => l.committeeEpoch;
  if (circuit === 'release') return (l) => l.releaseCount;
  if (circuit === 'acceptPledge') return (l) => l.acceptCount;
  if (circuit === 'declinePledge') return (l) => l.declineCount;
  if (circuit === 'proveBorrowingBase') return (l) => l.drawCount;
  return (l) => l.pledgeCount;
};

const readCounter = async (probe: (l: Ledger) => bigint) => {
  const state = await providers.publicDataProvider.queryContractState(record.contractAddress);
  if (!state) throw new Error('Contract state not found');
  return probe(Registry.ledger(state.data));
};

/**
 * Submits one call, retrying only the RPC's own disconnect and only when the chain shows nothing
 * landed. When the counter did move, the transaction is on chain and retrying it would be refused by
 * the circuit, so this returns undefined: the step succeeded and its hash is simply unknown to us.
 */
/**
 * Lets the wallet catch up with its own last transaction. A transaction the indexer calls finalized
 * is not yet one the wallet has applied to its coin set, and balancing the next one against coins the
 * previous one already spent is rejected by the node as `Invalid Transaction: Custom error: 170`.
 * Observed three times on 2026-10-15, always about ten seconds after a successful submission.
 */
const letWalletSettle = async () => {
  // waitForSyncedState rejects with Wallet.Sync when the indexer stream hiccups, which happens often
  // enough on Preprod that letting it abort a scenario would be worse than not waiting at all. The
  // fixed pause is the part that actually prevents the double-spend, so it runs either way.
  await ctx.wallet.waitForSyncedState().catch((e: unknown) => {
    log(`wallet sync reported an error while settling (${(e as { _tag?: string })._tag ?? 'unknown'}); pausing anyway`);
  });
  await new Promise((r) => setTimeout(r, 8_000));
};

/** The failures Preprod produces that are worth retrying rather than aborting a scenario on. All
 *  three are transient, and the ledger-counter check below is what makes retrying them safe. */
const retryable = (e: unknown) => {
  const text = inspect(e, { depth: 12 });
  if (/Normal Closure|Abnormal Closure|disconnected from wss/.test(text)) return 'the RPC dropped the connection';
  if (/Custom error: 170/.test(text)) return 'the node rejected it as invalid, which here means the wallet had not caught up';
  if (/Wallet\.Sync/.test(text)) return "the wallet's sync stream failed, which can happen while it balances";
  return undefined;
};

const submit = async (
  circuit: string,
  call: () => Promise<{ public: TxPublic }>,
  probe: (l: Ledger) => bigint = probeFor(circuit),
): Promise<TxPublic | undefined> => {
  for (let attempt = 1; ; attempt++) {
    const before = await readCounter(probe);
    startCall();
    try {
      const tx = (await call()).public;
      await letWalletSettle();
      return tx;
    } catch (e) {
      const reason = retryable(e);
      if (!reason || attempt >= 4) throw e;
      log(`${circuit}: ${reason} (attempt ${attempt}); checking the chain before retrying...`);
      await new Promise((r) => setTimeout(r, 30_000));
      if ((await readCounter(probe)) !== before) {
        log(`${circuit}: the ledger moved, so it landed; continuing without its transaction hash.`);
        await letWalletSettle();
        return undefined;
      }
      await letWalletSettle();
    }
  }
};

/** Records a step that landed, whether or not we learned its transaction hash. */
const landed = (label: string, circuit: string, tx: TxPublic | undefined) =>
  note(label, circuit, tx ? 'accepted' : 'accepted (submission disconnected; confirmed by the ledger counter)', tx);

/** The opening the lender of record will need, encrypted so only it can read it. */
const sealFor = (lenderSecret: Uint8Array, att: { attestation: Attestation }, noteSalt: Uint8Array) =>
  sealOpening(lenderEncryptionKey(lenderSecret), {
    tag: att.attestation.tag,
    invoiceCommit: att.attestation.invoiceCommit,
    amount: att.attestation.amount,
    salt: noteSalt,
  });

/**
 * The attestation for one invoice. `salt` comes from the persisted run so the invoice commitment —
 * and therefore the note commitment — is identical across reruns. The signature's nonce is fresh
 * each time and need not be stable: it is not part of the note.
 */
const attestFor = (ksefNumber: string, amountGrosz: string, salt: Uint8Array) => {
  const parsed = parseKsefNumber(ksefNumber);
  const fields: InvoiceFields = {
    ksefNumber: parsed.canonical,
    sellerNip: parsed.sellerNip,
    debtorNip: '7010002139',
    amountGrosz,
    currency: 'PLN',
    dueDate: '2026-11-30',
  };
  const attestation = attest(authority.sk, {
    amount: BigInt(amountGrosz),
    registry: addressBytes(record.contractAddress),
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400),
    tag: receivableTag(authority.tagSecret, parsed.canonical),
    invoiceCommit: invoiceCommitment(fields, salt),
    acceptanceDay: parsed.acceptanceDay,
    borrower: Registry.pureCircuits.borrowerKey(parties.borrower),
  });
  return { fields, salt, attestation };
};

// Synthetic, clearly labelled KSeF numbers (real ones are assigned by KSeF).
const invoice1 = syntheticKsefNumber('5265877635', '2026-09-10', `01${run.suffix}`);
const invoice2 = syntheticKsefNumber('5265877635', '2026-09-11', `02${run.suffix}`);
const invoice3 = syntheticKsefNumber('5265877635', '2026-09-12', `03${run.suffix}`);
const invoice4 = syntheticKsefNumber('5265877635', '2026-09-13', `04${run.suffix}`);

// 1. The 2-of-3 registrar committee admits both lenders. All three seats are the deployer's here;
//    the contract only ever sees key commitments, and nothing about the mechanism depends on that.
// Sequentially, not Promise.all: the private-state store is a LevelDB, and three concurrent first
// reads each try to open it, so the second and third die on its lock.
const seats: Awaited<ReturnType<typeof join>>[] = [];
for (const seat of ['registrar', 'registrar2', 'registrar3'] as const) {
  seats.push(await join(seat, { secretKey: parties[seat] }));
}
const committeeKeys = (['registrar', 'registrar2', 'registrar3'] as const).map((seat) =>
  Registry.pureCircuits.registrarKey(parties[seat]),
);

const approvalsFor = async (lender: Uint8Array, encryptionKey: Uint8Array) => {
  const state = await providers.publicDataProvider.queryContractState(record.contractAddress);
  if (!state) throw new Error('Contract state not found');
  const l = Registry.ledger(state.data);
  const action = Registry.pureCircuits.admitAction(l.committeeEpoch, lender, encryptionKey);
  return l.proposals.member(action) ? l.proposals.lookup(action).size() : 0n;
};

const admit = async (label: string, secret: Uint8Array, showThresholdRefusal = false) => {
  const lender = lenderKey(secret);
  const encryptionKey = lenderEncryptionKey(secret);
  const approvalProbe = (l: Ledger) => {
    const action = Registry.pureCircuits.admitAction(l.committeeEpoch, lender, encryptionKey);
    return l.proposals.member(action) ? l.proposals.lookup(action).size() : 0n;
  };

  for (const [i, seat] of [seats[0], seats[1]].entries()) {
    const stepLabel = `Registrar ${i + 1} approves ${label}`;
    if (already(stepLabel)) {
      log(`${stepLabel}: already recorded, skipping`);
    } else {
      landed(stepLabel, 'approveAdmit', await submit('approveAdmit', () => seat.callTx.approveAdmit(lender, encryptionKey), approvalProbe));
    }

    // After the first approval only, show that one registrar cannot admit on its own. The assert
    // fires while the proof is being built, so this costs no transaction and no DUST.
    const refusalLabel = `One registrar alone admits ${label}`;
    if (i === 0 && showThresholdRefusal && !alreadyRefused(refusalLabel)) {
      try {
        await seats[0].callTx.executeAdmit(lender, encryptionKey);
        note(refusalLabel, 'executeAdmit', 'UNEXPECTEDLY ACCEPTED');
        throw new Error('A single registrar admitted a lender; aborting demo');
      } catch (e) {
        const message = (e as Error).message;
        if (!/Below the registrar threshold/.test(message)) throw e;
        const reason = /failed assert: ([^\n]*)/.exec(message)?.[1] ?? message.split('\n')[0];
        note(refusalLabel, 'executeAdmit', `rejected before proving: ${reason}`);
      }
    }
  }

  const stepLabel = `Committee admits ${label}`;
  if (already(stepLabel)) {
    log(`${stepLabel}: already recorded, skipping`);
    return;
  }
  log(`${label}: ${await approvalsFor(lender, encryptionKey)} of 2 approvals gathered`);
  landed(stepLabel, 'executeAdmit', await submit('executeAdmit', () => seats[2].callTx.executeAdmit(lender, encryptionKey)));
};

await admit('lender A', parties.lenderA, true);
await admit('lender B', parties.lenderB);

// Every invoice this scenario uses, with the salts the persisted run fixed. Pledging the same
// invoice twice to different lenders is deliberate (step 3) and so is re-pledging a freed one
// (step 7), so an invoice can appear more than once with different note salts.
const invoices = {
  one: { label: 'invoice 1', number: invoice1, amount: '12500000', invoiceSalt: bytes(run.invoiceSalts[0]) },
  two: { label: 'invoice 2', number: invoice2, amount: '8300000', invoiceSalt: bytes(run.invoiceSalts[1]) },
  three: { label: 'invoice 3', number: invoice3, amount: '4100000', invoiceSalt: bytes(run.invoiceSalts[2]) },
  four: { label: 'invoice 4', number: invoice4, amount: '6700000', invoiceSalt: bytes(run.invoiceSalts[3]) },
};
const att = {
  one: attestFor(invoices.one.number, invoices.one.amount, invoices.one.invoiceSalt),
  two: attestFor(invoices.two.number, invoices.two.amount, invoices.two.invoiceSalt),
  three: attestFor(invoices.three.number, invoices.three.amount, invoices.three.invoiceSalt),
  four: attestFor(invoices.four.number, invoices.four.amount, invoices.four.invoiceSalt),
};
const noteSalt = run.noteSalts.map(bytes);

/** The opening a lender of record holds for one pledge. */
const openingOf = (a: { attestation: Attestation }, salt: Uint8Array) => ({
  tag: a.attestation.tag,
  invoiceCommit: a.attestation.invoiceCommit,
  amount: a.attestation.amount,
  salt,
});

const borrower = await join('borrower', { secretKey: parties.borrower });

/** One pledge, resumable: the note is identical on a rerun because the salts are persisted. */
const pledge = async (
  label: string,
  attestation: { attestation: Attestation },
  lenderSecret: Uint8Array,
  salt: Uint8Array,
) => {
  if (already(label)) {
    log(`${label}: already recorded, skipping`);
    return;
  }
  await providers.privateStateProvider.set('borrower', {
    secretKey: parties.borrower,
    attestation: attestation.attestation,
    pledgeLender: lenderKey(lenderSecret),
    noteSalt: salt,
  });
  landed(
    label,
    'pledge',
    await submit('pledge', () => borrower.callTx.pledge(lenderKey(lenderSecret), sealFor(lenderSecret, attestation, salt))),
  );
};

/** One step that the circuit is supposed to refuse. Costs no transaction, so it proves the refusal
 *  happens before anything is spent. */
const expectRefusal = async (label: string, circuit: string, pattern: RegExp, call: () => Promise<unknown>) => {
  if (alreadyRefused(label)) {
    log(`${label}: already recorded, skipping`);
    return;
  }
  try {
    await call();
    note(label, circuit, 'UNEXPECTEDLY ACCEPTED');
    throw new Error(`${label} was accepted; aborting demo`);
  } catch (e) {
    const message = (e as Error).message;
    if (!pattern.test(message)) throw e;
    const reason = /failed assert: ([^\n]*)/.exec(message)?.[1] ?? message.split('\n')[0];
    note(label, circuit, `rejected before proving: ${reason}`);
  }
};

// 2. Borrower pledges invoice 1 to lender A.
await pledge('Borrower pledges invoice 1 to lender A', att.one, parties.lenderA, noteSalt[0]);

// 3. Same invoice, freshly attested, different lender: refused before a proof can be built.
await providers.privateStateProvider.set('borrower', {
  secretKey: parties.borrower,
  attestation: attestFor(invoices.one.number, invoices.one.amount, invoices.one.invoiceSalt).attestation,
  pledgeLender: lenderKey(parties.lenderB),
  noteSalt: noteSalt[4],
});
await expectRefusal('Borrower re-pledges invoice 1 to lender B', 'pledge', /already pledged/, () =>
  borrower.callTx.pledge(lenderKey(parties.lenderB), new Uint8Array()),
);

// 4. Lender A takes the pledge. Until this runs it is a one-sided claim by the borrower.
const lenderA = await join('lenderA', { secretKey: parties.lenderA, releaseNote: openingOf(att.one, noteSalt[0]) });
if (already('Lender A accepts invoice 1')) {
  log('Lender A accepts invoice 1: already recorded, skipping');
} else {
  landed('Lender A accepts invoice 1', 'acceptPledge', await submit('acceptPledge', () => lenderA.callTx.acceptPledge()));
}

// 5. A different invoice to lender B goes through.
await pledge('Borrower pledges invoice 2 to lender B', att.two, parties.lenderB, noteSalt[1]);

// 6. Lender B refuses it, which frees the receivable. Before Wave 2 a pledge no lender agreed to
//    burned the invoice forever (security review F10).
const lenderB = await join('lenderB', { secretKey: parties.lenderB, releaseNote: openingOf(att.two, noteSalt[1]) });
const declineLabel = 'Lender B declines invoice 2, freeing the receivable';
if (already(declineLabel)) {
  log(`${declineLabel}: already recorded, skipping`);
} else {
  landed(declineLabel, 'declinePledge', await submit('declinePledge', () => lenderB.callTx.declinePledge()));
}

// 7. The freed invoice is financed elsewhere: the proof that declining really releases the tag.
//    A fresh attestation of the same invoice, pledged under a different note salt.
const att2again = attestFor(invoices.two.number, invoices.two.amount, invoices.two.invoiceSalt);
await pledge('Borrower pledges the freed invoice 2 to lender A', att2again, parties.lenderA, noteSalt[2]);

// 8. Two more invoices to lender A, so its book is four receivables deep: the pool size the
//    borrowing-base circuit is compiled for.
await pledge('Borrower pledges invoice 3 to lender A', att.three, parties.lenderA, noteSalt[3]);
await pledge('Borrower pledges invoice 4 to lender A', att.four, parties.lenderA, noteSalt[5]);

// 9. Lender A proves to its own funder that the book behind a drawdown clears a floor. The four
//    openings are the ones the borrower sealed to it; the amounts, and which receivables are in the
//    pool, stay private. Only the floor and an unlinkable draw id reach the chain.
const pool = [
  openingOf(att.one, noteSalt[0]),
  openingOf(att2again, noteSalt[2]),
  openingOf(att.three, noteSalt[3]),
  openingOf(att.four, noteSalt[5]),
];
const poolTotal = pool.reduce((sum, n) => sum + n.amount, 0n);
const round = new Uint8Array(Buffer.from(`onepledge:demo:${run.suffix}`.padEnd(32, '.').slice(0, 32), 'ascii'));
const floor = (poolTotal / 1_000_000n) * 1_000_000n; // a round figure at or below the true total

// The release opening stays alongside the pool: the same lender still has invoice 1 to release.
await providers.privateStateProvider.set('lenderA', { secretKey: parties.lenderA, releaseNote: pool[0], pool });

const drawLabel = `Lender A proves a borrowing base of at least ${floor} grosz`;
if (already(drawLabel)) {
  log(`${drawLabel}: already recorded, skipping`);
} else {
  log(`Lender A's book is ${pool.length} receivables; it will prove at least ${floor} grosz without naming an amount`);
  landed(drawLabel, 'proveBorrowingBase', await submit('proveBorrowingBase', () => lenderA.callTx.proveBorrowingBase(round, floor)));
}

await expectRefusal(
  'Lender A overstates its borrowing base',
  'proveBorrowingBase',
  /Pool does not clear the floor/,
  () => lenderA.callTx.proveBorrowingBase(round, poolTotal + 1n),
);

// 10. Lender A releases invoice 1 (paid). Done after the draw: a paid receivable should not be in
//     the book behind a drawdown.
if (already('Lender A releases invoice 1')) {
  log('Lender A releases invoice 1: already recorded, skipping');
} else {
  landed('Lender A releases invoice 1', 'release', await submit('release', () => lenderA.callTx.release()));
}

// 11. The committee rotates itself. The seats are deliberately the same three keys: what this shows
//     is the mechanism — two approvals move the registry to a new epoch, and the previous epoch's
//     membership stops working — not a change of custody, which the demo cannot honestly claim.
const rotateLabel = 'Committee rotates itself to a new epoch';
if (already(rotateLabel)) {
  log(`${rotateLabel}: already recorded, skipping`);
} else {
  const rotateApprovals = (l: Ledger) => {
    const action = Registry.pureCircuits.rotateAction(l.committeeEpoch, committeeKeys[0], committeeKeys[1], committeeKeys[2]);
    return l.proposals.member(action) ? l.proposals.lookup(action).size() : 0n;
  };
  for (const [i, seat] of [seats[0], seats[1]].entries()) {
    const stepLabel = `Registrar ${i + 1} approves the rotation`;
    if (already(stepLabel)) {
      log(`${stepLabel}: already recorded, skipping`);
      continue;
    }
    landed(stepLabel, 'approveRotate', await submit('approveRotate', () => seat.callTx.approveRotate(committeeKeys), rotateApprovals));
  }
  landed(rotateLabel, 'executeRotate', await submit('executeRotate', () => seats[2].callTx.executeRotate(committeeKeys)));
  log(`Rotation complete; the registry is now on committee epoch ${await readCounter((l) => l.committeeEpoch)}.`);
}

// No snapshot here: this run submitted transactions (see saveSnapshot).
await ctx.wallet.stop();
log('Demo complete.');
process.exit(0);
