// SPDX-License-Identifier: Apache-2.0
// End-to-end scenario against a deployed registry:
//   1. registrar admits lenders A and B
//   2. borrower pledges a KSeF invoice to lender A
//   3. borrower tries to pledge the same invoice to lender B  -> rejected, no proof can be built
//   4. borrower pledges a second invoice to lender B           -> accepted
//   5. lender A releases the first pledge (invoice paid)
// Every accepted step is a real transaction; tx ids are appended to deployments/<network>.json.

import { randomBytes } from 'node:crypto';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import {
  attest,
  invoiceCommitment,
  newSalt,
  parseKsefNumber,
  receivableTag,
  syntheticKsefNumber,
  type InvoiceFields,
} from '@onepledge/attester';
import { Registry, type OnePledgePrivateState } from '@onepledge/contract';
import { selectNetwork } from './config.js';
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
import { saveSnapshot, startWallet, walletSeed } from './wallet.js';

const network = selectNetwork();
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const record: DeploymentRecord = readDeployment(network);
const parties = loadParties(network);
const authority = loadTagAuthority(network);

const ctx = await startWallet(await walletSeed(network), network);
log('Waiting for wallet sync...');
await ctx.wallet.waitForSyncedState();
const providers: RegistryProviders = await configureProviders(ctx, network);

type TxPublic = { txId: string; blockHeight: number };

const join = async (party: PartyId, state: OnePledgePrivateState) => {
  await providers.privateStateProvider.set(party, state);
  return findDeployedContract(providers, {
    contractAddress: record.contractAddress,
    compiledContract: registryContract,
    privateStateId: party,
    initialPrivateState: state,
  } as never) as Promise<{ callTx: Record<string, (...args: unknown[]) => Promise<{ public: TxPublic }>> }>;
};

const note = (label: string, circuit: string, outcome: string, tx?: TxPublic) => {
  record.events.push({ label, circuit, txId: tx?.txId, blockHeight: tx?.blockHeight, outcome, at: new Date().toISOString() });
  writeDeployment(network, record);
  log(`${label}: ${outcome}${tx ? ` (tx ${tx.txId}, block ${tx.blockHeight})` : ''}`);
};

const lenderKey = (s: Uint8Array) => Registry.pureCircuits.lenderKey(s);

const attestFor = (ksefNumber: string, amountGrosz: string) => {
  const parsed = parseKsefNumber(ksefNumber);
  const fields: InvoiceFields = {
    ksefNumber: parsed.canonical,
    sellerNip: parsed.sellerNip,
    debtorNip: '7010002139',
    amountGrosz,
    currency: 'PLN',
    dueDate: '2026-11-30',
  };
  const salt = newSalt();
  const attestation = attest(authority.sk, {
    tag: receivableTag(authority.tagSecret, parsed.canonical),
    invoiceCommit: invoiceCommitment(fields, salt),
    acceptanceDay: parsed.acceptanceDay,
    borrower: Registry.pureCircuits.borrowerKey(parties.borrower),
  });
  return { fields, salt, attestation };
};

// Synthetic, clearly labelled KSeF numbers (real ones are assigned by KSeF).
const suffix = randomBytes(5).toString('hex').toUpperCase();
const invoice1 = syntheticKsefNumber('5265877635', '2026-09-10', `01${suffix}`);
const invoice2 = syntheticKsefNumber('5265877635', '2026-09-11', `02${suffix}`);

// 1. Registrar admits both lenders.
const registrar = await join('registrar', { secretKey: parties.registrar });
for (const [label, secret] of [['lender A', parties.lenderA], ['lender B', parties.lenderB]] as const) {
  const tx = await registrar.callTx.admitLender(lenderKey(secret));
  note(`Registrar admits ${label}`, 'admitLender', 'accepted', tx.public);
}

// 2. Borrower pledges invoice 1 to lender A.
const att1 = attestFor(invoice1, '12500000');
const noteSalt1 = newSalt();
const borrowerA = await join('borrower', {
  secretKey: parties.borrower,
  attestation: att1.attestation,
  pledgeLender: lenderKey(parties.lenderA),
  noteSalt: noteSalt1,
});
const pledged = await borrowerA.callTx.pledge(lenderKey(parties.lenderA));
note(`Borrower pledges ${invoice1} to lender A`, 'pledge', 'accepted', pledged.public);

// 3. Same invoice, fresh attestation, different lender: must be rejected.
const again = attestFor(invoice1, '12500000');
await providers.privateStateProvider.set('borrower', {
  secretKey: parties.borrower,
  attestation: again.attestation,
  pledgeLender: lenderKey(parties.lenderB),
  noteSalt: newSalt(),
});
try {
  await borrowerA.callTx.pledge(lenderKey(parties.lenderB));
  note(`Borrower re-pledges ${invoice1} to lender B`, 'pledge', 'UNEXPECTEDLY ACCEPTED');
  throw new Error('Double pledge was accepted; aborting demo');
} catch (e) {
  const message = (e as Error).message;
  if (!/already pledged/.test(message)) throw e;
  note(`Borrower re-pledges ${invoice1} to lender B`, 'pledge', `rejected: ${message.split('\n')[0]}`);
}

// 4. A different invoice to lender B goes through.
const att2 = attestFor(invoice2, '8300000');
await providers.privateStateProvider.set('borrower', {
  secretKey: parties.borrower,
  attestation: att2.attestation,
  pledgeLender: lenderKey(parties.lenderB),
  noteSalt: newSalt(),
});
const pledged2 = await borrowerA.callTx.pledge(lenderKey(parties.lenderB));
note(`Borrower pledges ${invoice2} to lender B`, 'pledge', 'accepted', pledged2.public);

// 5. Lender A releases invoice 1 (paid).
const lenderA = await join('lenderA', {
  secretKey: parties.lenderA,
  releaseNote: { tag: att1.attestation.tag, invoiceCommit: att1.attestation.invoiceCommit, salt: noteSalt1 },
});
const released = await lenderA.callTx.release();
note(`Lender A releases ${invoice1}`, 'release', 'accepted', released.public);

await saveSnapshot(ctx, network);
await ctx.wallet.stop();
log('Demo complete.');
process.exit(0);
