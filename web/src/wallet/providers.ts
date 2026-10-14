// SPDX-License-Identifier: Apache-2.0
// Builds the midnight-js provider set from a connected wallet.
//
// Three of the six slots differ from the CLI (cli/src/providers.ts): the wallet and midnight providers
// come from the connector instead of a headless WalletFacade, and key material is fetched over HTTP
// instead of read from disk. The public data and proof providers are the same calls.
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { dappConnectorProofProvider } from '@midnight-ntwrk/midnight-js-dapp-connector-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  Binding,
  CostModel,
  Proof,
  SignatureEnabled,
  Transaction,
  type ContractAddress,
  type FinalizedTransaction,
  type SigningKey,
  type TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import type {
  MidnightProvider,
  MidnightProviders,
  PrivateStateProvider,
  UnboundTransaction,
  WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { makeRegistryContract, type OnePledgePrivateState, type RegistryCircuits } from '@onepledge/contract';
import type { Connection } from './connector.ts';

export type PartyId = 'borrower' | 'lender';
export type DeskProviders = MidnightProviders<RegistryCircuits, PartyId, OnePledgePrivateState>;

export const DEFAULT_PROOF_SERVER = 'http://localhost:6300';

/** Same-origin proxy onto the Blockfrost Preprod indexer; see web/api/indexer.js. */
const indexerUrls = () => {
  const origin = window.location.origin;
  return { http: `${origin}/api/indexer`, ws: `${origin.replace(/^http/, 'ws')}/api/indexer` };
};

/**
 * Private state lives for the life of the tab. Deliberate: these are borrower and lender secrets, and
 * persisting them in IndexedDB on a shared machine is a worse default than asking for them again.
 */
const unsupported =
  (name: string) =>
  (): never => {
    throw new Error(`${name} is not available: this desk keeps private state in memory only.`);
  };

export const inMemoryPrivateStateProvider = (): PrivateStateProvider<PartyId, OnePledgePrivateState> => {
  const states = new Map<PartyId, OnePledgePrivateState>();
  const keys = new Map<ContractAddress, SigningKey>();
  return {
    setContractAddress: () => {},
    set: async (id, state) => void states.set(id, state),
    get: async (id) => states.get(id) ?? null,
    remove: async (id) => void states.delete(id),
    clear: async () => states.clear(),
    setSigningKey: async (address, key) => void keys.set(address, key),
    getSigningKey: async (address) => keys.get(address) ?? null,
    removeSigningKey: async (address) => void keys.delete(address),
    clearSigningKeys: async () => keys.clear(),
    // Backup and restore are for providers that persist. Nothing here outlives the tab.
    exportPrivateStates: unsupported('exportPrivateStates'),
    importPrivateStates: unsupported('importPrivateStates'),
    exportSigningKeys: unsupported('exportSigningKeys'),
    importSigningKeys: unsupported('importSigningKeys'),
  };
};

/** The contract handle; FetchZkConfigProvider resolves keys/ and zkir/ against the app origin. */
export const deskContract = () => makeRegistryContract(window.location.origin);

export type ProvingMode = 'wallet' | 'proof-server';

/**
 * Lace does not implement getProvingProvider, so it needs a proof server the user runs themselves.
 * 1AM proves in the browser. Feature-detect rather than branching on which wallet is connected.
 */
export const provingMode = (api: ConnectedAPI): ProvingMode =>
  typeof (api as { getProvingProvider?: unknown }).getProvingProvider === 'function' ? 'wallet' : 'proof-server';

export const proofServerReachable = async (uri: string): Promise<boolean> => {
  try {
    const res = await fetch(`${uri.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(4_000) });
    return res.ok;
  } catch {
    return false;
  }
};

export const buildProviders = async (connection: Connection): Promise<DeskProviders> => {
  const { api } = connection;
  const zkConfigProvider = new FetchZkConfigProvider<RegistryCircuits>(window.location.origin, fetch.bind(window));
  const shielded = await api.getShieldedAddresses();
  const indexer = indexerUrls();

  const proofProvider =
    provingMode(api) === 'wallet'
      ? await dappConnectorProofProvider(api, zkConfigProvider, CostModel.initialCostModel())
      : httpClientProofProvider(
          (await api.getConfiguration()).proverServerUri ?? DEFAULT_PROOF_SERVER,
          zkConfigProvider,
        );

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => shielded.shieldedCoinPublicKey,
    getEncryptionPublicKey: () => shielded.shieldedEncryptionPublicKey,
    balanceTx: async (tx: UnboundTransaction): Promise<FinalizedTransaction> => {
      const balanced = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
      return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
        'signature',
        'proof',
        'binding',
        fromHex(balanced.tx),
      );
    },
  };

  const midnightProvider: MidnightProvider = {
    submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
      await api.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  };

  return {
    privateStateProvider: inMemoryPrivateStateProvider(),
    publicDataProvider: indexerPublicDataProvider(indexer.http, indexer.ws),
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
};
