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
import { startWallet, walletSeed } from './wallet.js';

const network = selectNetwork();
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const record: DeploymentRecord = readDeployment(network);
const parties = loadParties(network);
const authority = loadTagAuthority(network);

const ctx = await startWallet(await walletSeed(network), network);
log('Waiting for wallet sync...');
await ctx.wallet.waitForSyncedState();
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

const submit = async (
  circuit: string,
  call: () => Promise<{ public: TxPublic }>,
  probe: (l: Ledger) => bigint = probeFor(circuit),
) => {
  for (let attempt = 1; ; attempt++) {
    const before = await readCounter(probe);
    startCall();
    try {
      return await call();
    } catch (e) {
      const disconnected = /Normal Closure|disconnected from wss/.test(inspect(e, { depth: 12 }));
      if (!disconnected || attempt >= 4) throw e;
      log(`${circuit}: RPC disconnected during submission (attempt ${attempt}); checking the chain before retrying...`);
      await new Promise((r) => setTimeout(r, 30_000));
      if ((await readCounter(probe)) !== before) {
        throw new Error(`${circuit} changed the ledger despite the disconnect; not retrying`, { cause: e });
      }
    }
  }
};

/** The opening the lender of record will need, encrypted so only it can read it. */
const sealFor = (lenderSecret: Uint8Array, att: { attestation: Attestation }, noteSalt: Uint8Array) =>
  sealOpening(lenderEncryptionKey(lenderSecret), {
    tag: att.attestation.tag,
    invoiceCommit: att.attestation.invoiceCommit,
    amount: att.attestation.amount,
    salt: noteSalt,
  });

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
const suffix = randomBytes(5).toString('hex').toUpperCase();
const invoice1 = syntheticKsefNumber('5265877635', '2026-09-10', `01${suffix}`);
const invoice2 = syntheticKsefNumber('5265877635', '2026-09-11', `02${suffix}`);
const invoice3 = syntheticKsefNumber('5265877635', '2026-09-12', `03${suffix}`);
const invoice4 = syntheticKsefNumber('5265877635', '2026-09-13', `04${suffix}`);

// 1. The 2-of-3 registrar committee admits both lenders. All three seats are the deployer's here;
//    the contract only ever sees key commitments, and nothing about the mechanism depends on that.
const seats = await Promise.all(
  (['registrar', 'registrar2', 'registrar3'] as const).map((seat) => join(seat, { secretKey: parties[seat] })),
);
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
    if (record.events.some((e) => e.label === stepLabel && e.txHash)) {
      log(`${stepLabel}: already recorded, skipping`);
      continue;
    }
    const tx = await submit('approveAdmit', () => seat.callTx.approveAdmit(lender, encryptionKey), approvalProbe);
    note(stepLabel, 'approveAdmit', 'accepted', tx.public);

    // After the first approval only, show that one registrar cannot admit on its own. The assert
    // fires while the proof is being built, so this costs no transaction and no DUST.
    if (i === 0 && showThresholdRefusal) {
      try {
        await seats[0].callTx.executeAdmit(lender, encryptionKey);
        note(`One registrar admits ${label}`, 'executeAdmit', 'UNEXPECTEDLY ACCEPTED');
        throw new Error('A single registrar admitted a lender; aborting demo');
      } catch (e) {
        const message = (e as Error).message;
        if (!/Below the registrar threshold/.test(message)) throw e;
        const reason = /failed assert: ([^\n]*)/.exec(message)?.[1] ?? message.split('\n')[0];
        note(`One registrar alone admits ${label}`, 'executeAdmit', `rejected before proving: ${reason}`);
      }
    }
  }

  const stepLabel = `Committee admits ${label}`;
  if (record.events.some((e) => e.label === stepLabel && e.txHash)) {
    log(`${stepLabel}: already recorded, skipping`);
    return;
  }
  log(`${label}: ${await approvalsFor(lender, encryptionKey)} of 2 approvals gathered`);
  const tx = await submit('executeAdmit', () => seats[2].callTx.executeAdmit(lender, encryptionKey));
  note(stepLabel, 'executeAdmit', 'accepted', tx.public);
};

await admit('lender A', parties.lenderA, true);
await admit('lender B', parties.lenderB);

// 2. Borrower pledges invoice 1 to lender A.
const att1 = attestFor(invoice1, '12500000');
const noteSalt1 = newSalt();
const borrowerA = await join('borrower', {
  secretKey: parties.borrower,
  attestation: att1.attestation,
  pledgeLender: lenderKey(parties.lenderA),
  noteSalt: noteSalt1,
});
const pledged = await submit('pledge', () =>
  borrowerA.callTx.pledge(lenderKey(parties.lenderA), sealFor(parties.lenderA, att1, noteSalt1)),
);
note('Borrower pledges invoice 1 to lender A', 'pledge', 'accepted', pledged.public);

