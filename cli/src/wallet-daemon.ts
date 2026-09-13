// SPDX-License-Identifier: Apache-2.0
// Long-running sync process: keeps the CLI wallet synced, snapshots its state every minute,
// registers NIGHT for DUST once funds arrive, and logs progress. Other CLI commands restore
// from the snapshot, so they only replay the blocks produced since the last save.

import { selectNetwork } from './config.js';
import {
  balances,
  registerNightForDust,
  saveSnapshot,
  startWallet,
  syncSummary,
  unshieldedAddress,
  walletSeed,
} from './wallet.js';

const network = selectNetwork();
const ctx = await startWallet(await walletSeed(network), network);
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

log(`Wallet daemon started on ${network.name}. Address: ${unshieldedAddress(ctx)}`);

let latest: Awaited<ReturnType<typeof ctx.wallet.waitForSyncedState>> | undefined;
let registering = false;

ctx.wallet.state().subscribe((state) => {
  latest = state;
});

const tick = async () => {
  if (!latest) return;
  const { night, dust } = balances(latest);
  log(`${syncSummary(latest)} | NIGHT=${night} DUST=${dust}`);
  try {
    await saveSnapshot(ctx, network);
  } catch (e) {
    log(`Snapshot failed: ${(e as Error).message}`);
  }
  if (latest.isSynced && night > 0n && !registering) {
    registering = true;
    try {
      const txId = await registerNightForDust(ctx);
      if (txId) log(`Registered NIGHT for DUST generation, tx ${txId}`);
    } catch (e) {
      log(`DUST registration failed (will retry): ${(e as Error).message}`);
      registering = false;
    }
  }
};

const timer = setInterval(() => void tick(), 60_000);
setTimeout(() => void tick(), 15_000);

const shutdown = async () => {
  clearInterval(timer);
  log('Stopping: saving snapshot...');
  await saveSnapshot(ctx, network).catch(() => undefined);
  await ctx.wallet.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
