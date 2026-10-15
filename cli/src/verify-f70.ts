// SPDX-License-Identifier: Apache-2.0
// Proves, against the deployed registry, that the F70 repair took.
//
// F70: `proveBorrowingBase` compared the four pool items' note *commitments* for distinctness.
// Declining a pledge frees the tag but leaves the note in the append-only tree, and the declining
// lender keeps its opening, so one receivable pledged, declined and pledged again to the same lender
// yields two different commitments for one invoice. The fix compares the tags. The fixed verifier key
// was swapped into the live contract in place (`npm run replace:vk`), which leaves two questions a
// simulator cannot answer:
//
//   1. Does the repaired circuit still prove and verify against the key now on chain? If the swap had
//      gone wrong the draw would fail verification, and nothing short of a real draw shows that.
//   2. Is the hole actually closed on the deployment, rather than only in the repository?
//
// So this builds the attack for real: it has the lender decline one of its own notes, has the borrower
// pledge that same invoice to the same lender again, and then offers a pool holding both notes. The
// refusal costs no transaction — the assert fires while the proof is being built — which is the point:
// an honest client never gets as far as asking the chain. Then it proves a clean draw over four
// genuinely distinct receivables, which does land, and that is the transaction that demonstrates the
// swapped key works.
//
//   npx -y node@22 --import tsx src/verify-f70.ts
//
// Resumable in the same way as the scenario: salts are persisted, and a step already recorded as
// accepted is skipped.

import fs from 'node:fs';
import path from 'node:path';
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

// The scenario's own run state: its invoice numbers and salts are what lender A's existing book is
// made of, and this check builds on that book rather than starting a second one.
const scenarioFile = path.join(secretsDir, `${network.name}-demo-run.json`);
if (!fs.existsSync(scenarioFile)) {
  console.error(`No scenario run state at ${scenarioFile}. Run \`npm run demo\` against this deployment first.`);
  process.exit(1);
}
const scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8')) as {
  contractAddress: string;
  suffix: string;
  invoiceSalts: string[];
  noteSalts: string[];
};
if (scenario.contractAddress !== record.contractAddress) {
  console.error('The recorded scenario belongs to a different deployment. Re-run `npm run demo` first.');
  process.exit(1);
}

const ownFile = path.join(secretsDir, `${network.name}-f70-run.json`);
const hex32 = () => Buffer.from(newSalt()).toString('hex');
interface OwnState {
  contractAddress: string;
  /** Invoice 5: a fifth receivable, so the clean pool needs nothing declined or already released. */
  fifthInvoiceSalt: string;
  fifthNoteSalt: string;
  /** The salt invoice 3 is pledged under the second time, after it has been declined. */
  rePledgeNoteSalt: string;
}
const loadOwn = (): OwnState => {
  if (fs.existsSync(ownFile)) {
    const saved = JSON.parse(fs.readFileSync(ownFile, 'utf8')) as OwnState;
    if (saved.contractAddress === record.contractAddress) return saved;
  }
  const fresh: OwnState = {
    contractAddress: record.contractAddress,
    fifthInvoiceSalt: hex32(),
    fifthNoteSalt: hex32(),
    rePledgeNoteSalt: hex32(),
  };
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(ownFile, `${JSON.stringify(fresh, null, 2)}\n`, { mode: 0o600 });
  return fresh;
};
const own = loadOwn();
const bytes = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));

const ctx = await startWallet(await walletSeed(network), network);
log('Waiting for wallet sync...');
for (let attempt = 1; ; attempt++) {
  try {
    await ctx.wallet.waitForSyncedState();
    break;
  } catch (e) {
    if (attempt >= 6) throw e;
    log(`wallet sync failed; retrying in 20s (attempt ${attempt} of 6)...`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
}
const providers: RegistryProviders = await configureProviders(ctx, network);
providers.privateStateProvider.setContractAddress(record.contractAddress);

type TxPublic = { txId: string; txHash: string; blockHeight: number };
type Ledger = ReturnType<typeof Registry.ledger>;

const join = async (party: PartyId, state: OnePledgePrivateState) => {
  await providers.privateStateProvider.set(party, state);
  return findDeployedContract(providers, {
    contractAddress: record.contractAddress,
    compiledContract: registryContract,
    privateStateId: party,
    initialPrivateState: state,
  } as never) as Promise<{ callTx: Record<string, (...args: unknown[]) => Promise<{ public: TxPublic }>> }>;
};

const already = (label: string) =>
  record.events.some((e) => e.label === label && e.outcome.startsWith('accepted'));
const alreadyRefused = (label: string) => record.events.some((e) => e.label === label);

const note = (label: string, circuit: string, outcome: string, tx?: TxPublic) => {
  record.events.push({
    label,
    circuit,
    txId: tx?.txId,
    txHash: tx?.txHash,
    blockHeight: tx?.blockHeight,
    outcome,
    at: new Date().toISOString(),
  });
  writeDeployment(network, record);
  log(`${label}: ${outcome}${tx ? ` (tx hash ${tx.txHash}, block ${tx.blockHeight})` : ''}`);
};

const readLedger = async (): Promise<Ledger> => {
  const state = await providers.publicDataProvider.queryContractState(record.contractAddress);
  if (!state) throw new Error('Contract state not found');
  return Registry.ledger(state.data);
};

const settle = async () => {
  await ctx.wallet.waitForSyncedState().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 8_000));
};

