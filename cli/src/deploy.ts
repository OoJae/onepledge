// SPDX-License-Identifier: Apache-2.0
// Deploys the OnePledge registry. The deployer's party secret becomes the registrar.

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { dayFromIso } from '@onepledge/attester';
import { selectNetwork } from './config.js';
import { configureProviders, loadParties, loadTagAuthority, registryContract, writeDeployment } from './providers.js';
import * as Rx from 'rxjs';
import { balances, registerNightForDust, saveSnapshot, startWallet, syncSummary, walletSeed } from './wallet.js';

const network = selectNetwork();
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

// Registry v1 accepts invoices KSeF accepted between 2026-07-01 and 2027-01-01 (exclusive).
const WINDOW_START = dayFromIso(process.env.WINDOW_START ?? '2026-07-01');
const WINDOW_END = dayFromIso(process.env.WINDOW_END ?? '2027-01-01');

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

log('Deploying registry (proof generated on the local proof server)...');
const deployed = await deployContract(providers, {
  compiledContract: registryContract,
  privateStateId: 'registrar',
  initialPrivateState: { secretKey: parties.registrar },
  args: [authority.pk, BigInt(WINDOW_START), BigInt(WINDOW_END)],
} as never);

const pub = (deployed as { deployTxData: { public: { contractAddress: string; txId: string; blockHeight: number } } })
  .deployTxData.public;
log(`Deployed at ${pub.contractAddress} in tx ${pub.txId} (block ${pub.blockHeight})`);

writeDeployment(network, {
  network: network.name,
  contractAddress: pub.contractAddress,
  deployTxId: pub.txId,
  deployBlockHeight: pub.blockHeight,
  deployedAt: new Date().toISOString(),
  tagAuthority: { x: authority.pk.x.toString(), y: authority.pk.y.toString() },
  windowStart: WINDOW_START,
  windowEnd: WINDOW_END,
  events: [],
});

await saveSnapshot(ctx, network);
await ctx.wallet.stop();
process.exit(0);
