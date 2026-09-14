// SPDX-License-Identifier: Apache-2.0
// Read-only check that the deployed registry is exactly this repository's contract:
//   - every circuit's on-chain verifier key equals the committed contract/src/managed/registry/keys/*.verifier
//   - the sealed tag authority and acceptance window equal deployments/<network>.json
//   - the upgrade (maintenance) authority is reported as it is on chain
// No wallet, no transactions: it only queries the public indexer.

import fs from 'node:fs';
import path from 'node:path';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { Registry } from '@onepledge/contract';
import { selectNetwork } from './config.js';
import { readDeployment, zkConfigPath } from './providers.js';

const network = selectNetwork();
const record = readDeployment(network);
const provider = indexerPublicDataProvider(network.indexer, network.indexerWS);
const state = await provider.queryContractState(record.contractAddress);
if (!state) {
  console.error(`No contract state on ${network.name} for ${record.contractAddress}`);
  process.exit(1);
}

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

for (const circuit of ['admitLender', 'rotateRegistrar', 'pledge', 'release']) {
  const committed = fs.readFileSync(path.join(zkConfigPath, 'keys', `${circuit}.verifier`));
  const onChain = state.operation(circuit)?.verifierKey;
  check(`verifier key: ${circuit}`, !!onChain && Buffer.from(onChain).equals(committed), `${committed.length} bytes`);
}

const ledger = Registry.ledger(state.data);
check(
  'tag authority matches deployment record',
  ledger.tagAuthority.x.toString() === record.tagAuthority.x && ledger.tagAuthority.y.toString() === record.tagAuthority.y,
);
check('acceptance window matches deployment record', Number(ledger.windowStart) === record.windowStart && Number(ledger.windowEnd) === record.windowEnd);

const recordedPledges = record.events.filter((e) => e.circuit === 'pledge' && e.txHash).length;
const recordedReleases = record.events.filter((e) => e.circuit === 'release' && e.txHash).length;
check('pledge count covers recorded pledges', ledger.pledgeCount >= BigInt(recordedPledges), `chain ${ledger.pledgeCount}, recorded ${recordedPledges}`);
check('release count covers recorded releases', ledger.releaseCount >= BigInt(recordedReleases), `chain ${ledger.releaseCount}, recorded ${recordedReleases}`);

const authority = state.maintenanceAuthority;
console.log(`info  upgrade authority: ${authority.committee.length}-member committee, threshold ${authority.threshold}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log(`\nThe registry at ${record.contractAddress} on ${network.name} matches this repository.`);
process.exit(0);