const retryable = (e: unknown) => {
  const text = inspect(e, { depth: 12 });
  return /Normal Closure|Abnormal Closure|disconnected from wss|Custom error: 170|Wallet\.Sync/.test(text);
};

const submit = async (
  circuit: string,
  call: () => Promise<{ public: TxPublic }>,
  probe: (l: Ledger) => bigint,
): Promise<TxPublic | undefined> => {
  for (let attempt = 1; ; attempt++) {
    const before = probe(await readLedger());
    try {
      const tx = (await call()).public;
      await settle();
      return tx;
    } catch (e) {
      if (!retryable(e) || attempt >= 4) throw e;
      log(`${circuit}: transient failure (attempt ${attempt}); checking the chain before retrying...`);
      await new Promise((r) => setTimeout(r, 30_000));
      if (probe(await readLedger()) !== before) {
        log(`${circuit}: the ledger moved, so it landed; continuing without its transaction hash.`);
        await settle();
        return undefined;
      }
      await settle();
    }
  }
};

const lenderKey = (s: Uint8Array) => Registry.pureCircuits.lenderKey(s);

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
  return {
    fields,
    attestation: attest(authority.sk, {
      amount: BigInt(amountGrosz),
      registry: addressBytes(record.contractAddress),
      expiresAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400),
      tag: receivableTag(authority.tagSecret, parsed.canonical),
      invoiceCommit: invoiceCommitment(fields, salt),
      acceptanceDay: parsed.acceptanceDay,
      borrower: Registry.pureCircuits.borrowerKey(parties.borrower),
    }),
  };
};

const openingOf = (a: { attestation: Attestation }, salt: Uint8Array) => ({
  tag: a.attestation.tag,
  invoiceCommit: a.attestation.invoiceCommit,
  amount: a.attestation.amount,
  salt,
});

const sealFor = (lenderSecret: Uint8Array, a: { attestation: Attestation }, salt: Uint8Array) =>
  sealOpening(lenderEncryptionKey(lenderSecret), openingOf(a, salt));

// The scenario's invoices, rebuilt from its persisted salts.
const inv = {
  two: attestFor(syntheticKsefNumber('5265877635', '2026-09-11', `02${scenario.suffix}`), '8300000', bytes(scenario.invoiceSalts[1])),
  three: attestFor(syntheticKsefNumber('5265877635', '2026-09-12', `03${scenario.suffix}`), '4100000', bytes(scenario.invoiceSalts[2])),
  four: attestFor(syntheticKsefNumber('5265877635', '2026-09-13', `04${scenario.suffix}`), '6700000', bytes(scenario.invoiceSalts[3])),
  five: attestFor(syntheticKsefNumber('5265877635', '2026-09-14', `05${scenario.suffix}`), '5400000', bytes(own.fifthInvoiceSalt)),
};
const salt = {
  twoRe: bytes(scenario.noteSalts[2]),
  three: bytes(scenario.noteSalts[3]),
  four: bytes(scenario.noteSalts[5]),
  five: bytes(own.fifthNoteSalt),
  threeAgain: bytes(own.rePledgeNoteSalt),
};

const borrower = await join('borrower', { secretKey: parties.borrower });
const lenderA = await join('lenderA', { secretKey: parties.lenderA });

// 1. A fifth receivable, so the clean pool at the end needs nothing declined or already paid.
const fifthLabel = 'Borrower pledges invoice 5 to lender A';
if (already(fifthLabel)) {
  log(`${fifthLabel}: already recorded, skipping`);
} else {
  await providers.privateStateProvider.set('borrower', {
    secretKey: parties.borrower,
    attestation: inv.five.attestation,
    pledgeLender: lenderKey(parties.lenderA),
    noteSalt: salt.five,
  });
  const tx = await submit(
    'pledge',
    () => borrower.callTx.pledge(lenderKey(parties.lenderA), sealFor(parties.lenderA, inv.five, salt.five)),
    (l) => l.pledgeCount,
  );
  note(fifthLabel, 'pledge', tx ? 'accepted' : 'accepted (submission disconnected; confirmed by the counter)', tx);
}

