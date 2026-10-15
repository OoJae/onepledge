// SPDX-License-Identifier: Apache-2.0
// Installs a 2-of-3 contract maintenance authority on a real OnePledge deployment.
//
// This is the irreversible one. It replaces the deployer-held 1-of-1 upgrade key on a live registry
// with a threshold committee. Afterwards, midnight-js can no longer authorise ANY maintenance
// transaction for that contract -- `submitReplaceAuthorityTx`, `submitInsertVerifierKeyTx` and
// `submitRemoveVerifierKeyTx` all produce a single signature at index 0 -- and `cli/src/committee.ts`
// becomes the only way to change the contract's rules ever again.
//
// Its correctness is established by `rehearse-committee.ts`, which drives the same `committee.ts`
// code paths end to end on the local devnet (deploy -> install 2-of-3 -> remove and re-insert a
// verifier key with two of three keys -> prove one signature is refused).
//
// Usage (read the whole file before running it):
//
//   COMMITTEE_BACKUP=/secure/volume/onepledge-cma-keys.json \
//   CONFIRM_INSTALL=<the exact contract address> \
//   I_UNDERSTAND_THIS_IS_IRREVERSIBLE=1 \
//   ONEPLEDGE_NETWORK=preprod BLOCKFROST_PROJECT_ID=... \
//     npx -y node@22 --import tsx src/install-committee.ts
//
// Node 22 is not optional: Node 23+ ships a native WebSocket that drops Midnight RPC submissions.

