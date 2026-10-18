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
import { balances, registerNightForDust, startWallet, syncSummary, walletSeed, withDustRetry } from './wallet.js';

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

// The DUST balance logged above is not a promise that a transaction can be balanced: on a chain that
// has just started it reads full while the ledger still refuses the fee, which is what broke the
// nightly devnet job. withDustRetry carries the measurements.
const deployed = await withDustRetry(
  () =>
    deployContract(providers, {
      compiledContract: registryContract,
      privateStateId: 'registrar',
      initialPrivateState: { secretKey: parties.registrar },
      args: [authority.pk, BigInt(WINDOW_START), BigInt(WINDOW_END), committee],
    } as never),
  log,
);

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