// 2. Lender A declines invoice 3. This frees the tag and leaves the note on the ledger, which is
//    exactly the state F70 turned into a double count.
const declineLabel = 'Lender A declines invoice 3, keeping its opening';
if (already(declineLabel)) {
  log(`${declineLabel}: already recorded, skipping`);
} else {
  await providers.privateStateProvider.set('lenderA', {
    secretKey: parties.lenderA,
    releaseNote: openingOf(inv.three, salt.three),
  });
  const tx = await submit('declinePledge', () => lenderA.callTx.declinePledge(), (l) => l.declineCount);
  note(declineLabel, 'declinePledge', tx ? 'accepted' : 'accepted (submission disconnected; confirmed by the counter)', tx);
}

// 3. The borrower pledges the same invoice to the same lender again. Lender A now holds two valid
//    openings for one receivable, under two different note commitments.
const rePledgeLabel = 'Borrower pledges the freed invoice 3 back to lender A';
if (already(rePledgeLabel)) {
  log(`${rePledgeLabel}: already recorded, skipping`);
} else {
  await providers.privateStateProvider.set('borrower', {
    secretKey: parties.borrower,
    attestation: attestFor(inv.three.fields.ksefNumber, inv.three.fields.amountGrosz, bytes(scenario.invoiceSalts[2])).attestation,
    pledgeLender: lenderKey(parties.lenderA),
    noteSalt: salt.threeAgain,
  });
  const tx = await submit(
    'pledge',
    () => borrower.callTx.pledge(lenderKey(parties.lenderA), sealFor(parties.lenderA, inv.three, salt.threeAgain)),
    (l) => l.pledgeCount,
  );
  note(rePledgeLabel, 'pledge', tx ? 'accepted' : 'accepted (submission disconnected; confirmed by the counter)', tx);
}

// 4. The attack. Two notes, one receivable, padded with two real ones. Before the repair this proved
//    a floor the book does not reach; now the circuit refuses it, and refuses it while the proof is
//    being built, so it costs nothing and reaches no node.
const attackLabel = 'Lender A counts invoice 3 twice in one borrowing base';
const padded = [
  openingOf(inv.three, salt.three), // the declined note
  openingOf(inv.three, salt.threeAgain), // the same receivable, pledged again
  openingOf(inv.four, salt.four),
  openingOf(inv.five, salt.five),
];
const paddedTotal = padded.reduce((sum, n) => sum + n.amount, 0n);
const honestTotal = paddedTotal - inv.three.attestation.amount;
if (alreadyRefused(attackLabel)) {
  log(`${attackLabel}: already recorded, skipping`);
} else {
  await providers.privateStateProvider.set('lenderA', { secretKey: parties.lenderA, pool: padded });
  log(`The padded pool claims ${paddedTotal} grosz; the four notes are really worth ${honestTotal}.`);
  try {
    await lenderA.callTx.proveBorrowingBase(new Uint8Array(32).fill(0xf7), paddedTotal);
    note(attackLabel, 'proveBorrowingBase', 'UNEXPECTEDLY ACCEPTED');
    throw new Error('F70 is not fixed on this deployment; aborting');
  } catch (e) {
    const message = (e as Error).message;
    if (!/A receivable appears twice in the pool/.test(message)) throw e;
    const reason = /failed assert: ([^\n]*)/.exec(message)?.[1] ?? message.split('\n')[0];
    note(
      attackLabel,
      'proveBorrowingBase',
      `rejected before proving: ${reason} (claimed ${paddedTotal} grosz against ${honestTotal} genuinely held)`,
    );
  }
}

// 5. A clean draw over four genuinely distinct receivables. This one lands, which is what shows the
//    verifier key swapped into the contract actually verifies the repaired circuit.
const cleanPool = [
  openingOf(inv.two, salt.twoRe),
  openingOf(inv.three, salt.threeAgain),
  openingOf(inv.four, salt.four),
  openingOf(inv.five, salt.five),
];
const cleanTotal = cleanPool.reduce((sum, n) => sum + n.amount, 0n);
const floor = (cleanTotal / 1_000_000n) * 1_000_000n;
const drawLabel = `Lender A proves ${floor} grosz against the repaired circuit`;
if (already(drawLabel)) {
  log(`${drawLabel}: already recorded, skipping`);
} else {
  await providers.privateStateProvider.set('lenderA', { secretKey: parties.lenderA, pool: cleanPool });
  log(`Clean pool: four distinct receivables worth ${cleanTotal} grosz; proving at least ${floor}.`);
  const round = new Uint8Array(Buffer.from(`onepledge:f70:${scenario.suffix}`.padEnd(32, '.').slice(0, 32), 'ascii'));
  const tx = await submit(
    'proveBorrowingBase',
    () => lenderA.callTx.proveBorrowingBase(round, floor),
    (l) => l.drawCount,
  );
  note(drawLabel, 'proveBorrowingBase', tx ? 'accepted' : 'accepted (submission disconnected; confirmed by the counter)', tx);
}

await ctx.wallet.stop();
log('F70 verified on the deployed registry: the attack is refused, and a clean draw still proves.');
process.exit(0);
