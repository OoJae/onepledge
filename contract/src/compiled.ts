// SPDX-License-Identifier: Apache-2.0
// The compiled-contract handle, shared by the CLI and the web app.
//
// This used to live in cli/src/providers.ts, where it was built from a node:path join and so could not
// be imported by the browser. The asset path is a parameter instead: the CLI passes an absolute path for
// NodeZkConfigProvider, the web app passes its origin for FetchZkConfigProvider. Key material is fetched
// through providers.zkConfigProvider either way; this value only labels where the assets came from.
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import * as Registry from './managed/registry/contract/index.js';
import { witnesses, type OnePledgePrivateState } from './witnesses.js';

export type RegistryCircuits =
  | 'admitLender'
  | 'rotateRegistrar'
  | 'pledge'
  | 'release'
  | 'acceptPledge'
  | 'declinePledge';

export const makeRegistryContract = (zkConfigPath: string) =>
  CompiledContract.make<Registry.Contract<OnePledgePrivateState>>('OnePledgeRegistry', Registry.Contract).pipe(
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );
