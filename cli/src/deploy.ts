// SPDX-License-Identifier: Apache-2.0
// Deploys the OnePledge registry. The three registrar-committee seats are passed as key
// commitments; the deployer holds all three secrets in this demo.

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { dayFromIso } from '@onepledge/attester';
import { Registry } from '@onepledge/contract';
import { selectNetwork } from './config.js';
import fs from 'node:fs';
import {
  COMMITTEE_SEATS,
  archiveDeployment,
  configureProviders,
  deploymentFile,
  loadParties,
  loadTagAuthority,
  registryContract,
  writeDeployment,
} from './providers.js';
import * as Rx from 'rxjs';
import { inspect } from 'node:util';
import { balances, registerNightForDust, startWallet, syncSummary, walletSeed } from './wallet.js';

const network = selectNetwork();
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

// Registry v1 accepts invoices KSeF accepted between 2026-07-01 and 2027-01-01 (exclusive).
const WINDOW_START = dayFromIso(process.env.WINDOW_START ?? '2026-07-01');
const WINDOW_END = dayFromIso(process.env.WINDOW_END ?? '2027-01-01');

// Never silently replace the recorded deployment: judges and the Live page read it.
if (fs.existsSync(deploymentFile(network)) && process.env.FORCE !== '1') {
  log(`${deploymentFile(network)} already exists. Re-run with FORCE=1 (and DEPRECATE_REASON="...") to archive it and deploy anew.`);
  process.exit(1);
}

const ctx = await startWallet(await walletSeed(network), network);
log('Waiting for wallet sync (restored from snapshot when available)...');
const state = await ctx.wallet.waitForSyncedState();
log(syncSummary(state));
const { night, dust } = balances(state);
log(`NIGHT=${night} DUST=${dust}`);
if (dust === 0n) {
  if (night === 0n) {
    log('No NIGHT and no DUST. Fund the wallet first (npm run wallet:init prints the address).');
    await ctx.wallet.stop();
    process.exit(1);
  }
  const txId = await registerNightForDust(ctx);
  log(txId ? `Registered NIGHT for DUST generation (tx ${txId}). Waiting for DUST...` : 'Waiting for DUST to accrue...');
  await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => balances(s).dust > 0n)));
  log('DUST available.');
}

const providers = await configureProviders(ctx, network);
const parties = loadParties(network);
const authority = loadTagAuthority(network);

const committee = COMMITTEE_SEATS.map((seat) => Registry.pureCircuits.registrarKey(parties[seat]));
const committeeHex = committee.map((k) => Buffer.from(k).toString('hex'));
log(`Registrar committee (2 of 3): ${committeeHex.map((k) => k.slice(0, 12)).join(' ')}`);

log('Deploying registry (proof generated on the local proof server)...');

// A non-zero DUST balance is not the same as enough DUST to balance a transaction. The nightly
// devnet job proved it: the same commit deployed on 17 October and failed on 18 October with
// `could not balance dust`, and all three of those runs — both CI runs and a local reproduction —
// reported the identical wallet state, 128 dust outputs and DUST=1250000000000000000000000.
//
// What differed was block height, not elapsed time. The failing run balanced at best block #2; the
// two that succeeded were at blocks 4 and 5. `docker compose --wait` gates only on block #1
// existing, so how far the chain has moved by the time balancing starts depends on how quickly the
// wallet gets through startup, which is why this job failed intermittently rather than always.
//
// Retrying is safe without a ledger probe, unlike the scenario's submit(): balancing fails before a
// transaction is built, so nothing can have reached the chain on the attempt that threw.
const deployOnce = () =>
  deployContract(providers, {
    compiledContract: registryContract,
    privateStateId: 'registrar',
    initialPrivateState: { secretKey: parties.registrar },
    args: [authority.pk, BigInt(WINDOW_START), BigInt(WINDOW_END), committee],
  } as never);

const deployed = await (async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await deployOnce();
    } catch (e) {
      const text = inspect(e, { depth: 12 });
      if (!/InsufficientFunds|could not balance dust/.test(text) || attempt >= 8) throw e;
      const have = balances(await Rx.firstValueFrom(ctx.wallet.state())).dust;
      log(`Could not balance dust (attempt ${attempt}); DUST=${have}. Waiting for blocks...`);
      // Waiting for the reported balance to climb would wait forever. Measured on a local devnet,
      // reproducing the CI failure at best block #2: the figure above stayed at exactly
      // 1250000000000000000000000 across the whole retry and the deploy still went through once
      // blocks had passed. So the number is a registered capacity, not spendable dust, which is also
      // why the zero check above cannot catch this. Blocks are what make dust spendable, and on that
      // devnet it took until roughly block 4, about 12 seconds at a 6-second block time.
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
})();

const pub = (deployed as { deployTxData: { public: { contractAddress: string; txId: string; txHash: string; blockHeight: number } } })
  .deployTxData.public;
log(`Deployed at ${pub.contractAddress} in tx ${pub.txId} (block ${pub.blockHeight})`);

const onChain = await providers.publicDataProvider.queryContractState(pub.contractAddress);
const authorityInfo = onChain?.maintenanceAuthority;
const archived = archiveDeployment(network, process.env.DEPRECATE_REASON ?? 'superseded by a new deployment');
if (archived) log(`Archived the previous record to ${archived}`);

writeDeployment(network, {
  network: network.name,
  version: process.env.REGISTRY_VERSION ?? 'v4',
  status: 'active',
  maintenanceAuthority: authorityInfo
    ? {
        committeeSize: authorityInfo.committee.length,
        threshold: authorityInfo.threshold,
        note: 'Deployer-held upgrade key: can insert or remove verifier keys. Planned: 2-of-3 committee, then frozen.',
      }
    : undefined,
  registrarCommittee: {
    threshold: 2,
    members: committeeHex,
    note: 'All three seats are deployer-held in this demo. The 2-of-3 mechanism is genuinely enforced on chain; the key custody is not distributed.',
  },
  contractAddress: pub.contractAddress,
  deployTxId: pub.txId,
  deployTxHash: pub.txHash,
  deployBlockHeight: pub.blockHeight,
  deployedAt: new Date().toISOString(),
  tagAuthority: { x: authority.pk.x.toString(), y: authority.pk.y.toString() },
  windowStart: WINDOW_START,
  windowEnd: WINDOW_END,
  events: [],
});

// No snapshot here: this run submitted transactions (see saveSnapshot).
await ctx.wallet.stop();
process.exit(0);
