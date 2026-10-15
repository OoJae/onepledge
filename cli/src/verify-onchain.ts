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

const CIRCUITS = [
  'approveAdmit',
  'executeAdmit',
  'approveRotate',
  'executeRotate',
  'pledge',
  'release',
  'acceptPledge',
  'declinePledge',
  'proveBorrowingBase',
];
for (const circuit of CIRCUITS) {
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

// The registrar committee: assert the recorded members are the ones the on-chain tree holds, rather
// than printing it and hoping someone reads the number. A leaf is committeeLeaf(epoch, key), so this
// also pins the epoch: after a rotation the recorded committee must be updated or this fails.
if (record.registrarCommittee) {
  const { threshold, members } = record.registrarCommittee;
  check('registrar threshold matches deployment record', ledger.threshold === BigInt(threshold), `chain ${ledger.threshold}`);
  for (const [i, hex] of members.entries()) {
    const key = new Uint8Array(Buffer.from(hex, 'hex'));
    const leaf = Registry.pureCircuits.committeeLeaf(ledger.committeeEpoch, key);
    check(
      `registrar committee seat ${i + 1} is in the on-chain tree`,
      ledger.registrars.findPathForLeaf(leaf) !== undefined,
      `${hex.slice(0, 12)} at epoch ${ledger.committeeEpoch}`,
    );
  }
} else {
  console.log('info  no registrar committee recorded in the deployment file; skipping that check');
}

const recordedPledges = record.events.filter((e) => e.circuit === 'pledge' && e.txHash).length;
const recordedReleases = record.events.filter((e) => e.circuit === 'release' && e.txHash).length;
check('pledge count covers recorded pledges', ledger.pledgeCount >= BigInt(recordedPledges), `chain ${ledger.pledgeCount}, recorded ${recordedPledges}`);
check('release count covers recorded releases', ledger.releaseCount >= BigInt(recordedReleases), `chain ${ledger.releaseCount}, recorded ${recordedReleases}`);

const recordedDraws = record.events.filter((e) => e.circuit === 'proveBorrowingBase' && e.txHash).length;
check('draw count covers recorded borrowing-base proofs', ledger.drawCount >= BigInt(recordedDraws), `chain ${ledger.drawCount}, recorded ${recordedDraws}`);

const authority = state.maintenanceAuthority;
const recordedUpgrade = record.maintenanceAuthority;
if (recordedUpgrade) {
  check(
    'upgrade authority matches deployment record',
    authority.committee.length === recordedUpgrade.committeeSize && Number(authority.threshold) === Number(recordedUpgrade.threshold),
    `chain ${authority.committee.length}-of-${authority.threshold}, recorded ${recordedUpgrade.committeeSize}-of-${recordedUpgrade.threshold}`,
  );
} else {
  console.log(`info  upgrade authority: ${authority.committee.length}-member committee, threshold ${authority.threshold}`);
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log(`\nThe registry at ${record.contractAddress} on ${network.name} matches this repository, according to the indexer at ${network.indexer}.`);
process.exit(0);