import fs from 'node:fs';
import path from 'node:path';
import * as Rx from 'rxjs';
import {
  sampleSigningKey,
  type ContractAddress,
  type SignatureVerifyingKey,
  type SigningKey,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { selectNetwork } from './config.js';
import {
  committeeFromSigningKeys,
  readAuthority,
  replaceAuthorityUpdate,
  shortKey,
  signUpdate,
  submitUpdate,
  verifyUpdateSignatures,
} from './committee.js';
import { configureProviders, readDeployment } from './providers.js';
import { balances, registerNightForDust, startWallet, syncSummary, walletSeed } from './wallet.js';

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
// Annotated on the variable, not just the return position: that is what lets TypeScript narrow
// `if (!x) die(...)` into "x is defined below here".
const die: (m: string) => never = (m) => {
  console.error(`\nRefusing to proceed: ${m}\n`);
  process.exit(1);
};

const THRESHOLD = Number(process.env.COMMITTEE_THRESHOLD ?? '2');
const COMMITTEE_SIZE = Number(process.env.COMMITTEE_SIZE ?? '3');

// ---------------------------------------------------------------------------
// Confirmation 1 of 2: the network must be named explicitly. `selectNetwork`
// defaults to Preprod when ONEPLEDGE_NETWORK is unset, which is exactly the
// wrong default for an irreversible change.
// ---------------------------------------------------------------------------
const networkName = process.env.ONEPLEDGE_NETWORK?.trim();
if (!networkName) {
  die(
    'ONEPLEDGE_NETWORK is not set. Set it explicitly (undeployed or preprod). This script will not ' +
      'inherit a default network for an irreversible change.',
  );
}
// And it must be one of the two names, not merely non-empty. `selectNetwork` is
// `name === 'undeployed' ? standalone : preprod`, so a typo — `undeployd`, `local`, `dev` — selects
// the live network silently. The whole job of this gate is to stop an unintended network, so it
// cannot accept a value it does not recognise.
if (networkName !== 'preprod' && networkName !== 'undeployed') {
  die(
    `ONEPLEDGE_NETWORK is "${networkName}", which is neither "preprod" nor "undeployed". Anything ` +
      'other than "undeployed" resolves to the live network, so an unrecognised value is refused ' +
      'rather than guessed.',
  );
}
const network = selectNetwork(networkName);
const record = readDeployment(network);
const address = record.contractAddress as ContractAddress;

// ---------------------------------------------------------------------------
// The consequences, printed before anything else -- including before the
// confirmations are checked, so an operator who gets a gate wrong still reads
// what they were about to do.
// ---------------------------------------------------------------------------
const consequences = [
  `  * ${address} on ${network.name} would have a ${THRESHOLD}-of-${COMMITTEE_SIZE} maintenance authority.`,
  `  * Any ${THRESHOLD} of the ${COMMITTEE_SIZE} new signing keys could then insert or remove the`,
  '    contract\'s verifier keys, or replace the authority again. That is full upgrade power.',
  `  * If fewer than ${THRESHOLD} of the ${COMMITTEE_SIZE} keys survive, the following become PERMANENTLY`,
  '    impossible for this contract address, with no recovery path, no admin override and no',
  '    foundation backstop:',
  '      - recompiling the contract for a new Compact or ledger version (inserting new verifier keys)',
  '      - fixing a bug in any circuit',
  '      - removing a circuit found to be unsound',
  '      - handing maintenance to anyone else, including replacing lost keys',
  '    The contract keeps working exactly as deployed, forever, and the data in it stays readable --',
  '    but it can never be changed again. Recovery means deploying a fresh registry at a new address',
  '    and migrating every integration, the web app and the deployment record to it.',
  `  * The old deployer-held key stops being able to authorise anything the moment this lands.`,
  '  * midnight-js itself can no longer authorise maintenance for this contract: cli/src/committee.ts',
  '    is the only tool that can, so it has to keep working for the life of the deployment.',
];
console.log(`\nWHAT THIS DOES, AND WHAT IS LOST IF THE NEW KEYS ARE LOST\n${consequences.join('\n')}\n`);

// ---------------------------------------------------------------------------
// Confirmation 2 of 2: the operator must retype the address being modified.
// ---------------------------------------------------------------------------
if (process.env.CONFIRM_INSTALL?.trim() !== address) {
  die(
    `CONFIRM_INSTALL must equal the contract address this run would modify.\n` +
      `  expected: ${address}\n` +
      `  got:      ${process.env.CONFIRM_INSTALL?.trim() ?? '(unset)'}\n` +
      `  (from ${network.name}'s deployment record)`,
  );
}

// ---------------------------------------------------------------------------
// The Preprod gate.
// ---------------------------------------------------------------------------
if (network.name === 'preprod' && process.env.I_UNDERSTAND_THIS_IS_IRREVERSIBLE !== '1') {
  die(
    'this is Preprod, where the live registry is. Set I_UNDERSTAND_THIS_IS_IRREVERSIBLE=1 once you ' +
      'have read the list above and the backup destination is somewhere you will still have access ' +
      'to in a year.',
  );
}

// ---------------------------------------------------------------------------
// Where the new keys get backed up. Decided before any key exists, so a
// missing or unwritable destination cannot be discovered half way through.
// ---------------------------------------------------------------------------
const backupPath = process.env.COMMITTEE_BACKUP?.trim();
if (!backupPath) {
  die(
    'COMMITTEE_BACKUP is not set. Give it an absolute path on storage you control for the generated ' +
      'signing keys. Losing them is unrecoverable (see above), so this script will not generate keys ' +
      'it has nowhere to write.',
  );
}
const backupFile = path.resolve(backupPath);
if (fs.existsSync(backupFile)) {
  die(`${backupFile} already exists. Pick a new path; this script never overwrites a key backup.`);
}

if (!Number.isInteger(COMMITTEE_SIZE) || COMMITTEE_SIZE < 2) die(`COMMITTEE_SIZE must be an integer >= 2, got ${COMMITTEE_SIZE}`);
if (!Number.isInteger(THRESHOLD) || THRESHOLD < 2) {
  die(`COMMITTEE_THRESHOLD must be an integer >= 2, got ${THRESHOLD}. A threshold of 1 is the 1-of-1 we are replacing.`);
}
if (THRESHOLD > COMMITTEE_SIZE) die(`Threshold ${THRESHOLD} exceeds committee size ${COMMITTEE_SIZE}: nobody could ever sign`);

/**
 * Write the key backup, fsync it, and read it back to confirm every key survived the round trip.
 *
 * NOTE on the alternative: `privateStateProvider.exportSigningKeys()` returns a
 * `SigningKeyExport` -- `{ format: 'midnight-signing-key-export', encryptedPayload, salt }`, a
 * base64 AES-256-GCM payload plus a 32-byte key-derivation salt. It is a backup ARTEFACT, not a way
 * to enumerate the addresses or keys this store holds: without the export password it reveals
 * nothing, and all of its metadata lives inside the ciphertext. It is also no substitute for this
 * file, because the keys below are generated here and are not in the private-state store at all.
 */
const writeBackup = (keys: { index: number; signingKey: SigningKey; verifyingKey: SignatureVerifyingKey }[]) => {
  const payload = {
    warning:
      'SECRET. These signing keys are the only way to ever change this contract again. Losing them ' +
      'is unrecoverable; leaking them hands over full upgrade power.',
    network: network.name,
    contractAddress: address,
    threshold: THRESHOLD,
    committeeSize: COMMITTEE_SIZE,
    createdAt: new Date().toISOString(),
    keys,
  };
  fs.mkdirSync(path.dirname(backupFile), { recursive: true, mode: 0o700 });
  const handle = fs.openSync(backupFile, 'wx', 0o600);
  try {
    fs.writeFileSync(handle, `${JSON.stringify(payload, null, 2)}\n`);
    fs.fsyncSync(handle); // on disk, not merely in the page cache, before we submit anything
  } finally {
    fs.closeSync(handle);
  }
  const readBack = JSON.parse(fs.readFileSync(backupFile, 'utf8')) as typeof payload;
  const intact =
    readBack.keys.length === keys.length &&
    keys.every((k, i) => readBack.keys[i]?.signingKey === k.signingKey && readBack.keys[i]?.index === k.index);
  if (!intact) throw new Error(`${backupFile} did not read back identically`);
};

const providers = await (async () => {
  const ctx = await startWallet(await walletSeed(network), network);
  log('Waiting for wallet sync...');
  // Preprod closes the socket during sync often enough to matter. Nothing has been generated or
  // submitted at this point, so retrying costs nothing and failing here would only mean the operator
  // has to re-read the consequences and retype the confirmations.
  const state = await (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await ctx.wallet.waitForSyncedState();
      } catch (e) {
        if (attempt >= 6) throw e;
        log(`wallet sync failed; retrying in 20s (attempt ${attempt} of 6)...`);
        await new Promise((r) => setTimeout(r, 20_000));
      }
    }
  })();
  log(syncSummary(state));
  const { night, dust } = balances(state);
  log(`NIGHT=${night} DUST=${dust}`);
  if (dust === 0n) {
    if (night === 0n) {
      await ctx.wallet.stop();
      die('wallet has no NIGHT and no DUST; a maintenance transaction still pays fees. Fund it first.');
    }
    const txId = await registerNightForDust(ctx);
    log(txId ? `Registered NIGHT for DUST (tx ${txId}). Waiting for DUST...` : 'Waiting for DUST to accrue...');
    await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => balances(s).dust > 0n)));
  }
  return { ctx, providers: await configureProviders(ctx, network) };
})();