// 3. Same invoice, fresh attestation, different lender: must be rejected.
const again = attestFor(invoice1, '12500000');
await providers.privateStateProvider.set('borrower', {
  secretKey: parties.borrower,
  attestation: again.attestation,
  pledgeLender: lenderKey(parties.lenderB),
  noteSalt: newSalt(),
});
try {
  await borrowerA.callTx.pledge(lenderKey(parties.lenderB), new Uint8Array());
  note('Borrower re-pledges invoice 1 to lender B', 'pledge', 'UNEXPECTEDLY ACCEPTED');
  throw new Error('Double pledge was accepted; aborting demo');
} catch (e) {
  const message = (e as Error).message;
  if (!/already pledged/.test(message)) throw e;
  const reason = /failed assert: ([^\n]*)/.exec(message)?.[1] ?? message.split('\n')[0];
  note('Borrower re-pledges invoice 1 to lender B', 'pledge', `rejected before proving: ${reason}`);
}

// 4. Lender A takes the pledge. Until this runs it is a one-sided claim by the borrower.
const lenderA = await join('lenderA', {
  secretKey: parties.lenderA,
  releaseNote: {
    tag: att1.attestation.tag,
    invoiceCommit: att1.attestation.invoiceCommit,
    amount: att1.attestation.amount,
    salt: noteSalt1,
  },
});
const accepted = await submit('acceptPledge', () => lenderA.callTx.acceptPledge());
note('Lender A accepts invoice 1', 'acceptPledge', 'accepted', accepted.public);

// 5. A different invoice to lender B goes through.
const att2 = attestFor(invoice2, '8300000');
const noteSalt2 = newSalt();
await providers.privateStateProvider.set('borrower', {
  secretKey: parties.borrower,
  attestation: att2.attestation,
  pledgeLender: lenderKey(parties.lenderB),
  noteSalt: noteSalt2,
});
const pledged2 = await submit('pledge', () =>
  borrowerA.callTx.pledge(lenderKey(parties.lenderB), sealFor(parties.lenderB, att2, noteSalt2)),
);
note('Borrower pledges invoice 2 to lender B', 'pledge', 'accepted', pledged2.public);

// 6. Lender B refuses it, which frees the receivable. Before Wave 2 a pledge no lender agreed to
//    burned the invoice forever (security review F10).
const lenderB = await join('lenderB', {
  secretKey: parties.lenderB,
  releaseNote: {
    tag: att2.attestation.tag,
    invoiceCommit: att2.attestation.invoiceCommit,
    amount: att2.attestation.amount,
    salt: noteSalt2,
  },
});
const declined = await submit('declinePledge', () => lenderB.callTx.declinePledge());
note('Lender B declines invoice 2, freeing the receivable', 'declinePledge', 'accepted', declined.public);

// 7. The freed invoice is financed elsewhere: the proof that declining really releases the tag.
const att2again = attestFor(invoice2, '8300000');
const noteSalt3 = newSalt();
await providers.privateStateProvider.set('borrower', {
  secretKey: parties.borrower,
  attestation: att2again.attestation,
  pledgeLender: lenderKey(parties.lenderA),
  noteSalt: noteSalt3,
});
const repledged = await submit('pledge', () =>
  borrowerA.callTx.pledge(lenderKey(parties.lenderA), sealFor(parties.lenderA, att2again, noteSalt3)),
);
note('Borrower pledges the freed invoice 2 to lender A', 'pledge', 'accepted', repledged.public);

// 8. Two more invoices to lender A, so its book is four receivables deep: the pool size the
//    borrowing-base circuit is compiled for.
const extra = [
  { label: 'invoice 3', number: invoice3, amount: '4100000' },
  { label: 'invoice 4', number: invoice4, amount: '6700000' },
].map((i) => ({ ...i, att: attestFor(i.number, i.amount), noteSalt: newSalt() }));

for (const item of extra) {
  await providers.privateStateProvider.set('borrower', {
    secretKey: parties.borrower,
    attestation: item.att.attestation,
    pledgeLender: lenderKey(parties.lenderA),
    noteSalt: item.noteSalt,
  });
  const tx = await submit('pledge', () =>
    borrowerA.callTx.pledge(lenderKey(parties.lenderA), sealFor(parties.lenderA, item.att, item.noteSalt)),
  );
  note(`Borrower pledges ${item.label} to lender A`, 'pledge', 'accepted', tx.public);
}

