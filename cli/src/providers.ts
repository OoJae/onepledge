// SPDX-License-Identifier: Apache-2.0
// Midnight.js providers and local key material for the CLI. Adapted from
// midnightntwrk/example-zkloan (Apache-2.0).

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { MidnightProvider, MidnightProviders, UnboundTransaction, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { Registry, type OnePledgePrivateState, witnesses } from '@onepledge/contract';
import { publicKeyOf, randomScalar } from '@onepledge/attester';
import { type NetworkConfig, repoRoot, secretsDir } from './config.js';
import { type WalletContext, unshieldedAddress } from './wallet.js';

export type RegistryCircuits = 'admitLender' | 'rotateRegistrar' | 'pledge' | 'release';
export type PartyId = 'registrar' | 'borrower' | 'lenderA' | 'lenderB';
export type RegistryProviders = MidnightProviders<RegistryCircuits, PartyId, OnePledgePrivateState>;

export const zkConfigPath = path.join(repoRoot, 'contract', 'src', 'managed', 'registry');
export const deploymentsDir = path.join(repoRoot, 'deployments');

export const registryContract = CompiledContract.make<Registry.Contract<OnePledgePrivateState>>(
  'OnePledgeRegistry',
  Registry.Contract,
).pipe(CompiledContract.withWitnesses(witnesses as never), CompiledContract.withCompiledFileAssets(zkConfigPath));

const readOrCreate = <T>(file: string, create: () => T): T => {
  const full = path.join(secretsDir, file);
  if (fs.existsSync(full)) return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
  const value = create();
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(full, JSON.stringify(value, null, 2), { mode: 0o600 });
  return value;
};

const hex32 = () => randomBytes(32).toString('hex');

/** Tag authority key material (Jubjub signing key + HMAC tag secret). Held by the attester service. */
export const loadTagAuthority = (network: NetworkConfig) => {
  const raw = readOrCreate(`${network.name}-tag-authority.json`, () => ({
    signingKey: randomScalar().toString(),
    tagSecret: hex32(),
  }));
  const sk = BigInt(raw.signingKey);
  return { sk, pk: publicKeyOf(sk), tagSecret: new Uint8Array(Buffer.from(raw.tagSecret, 'hex')) };
};

/** Demo party secrets. In production each party holds its own secret on its own machine. */
export const loadParties = (network: NetworkConfig): Record<PartyId, Uint8Array> => {
  const raw = readOrCreate<Record<PartyId, string>>(`${network.name}-parties.json`, () => ({
    registrar: hex32(),
    borrower: hex32(),
    lenderA: hex32(),
    lenderB: hex32(),
  }));
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, new Uint8Array(Buffer.from(v, 'hex'))]),
  ) as Record<PartyId, Uint8Array>;
};

const storagePassword = (network: NetworkConfig) =>
  readOrCreate(`${network.name}-storage-password.json`, () => ({ password: `${hex32()}Aa1!` })).password;

const walletAndMidnightProvider = async (ctx: WalletContext): Promise<WalletProvider & MidnightProvider> => {
  await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return {
    getCoinPublicKey: () => ctx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => ctx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: UnboundTransaction, ttl?: Date): Promise<ledger.FinalizedTransaction> {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: ledger.FinalizedTransaction) => ctx.wallet.submitTransaction(tx),
  };
};

export const configureProviders = async (ctx: WalletContext, network: NetworkConfig): Promise<RegistryProviders> => {
  const walletProvider = await walletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<RegistryCircuits>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<PartyId, OnePledgePrivateState>({
      privateStateStoreName: path.join(repoRoot, '.secrets', `${network.name}-private-state`),
      privateStoragePasswordProvider: () => storagePassword(network),
      accountId: unshieldedAddress(ctx),
    }),
    publicDataProvider: indexerPublicDataProvider(network.indexer, network.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(network.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
};

export interface DeploymentRecord {
  network: string;
  contractAddress: string;
  deployTxId: string;
  deployBlockHeight: number;
  deployedAt: string;
  tagAuthority: { x: string; y: string };
  windowStart: number;
  windowEnd: number;
  events: { label: string; circuit: string; txId?: string; blockHeight?: number; outcome: string; at: string }[];
}

export const deploymentFile = (network: NetworkConfig) => path.join(deploymentsDir, `${network.name}.json`);

export const readDeployment = (network: NetworkConfig): DeploymentRecord => {
  const file = deploymentFile(network);
  if (!fs.existsSync(file)) throw new Error(`No deployment for ${network.name}. Run npm run deploy first.`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as DeploymentRecord;
};

export const writeDeployment = (network: NetworkConfig, record: DeploymentRecord) => {
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(deploymentFile(network), `${JSON.stringify(record, null, 2)}\n`);
};
