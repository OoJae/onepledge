// SPDX-License-Identifier: Apache-2.0
// Rewrites the deployment table in README.md from deployments/<network>.json, so the published
// record and the live chain can never drift apart by hand. Run after `npm run demo`.
//
//   node --import tsx src/render-deployment.ts
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './config.js';

const EXPLORER = 'https://preprod.midnightexplorer.com';
const START = '<!-- deployment:start -->';
const END = '<!-- deployment:end -->';

type Event = {
  label: string;
  circuit: string;
  txHash?: string;
  blockHeight?: number;
  outcome: string;
  proveSeconds?: number;
  totalSeconds?: number;
};

const record = JSON.parse(fs.readFileSync(path.join(repoRoot, 'deployments', 'preprod.json'), 'utf8')) as {
  version: string;
  contractAddress: string;
  deployTxHash: string;
  deployBlockHeight: number;
  deployedAt: string;
  maintenanceAuthority: { committeeSize: number; threshold: number };
  events: Event[];
};

const short = (hash: string) => `${hash.slice(0, 12)}…`;
const txLink = (hash: string) => `[\`${short(hash)}\`](${EXPLORER}/transactions/${hash})`;
const secs = (n?: number) => (n === undefined ? '' : `${n} s`);

const row = (e: Event) =>
  e.txHash
    ? `| ${e.label} | \`${e.circuit}\` | ${txLink(e.txHash)} | ${e.blockHeight} | ${secs(e.proveSeconds)} | ${secs(e.totalSeconds)} |`
    : `| ${e.label} | \`${e.circuit}\` | none: ${e.outcome} | | | |`;

// An event recorded with circuit "note" is not a scenario step: it is something true about the
// deployment that a table row would misrepresent. It prints as prose under the table instead, so the
// record stays the single source and nothing has to be maintained by hand in the README.
const isNote = (e: Event) => e.circuit === 'note';
const noteLine = (e: Event) =>
  `**${e.label}.** ${e.outcome}${e.txHash ? ` (transaction [\`${short(e.txHash)}\`](${EXPLORER}/transactions/${e.txHash})${e.blockHeight ? `, block ${e.blockHeight}` : ''})` : ''}`;

const { committeeSize, threshold } = record.maintenanceAuthority;
const authority =
  committeeSize === 1 ? '1-of-1 deployer key' : `${threshold}-of-${committeeSize} committee, all keys deployer-held`;

const block = [
  START,
  `**Registry ${record.version}** · contract [\`${record.contractAddress}\`](${EXPLORER}/contracts/${record.contractAddress}) · deployed ${record.deployedAt.slice(0, 10)} in block ${record.deployBlockHeight} · upgrade key: ${authority}`,
  '',
  '| Step | Circuit | Transaction | Block | Proved in | Finalized after |',
  '|---|---|---|---|---|---|',
  `| Deploy registry ${record.version} | constructor | ${txLink(record.deployTxHash)} | ${record.deployBlockHeight} | | |`,
  ...record.events.filter((e) => !isNote(e)).map(row),
  '',
  ...record.events.filter(isNote).flatMap((e) => [noteLine(e), '']),
  "Step labels come from the operator's run log (`npm run demo`), not from the chain: on chain these are plain circuit calls that do not say which lender or invoice they concern. Proving ran on a local proof server (Docker, Apple silicon laptop); \"finalized after\" is from starting the call to the indexer reporting it.",
  END,
].join('\n');

const readmePath = path.join(repoRoot, 'README.md');
const readme = fs.readFileSync(readmePath, 'utf8');
const before = readme.indexOf(START);
const after = readme.indexOf(END);
if (before === -1 || after === -1) throw new Error('README deployment markers not found');
fs.writeFileSync(readmePath, `${readme.slice(0, before)}${block}${readme.slice(after + END.length)}`);
const steps = record.events.filter((e) => !isNote(e)).length;
const notes = record.events.length - steps;
console.log(`README deployment table rewritten: ${record.version}, ${steps} steps${notes ? ` and ${notes} note(s)` : ''}`);