try {
  // -------------------------------------------------------------------------
  // The authority as it stands. Re-read now, not from the deployment record:
  // the counter is live state and the record can be stale.
  // -------------------------------------------------------------------------
  const current = await readAuthority(providers.providers, address);
  log(`Current authority on ${network.name}: ${current.summary}`);
  log(`Current committee: ${current.committee.map(shortKey).join(' ')}`);

  if (current.threshold === THRESHOLD && current.committee.length === COMMITTEE_SIZE) {
    die(`the authority is already ${current.summary}. Nothing to install.`);
  }
  if (current.committee.length !== 1 || current.threshold !== 1) {
    die(
      `the current authority is ${current.summary}, not the 1-of-1 this script knows how to spend.\n` +
        '  A threshold authority has to be signed by its own members, whose keys this script does not\n' +
        '  hold. Assemble that update by hand with cli/src/committee.ts (readAuthority, buildUpdate,\n' +
        '  signUpdate with one Signer per seat, submitUpdate).',
    );
  }

  const deployerKey = await providers.providers.privateStateProvider.getSigningKey(address);
  if (!deployerKey) {
    die(
      `no signing key for ${address} in the private-state store. Without the current 1-of-1 key this\n` +
        '  change cannot be authorised at all. Check you are running as the deployer, against the same\n' +
        '  ./midnight-level-db, and that ONEPLEDGE_NETWORK matches the store the key was written to.',
    );
  }

  // -------------------------------------------------------------------------
  // Generate the new committee, then PROVE WE HOLD IT before touching chain.
  //
  // Installing a committee nobody can sign for is the one unrecoverable
  // mistake available here, so it is checked first: build a throwaway update
  // against the authority as it WOULD be after the install (hence counter
  // current + 1 -- the ledger bumps the counter on every applied update) and
  // verify every signature against the prospective committee. Nothing below
  // is submitted.
  // -------------------------------------------------------------------------
  const newSigningKeys: SigningKey[] = Array.from({ length: COMMITTEE_SIZE }, () => sampleSigningKey());
  const newCommittee = committeeFromSigningKeys(newSigningKeys);
  log(`Prospective committee (${THRESHOLD} of ${COMMITTEE_SIZE}): ${newCommittee.map(shortKey).join(' ')}`);

  // EVERY seat, not threshold-many. The gate's whole job is "prove you hold what you are about to
  // install", and signing with only the first two would leave the third key written into the backup
  // and into the committee without anything ever having checked that it signs. Threshold-many is
  // what the chain requires; all of them is what this check is for.
  const rehearsalSigners = newSigningKeys.map((signingKey, index) => ({ index, signingKey }));
  // An update shaped exactly like the next real one: counter current + 1 is what the authority's
  // counter will be once the install lands, so this is the update a future committee would build.
  // It is signed and verified, never submitted.
  const throwaway = signUpdate(
    replaceAuthorityUpdate(address, { counter: current.counter + 1n }, newCommittee, THRESHOLD),
    rehearsalSigners,
    { threshold: THRESHOLD, committeeSize: COMMITTEE_SIZE },
  );
  const proof = verifyUpdateSignatures(throwaway, newCommittee, THRESHOLD);
  if (!proof.ok) {
    die(
      `cannot produce ${THRESHOLD} valid signatures for the committee about to be installed:\n` +
        proof.problems.map((p) => `    - ${p}`).join('\n') +
        '\n  Installing it would leave the contract permanently unmaintainable.',
    );
  }
  if (proof.verified !== COMMITTEE_SIZE) {
    die(
      `only ${proof.verified} of ${COMMITTEE_SIZE} generated keys produce a verifying signature. ` +
        'Every seat must be proven before any of them is installed.',
    );
  }
  log(`Pre-flight: all ${proof.verified} of ${COMMITTEE_SIZE} keys produce signatures that verify against the new committee.`);

  // -------------------------------------------------------------------------
  // Back up the keys. Before submitting, and fatal if it fails.
  // -------------------------------------------------------------------------
  try {
    writeBackup(
      newSigningKeys.map((signingKey, index) => ({ index, signingKey, verifyingKey: newCommittee[index] })),
    );
  } catch (e) {
    die(
      `could not back up the new signing keys to ${backupFile}: ${(e as Error).message}\n` +
        '  Nothing has been submitted. The keys generated by this run are now gone, which is the safe\n' +
        '  outcome: fix the destination and run again.',
    );
  }
  log(`Backed up ${COMMITTEE_SIZE} signing keys to ${backupFile} (mode 0600, fsynced, read back verified).`);

  // -------------------------------------------------------------------------
  // Submit. The two counters are set inside replaceAuthorityUpdate.
  // -------------------------------------------------------------------------
  const update = replaceAuthorityUpdate(address, current, newCommittee, THRESHOLD);
  const signed = signUpdate(update, [{ index: 0, signingKey: deployerKey }], {
    threshold: current.threshold,
    committeeSize: current.committee.length,
  });
  const authorising = verifyUpdateSignatures(signed, current.committee, current.threshold);
  if (!authorising.ok) {
    die(
      'the current 1-of-1 key does not produce a signature valid for the authority on chain:\n' +
        authorising.problems.map((p) => `    - ${p}`).join('\n'),
    );
  }
  log(`Submitting ReplaceAuthority: ${current.summary} -> ${THRESHOLD}-of-${COMMITTEE_SIZE}...`);
  const tx = await submitUpdate(providers.providers, signed);
  log(`Finalized: tx ${tx.txId} status ${tx.status}`);
  if (tx.status !== 'SucceedEntirely') {
    throw new Error(`ReplaceAuthority did not succeed: ${tx.status}. The authority is unchanged; re-read it and retry.`);
  }

  // -------------------------------------------------------------------------
  // Read it back from chain. Not from our own intent.
  // -------------------------------------------------------------------------
  // Poll, do not read once. The indexer lags finalization -- on Preprod via Blockfrost by more than
  // the devnet's moment -- so a single read here can still return the OLD authority and raise a
  // false "not the one we installed" on the one operation that cannot be repeated. That is the
  // worst possible signal to hand an operator: the install did land, and a panicked re-run would
  // either be refused (the authority is no longer the 1-of-1 this script spends) or rejected by the
  // node on the counter. rehearse-committee.ts polls for the same reason (`awaitAuthority`).
  let installed = await readAuthority(providers.providers, address);
  for (let attempt = 0; attempt < 60 && installed.committee.length !== COMMITTEE_SIZE; attempt += 1) {
    if (attempt === 0) log('Submitted and finalized; waiting for the indexer to report the new authority...');
    await new Promise((r) => setTimeout(r, 2_000));
    installed = await readAuthority(providers.providers, address);
  }
  console.log(`\nAuthority now on chain for ${address}: ${installed.summary}`);
  for (const [i, key] of installed.committee.entries()) console.log(`  seat ${i}: ${key}`);
  const asExpected =
    installed.threshold === THRESHOLD &&
    installed.committee.length === COMMITTEE_SIZE &&
    installed.committee.every((k, i) => k === newCommittee[i]);
  if (!asExpected) {
    throw new Error(
      `The authority read back from chain is not the one we installed: ${installed.summary}.\n` +
        `  The ReplaceAuthority tx above reported SucceedEntirely, so DO NOT re-run this script.\n` +
        '  Re-read the authority directly (npm run verify:onchain, or readAuthority) before doing\n' +
        '  anything else; a lagging indexer looks exactly like this.',
    );
  }

  console.log(
    '\nAdd this to the deployment record so verify:onchain pins the committee (this script does not\n' +
      'edit deployments/ itself):\n' +
      JSON.stringify(
        {
          maintenanceAuthority: {
            committeeSize: COMMITTEE_SIZE,
            threshold: THRESHOLD,
            committee: installed.committee,
            note: `${THRESHOLD}-of-${COMMITTEE_SIZE} contract maintenance authority. midnight-js cannot authorise maintenance for this contract; use cli/src/committee.ts.`,
          },
        },
        null,
        2,
      ),
  );
  console.log(
    `\nThe signing keys are in ${backupFile}. Distribute them to ${COMMITTEE_SIZE} separate custodians and\n` +
      'delete that single file once each key is in its own place. Until you do, the 2-of-3 is a 1-of-1\n' +
      'wearing a costume: every key is in one file on one machine.',
  );
} finally {
  await providers.ctx.wallet.stop().catch(() => {});
}
process.exit(0);
