// SPDX-License-Identifier: Apache-2.0
// Headless wallet for the OnePledge CLI. Adapted from midnightntwrk/example-zkloan
// (Apache-2.0), with state snapshots so a restart resumes sync instead of replaying
// the whole chain.

import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import * as bip39 from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  HDWallet,
  Roles,
  WalletFacade,
  ShieldedWallet,
  DustWallet,
  UnshieldedWallet,
  createKeystore,
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  PublicKey as UnshieldedPublicKey,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk';
import { PendingTransactions } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { type NetworkConfig, secretsDir } from './config.js';

// @ts-expect-error: the indexer client uses the global WebSocket
globalThis.WebSocket = WebSocket;

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

const mnemonicPath = (network: NetworkConfig) => path.join(secretsDir, `${network.name}.mnemonic`);
const snapshotPath = (network: NetworkConfig) => path.join(secretsDir, `${network.name}-wallet-state.json`);

const writePrivate = (file: string, contents: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, { mode: 0o600 });
  fs.renameSync(tmp, file);
};

/** Load the network's mnemonic, generating and storing a new 24-word one on first use. */
export const loadOrCreateMnemonic = (network: NetworkConfig): { mnemonic: string; created: boolean } => {
  const file = mnemonicPath(network);
  if (fs.existsSync(file)) {
    const mnemonic = fs.readFileSync(file, 'utf8').trim();
    if (!bip39.validateMnemonic(mnemonic, english)) throw new Error(`Invalid mnemonic in ${file}`);
    return { mnemonic, created: false };
  }
  const mnemonic = bip39.generateMnemonic(english, 256);
  writePrivate(file, `${mnemonic}\n`);
  return { mnemonic, created: true };
};

interface DerivedKeys {
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

// The local devnet mints all NIGHT to this well-known genesis seed. Never used on public networks.
const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/** Seed for the network's CLI wallet: genesis on the local devnet, the stored mnemonic elsewhere. */
export const walletSeed = async (network: NetworkConfig): Promise<Buffer> => {
  if (network.name === 'undeployed') return Buffer.from(GENESIS_SEED, 'hex');
  const { mnemonic } = loadOrCreateMnemonic(network);
  return Buffer.from(await bip39.mnemonicToSeed(mnemonic));
};

export const deriveKeys = async (seed: Buffer, network: NetworkConfig): Promise<DerivedKeys> => {
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') throw new Error('Failed to initialise HD wallet');
  const derived = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('Failed to derive wallet keys');
  hd.hdWallet.clear();
  return {
    shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]),
    dustSecretKey: ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]),
    unshieldedKeystore: createKeystore(derived.keys[Roles.NightExternal], network.networkId as never),
  };
};

/** Each sub-wallet restores independently; a missing part starts fresh and syncs from the chain. */
type Snapshot = Partial<{ shielded: string; unshielded: string; dust: string }>;

const readSnapshot = (network: NetworkConfig): Snapshot | undefined => {
  const file = snapshotPath(network);
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;
  } catch (e) {
    console.warn(`Ignoring unreadable wallet snapshot ${file}: ${(e as Error).message}`);
    return undefined;
  }
};

/**
 * Save the wallet state, but only when it is safe to resume from: no transactions of our own
 * pending. Sync progress is safe to save; a snapshot taken right after submitting a transaction
 * holds optimistic local state that the indexer later replays, which corrupts the next restore.
 * Commands that submit transactions (deploy, demo) therefore never snapshot. The previous
 * snapshot is kept as `.bak`.
 */
export const saveSnapshot = async (ctx: WalletContext, network: NetworkConfig): Promise<boolean> => {
  const state = await Rx.firstValueFrom(ctx.wallet.state());
  if (PendingTransactions.all(state.pending).length > 0) return false;
  const [shielded, unshielded, dust] = await Promise.all([
    ctx.wallet.shielded.serializeState(),
    ctx.wallet.unshielded.serializeState(),
    ctx.wallet.dust.serializeState(),
  ]);
  const file = snapshotPath(network);
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  writePrivate(file, JSON.stringify({ shielded, unshielded, dust }));
  return true;
};

