// SPDX-License-Identifier: Apache-2.0
// Network endpoints. Values mirror midnightntwrk/example-zkloan (toolchain 0.31.1, ledger 8).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

// fileURLToPath decodes %20 etc.; URL.pathname would not (the repo path contains a space).
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const secretsDir = path.join(repoRoot, '.secrets');

export interface NetworkConfig {
  readonly name: 'preprod' | 'undeployed';
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
  readonly networkId: string;
}

// indexer.preprod.midnight.network was decommissioned on 2026-10-09 (HTTP 410) and Blockfrost now
// serves the Preprod indexer and node RPC. Every request carries a Midnight Preprod project token as a
// query parameter: the wallet SDK's indexer client and the Polkadot WsProvider take plain URLs, and a
// browser WebSocket cannot set headers.
const withBlockfrostKey = (url: string): string => {
  const token = process.env.BLOCKFROST_PROJECT_ID?.trim();
  if (!token) {
    throw new Error(
      'BLOCKFROST_PROJECT_ID is not set. Create a Midnight Preprod project at https://blockfrost.io ' +
        'and export its project id, or run against the local devnet with ONEPLEDGE_NETWORK=undeployed.',
    );
  }
  return `${url}?project_id=${encodeURIComponent(token)}`;
};

export const preprod: NetworkConfig = {
  name: 'preprod',
  // ONEPLEDGE_INDEXER / ONEPLEDGE_INDEXER_WS point the CLI at your own indexer instead of Blockfrost.
  get indexer() {
    return process.env.ONEPLEDGE_INDEXER ?? withBlockfrostKey('https://midnight-preprod.blockfrost.io/api/v0');
  },
  get indexerWS() {
    return process.env.ONEPLEDGE_INDEXER_WS ?? withBlockfrostKey('wss://midnight-preprod.blockfrost.io/api/v0/ws');
  },
  get node() {
    return process.env.ONEPLEDGE_NODE ?? withBlockfrostKey('wss://rpc.midnight-preprod.blockfrost.io');
  },
  proofServer: process.env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300',
  networkId: 'preprod',
};

export const standalone: NetworkConfig = {
  name: 'undeployed',
  indexer: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  node: 'http://127.0.0.1:9944',
  proofServer: process.env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300',
  networkId: 'undeployed',
};

export const selectNetwork = (name = process.env.ONEPLEDGE_NETWORK ?? 'preprod'): NetworkConfig => {
  const config = name === 'undeployed' ? standalone : preprod;
  setNetworkId(config.networkId);
  return config;
};