// 9. Lender A proves to its own funder that the book behind a drawdown clears a floor. The four
//    openings are the ones the borrower sealed to it; the amounts, and which receivables are in the
//    pool, stay private. Only the floor and an unlinkable draw id reach the chain.
const pool = [
  { tag: att1.attestation.tag, invoiceCommit: att1.attestation.invoiceCommit, amount: att1.attestation.amount, salt: noteSalt1 },
  { tag: att2again.attestation.tag, invoiceCommit: att2again.attestation.invoiceCommit, amount: att2again.attestation.amount, salt: noteSalt3 },
  ...extra.map((i) => ({
    tag: i.att.attestation.tag,
    invoiceCommit: i.att.attestation.invoiceCommit,
    amount: i.att.attestation.amount,
    salt: i.noteSalt,
  })),
];
const poolTotal = pool.reduce((sum, n) => sum + n.amount, 0n);
const round = new Uint8Array(Buffer.from(`onepledge:demo:${suffix}`.padEnd(32, '.').slice(0, 32), 'ascii'));
const floor = (poolTotal / 1_000_000n) * 1_000_000n; // a round figure at or below the true total
log(`Lender A's book is ${pool.length} receivables; it will prove at least ${floor} grosz without naming an amount`);

// Keep the release opening alongside the pool: the same lender still has invoice 1 to release.
await providers.privateStateProvider.set('lenderA', {
  secretKey: parties.lenderA,
  releaseNote: pool[0],
  pool,
});
const drawn = await submit('proveBorrowingBase', () => lenderA.callTx.proveBorrowingBase(round, floor));
note(`Lender A proves a borrowing base of at least ${floor} grosz`, 'proveBorrowingBase', 'accepted', drawn.public);

// A floor the book does not reach is refused while the proof is being built: no transaction, and
// nothing on chain to say it was tried.
try {
  await lenderA.callTx.proveBorrowingBase(round, poolTotal + 1n);
  note('Lender A overstates its borrowing base', 'proveBorrowingBase', 'UNEXPECTEDLY ACCEPTED');
  throw new Error('An overstated borrowing base was accepted; aborting demo');
} catch (e) {
  const message = (e as Error).message;
  if (!/Pool does not clear the floor/.test(message)) throw e;
  const reason = /failed assert: ([^\n]*)/.exec(message)?.[1] ?? message.split('\n')[0];
  note('Lender A overstates its borrowing base', 'proveBorrowingBase', `rejected before proving: ${reason}`);
}

// 10. Lender A releases invoice 1 (paid). Done after the draw: a paid receivable should not be in
//     the book behind a drawdown.
const released = await submit('release', () => lenderA.callTx.release());
note('Lender A releases invoice 1', 'release', 'accepted', released.public);

// 11. The committee rotates itself. The seats are deliberately the same three keys: what this shows
//     is the mechanism — two approvals move the registry to a new epoch, and the previous epoch's
//     membership stops working — not a change of custody, which the demo cannot honestly claim.
const rotateLabel = 'Committee rotates itself to a new epoch';
if (record.events.some((e) => e.label === rotateLabel && e.txHash)) {
  log(`${rotateLabel}: already recorded, skipping`);
} else {
  const rotateApprovals = (l: Ledger) => {
    const action = Registry.pureCircuits.rotateAction(l.committeeEpoch, committeeKeys[0], committeeKeys[1], committeeKeys[2]);
    return l.proposals.member(action) ? l.proposals.lookup(action).size() : 0n;
  };
  for (const [i, seat] of [seats[0], seats[1]].entries()) {
    const stepLabel = `Registrar ${i + 1} approves the rotation`;
    if (record.events.some((e) => e.label === stepLabel && e.txHash)) {
      log(`${stepLabel}: already recorded, skipping`);
      continue;
    }
    const tx = await submit('approveRotate', () => seat.callTx.approveRotate(committeeKeys), rotateApprovals);
    note(stepLabel, 'approveRotate', 'accepted', tx.public);
  }
  const rotated = await submit('executeRotate', () => seats[2].callTx.executeRotate(committeeKeys));
  note(rotateLabel, 'executeRotate', 'accepted', rotated.public);
  log(`Rotation complete; the registry is now on committee epoch ${await readCounter((l) => l.committeeEpoch)}.`);
}

// No snapshot here: this run submitted transactions (see saveSnapshot).
await ctx.wallet.stop();
log('Demo complete.');
process.exit(0);