export const startWallet = async (
  seed: Buffer,
  network: NetworkConfig,
  opts: { restore?: boolean } = { restore: true },
): Promise<WalletContext> => {
  const keys = await deriveKeys(seed, network);
  const relayURL = new URL(network.node.replace(/^http/, 'ws'));
  const indexerClientConnection = { indexerHttpUrl: network.indexer, indexerWsUrl: network.indexerWS };
  const history = () => new InMemoryTransactionHistoryStorage(WalletEntrySchema);

  const shieldedConfig = {
    networkId: network.networkId,
    indexerClientConnection,
    provingServerUrl: new URL(network.proofServer),
    relayURL,
    txHistoryStorage: history(),
  };
  const unshieldedConfig = { networkId: network.networkId, indexerClientConnection, txHistoryStorage: history() };
  const dustConfig = {
    networkId: network.networkId,
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
    indexerClientConnection,
    provingServerUrl: new URL(network.proofServer),
    relayURL,
    txHistoryStorage: history(),
  };

  const snapshot = opts.restore ? readSnapshot(network) : undefined;
  const dustParams = ledger.LedgerParameters.initialParameters().dust;

  const wallet = await WalletFacade.init({
    configuration: { ...shieldedConfig, ...unshieldedConfig, ...dustConfig },
    shielded: () =>
      snapshot?.shielded
        ? ShieldedWallet(shieldedConfig).restore(snapshot.shielded)
        : ShieldedWallet(shieldedConfig).startWithSecretKeys(keys.shieldedSecretKeys),
    unshielded: () =>
      snapshot?.unshielded
        ? UnshieldedWallet(unshieldedConfig).restore(snapshot.unshielded)
        : UnshieldedWallet(unshieldedConfig).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(keys.unshieldedKeystore)),
    dust: () =>
      snapshot?.dust
        ? DustWallet(dustConfig).restore(snapshot.dust)
        : DustWallet(dustConfig).startWithSecretKey(keys.dustSecretKey, dustParams),
  });
  await wallet.start(keys.shieldedSecretKeys, keys.dustSecretKey);
  return { wallet, ...keys };
};

export const unshieldedAddress = (ctx: Pick<WalletContext, 'unshieldedKeystore'>) =>
  ctx.unshieldedKeystore.getBech32Address().asString();

export const balances = (state: Awaited<ReturnType<WalletFacade['waitForSyncedState']>>) => ({
  night: state.unshielded?.balances[ledger.nativeToken().raw] ?? 0n,
  dust: state.dust?.balance(new Date()) ?? 0n,
});

export const syncSummary = (state: Awaited<ReturnType<WalletFacade['waitForSyncedState']>>) => {
  type Indexed = { appliedIndex: bigint; highestRelevantIndex: bigint; isConnected: boolean; isStrictlyComplete(): boolean };
  const p = ({ progress: s }: { progress: Indexed }) =>
    `${s.appliedIndex}/${s.highestRelevantIndex}${s.isStrictlyComplete() ? ' done' : ''}${s.isConnected ? '' : ' (disconnected)'}`;
  const u = state.unshielded.progress;
  return (
    `shielded ${p(state.shielded)} | dust ${p(state.dust)} | ` +
    `unshielded ${u.appliedId}/${u.highestTransactionId}${u.isStrictlyComplete() ? ' done' : ''} | synced=${state.isSynced}`
  );
};

/** Register any unregistered NIGHT UTXOs so the wallet generates DUST for fees. */
export const registerNightForDust = async (ctx: WalletContext): Promise<string | undefined> => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const unregistered = state.unshielded?.availableCoins.filter((c) => c.meta.registeredForDustGeneration === false) ?? [];
  if (unregistered.length === 0) return undefined;
  const recipe = await ctx.wallet.registerNightUtxosForDustGeneration(
    unregistered,
    ctx.unshieldedKeystore.getPublicKey(),
    (payload) => ctx.unshieldedKeystore.signData(payload),
  );
  const tx = await ctx.wallet.finalizeRecipe(recipe);
  return ctx.wallet.submitTransaction(tx);
};
