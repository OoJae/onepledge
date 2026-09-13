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

export const preprod: NetworkConfig = {
  name: 'preprod',
  indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: 'wss://rpc.preprod.midnight.network',
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
