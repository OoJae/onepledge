// SPDX-License-Identifier: Apache-2.0
// Replaces one circuit's verifier key on a deployed registry, in place.
//
// WHY THIS EXISTS, and it is not a hypothetical: an adversarial review of the Wave 2 deck found that
// `proveBorrowingBase` compared the four pool items' note *commitments* for distinctness instead of
// their *tags*. Declining a pledge frees the tag but leaves the note in the append-only tree, and the
// declining lender keeps its opening, so one invoice pledged, declined and pledged again to the same
// lender yields two different commitments for one receivable. A test proved a floor of 20,000,000
// grosz against a book genuinely worth 11,000,000. The fix changed one circuit, so exactly one
// verifier key changed and the other eight are byte-identical — which is precisely the situation the
// contract maintenance authority exists for. Redeploying would have thrown away a contract address
// that twenty-two recorded scenario steps, the published attestations and the README table all point
// at, to fix something the upgrade path can fix in place.
//
// The mechanism was rehearsed end to end on the local devnet first
// (`cli/src/rehearse-committee.ts`, 22/22 checks), including the negative case where the node itself
// refuses an under-signed update.
//
// Remove and insert go as TWO transactions, not one two-instruction update, because two transactions
// is the path the rehearsal actually exercised. Between them the circuit has no verifier key and
// cannot be called; that window is a few seconds and is recoverable by re-running, since the
// authority is unaffected either way. Re-read the authority between them: the ledger increments its
// counter on every applied maintenance update, so a counter held in a variable across two
// submissions is already stale.
//
//   CIRCUIT=proveBorrowingBase CONFIRM=<contract address> npx -y node@22 --import tsx src/replace-vk.ts
//
// DRY_RUN=1 does everything except submit.

import fs from 'node:fs';
import path from 'node:path';
import {
  buildUpdate,
  insertVerifierKey,
  readAuthority,
  removeVerifierKey,
  shortKey,
  signUpdate,
  submitUpdate,
  verifyUpdateSignatures,
} from './committee.js';
import { selectNetwork } from './config.js';
import { configureProviders, readDeployment, writeDeployment, zkConfigPath } from './providers.js';
import { startWallet, walletSeed } from './wallet.js';

const network = selectNetwork();
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const record = readDeployment(network);

const circuit = process.env.CIRCUIT;
if (!circuit) {
  console.error('Set CIRCUIT to the circuit whose verifier key should be replaced.');
  process.exit(1);
}
// Two independent confirmations: the circuit by name, and the address by value. Naming the address
// is what stops this running against the wrong deployment after a redeploy.
if (process.env.CONFIRM !== record.contractAddress) {
  console.error(
    `Set CONFIRM to the contract address this should modify.\n` +
      `  expected: CONFIRM=${record.contractAddress}\n` +
      `  got:      CONFIRM=${process.env.CONFIRM ?? '(unset)'}`,
  );
  process.exit(1);
}

const vkFile = path.join(zkConfigPath, 'keys', `${circuit}.verifier`);
if (!fs.existsSync(vkFile)) {
  console.error(`No committed verifier key at ${vkFile}. Compile the contract first.`);
  process.exit(1);
}
const committed = new Uint8Array(fs.readFileSync(vkFile));
const dryRun = process.env.DRY_RUN === '1';

const ctx = await startWallet(await walletSeed(network), network);
log('Waiting for wallet sync...');
for (let attempt = 1; ; attempt++) {
  try {
    await ctx.wallet.waitForSyncedState();
    break;
  } catch (e) {
    if (attempt >= 6) throw e;
    log(`wallet sync failed; retrying in 20s (attempt ${attempt} of 6)...`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
}
const providers = await configureProviders(ctx, network);
providers.privateStateProvider.setContractAddress(record.contractAddress);

const onChainVk = async () => {
  const state = await providers.publicDataProvider.queryContractState(record.contractAddress);
  if (!state) throw new Error('No contract state on chain');
  const vk = state.operation(circuit)?.verifierKey;
  return vk ? new Uint8Array(vk) : undefined;
};
const same = (a: Uint8Array | undefined, b: Uint8Array) =>
  a !== undefined && a.length === b.length && a.every((byte, i) => byte === b[i]);

const before = await onChainVk();
log(`Contract ${record.contractAddress}`);
log(`Circuit  ${circuit}`);
log(`On chain ${before ? `${before.length} bytes` : '(no verifier key)'}`);
log(`Committed ${committed.length} bytes`);
// FORCE_ROUNDTRIP removes and re-inserts a key that already matches. It changes nothing about the
// contract, which is the point: it is how a threshold authority is exercised on a live deployment
// without risking anything, by doing a real maintenance update whose only visible effect is the
// authority's counter moving. `rehearse-committee.ts` does the same on the devnet.
const roundTrip = process.env.FORCE_ROUNDTRIP === '1';
if (same(before, committed) && !roundTrip) {
  log('The on-chain key already equals the committed one. Nothing to do. (FORCE_ROUNDTRIP=1 to exercise the authority anyway.)');
  await ctx.wallet.stop();
  process.exit(0);
}
if (roundTrip) log('FORCE_ROUNDTRIP=1: removing and re-inserting a key that already matches, to exercise the authority.');

// The signing key for the current authority. For a 1-of-1 this is the deployer's key, sampled at
// deploy time and held only in the encrypted private-state store.
const authority = await readAuthority(providers, record.contractAddress);
log(`Authority ${authority.summary}: ${authority.committee.map(shortKey).join(' ')}`);

/**
 * Where the signatures come from, which depends on what the authority is.
 *
 * A 1-of-1 is the deployer's key, sampled at deploy time and living only in the encrypted
 * private-state store. Above that, midnight-js cannot help at all — it builds exactly one signature
 * at index 0 — so the keys come from the backup `install-committee.ts` wrote, and each is matched to
 * its seat by verifying key rather than by position in the file. Matching by position would be a
 * silent way to sign at the wrong index, which is an invalid update rather than a wrong one, but
 * still a wasted irreversible-looking failure on a live contract.
 *
 * In a real 2-of-3 these keys sit on three machines and the signatures are collected and combined;
 * `committee.ts` is written for that. This reads one file because in this demo one party holds all
 * three, which is a fact about the custody and not about the mechanism.
 */
const signers = await (async (): Promise<{ index: number; signingKey: string }[]> => {
  if (authority.threshold === 1 && authority.committee.length === 1) {
    const key = await providers.privateStateProvider.getSigningKey(record.contractAddress);
    if (!key) {
      console.error(
        `No maintenance signing key for ${record.contractAddress} in the private-state store. ` +
          'Without it this deployment cannot be maintained at all.',
      );
      await ctx.wallet.stop();
      process.exit(1);
    }
    return [{ index: 0, signingKey: key }];
  }

  const keysPath = process.env.COMMITTEE_KEYS?.trim();
  if (!keysPath) {
    console.error(
      `The authority is ${authority.summary}, so this needs ${authority.threshold} signatures. Set ` +
        'COMMITTEE_KEYS to the backup install-committee.ts wrote.',
    );
    await ctx.wallet.stop();
    process.exit(1);
  }
  const backup = JSON.parse(fs.readFileSync(path.resolve(keysPath), 'utf8')) as {
    contractAddress?: string;
    keys: { signingKey: string; verifyingKey: string }[];
  };
  if (backup.contractAddress && backup.contractAddress !== record.contractAddress) {
    console.error(`${keysPath} holds keys for ${backup.contractAddress}, not ${record.contractAddress}.`);
    await ctx.wallet.stop();
    process.exit(1);
  }
  const seated = backup.keys
    .map((k) => ({ index: authority.committee.indexOf(k.verifyingKey as never), signingKey: k.signingKey }))
    .filter((k) => k.index >= 0);
  if (seated.length < authority.threshold) {
    console.error(
      `${keysPath} holds ${seated.length} key(s) that sit in the on-chain committee, but ` +
        `${authority.threshold} are needed. The contract cannot be maintained with these keys.`,
    );
    await ctx.wallet.stop();
    process.exit(1);
  }
  // Threshold-many, in seat order, so the log reads the same way twice running.
  const chosen = seated.sort((a, b) => a.index - b.index).slice(0, authority.threshold);
  log(`Signing with committee seats ${chosen.map((c) => c.index).join(', ')} from ${keysPath}`);
  return chosen;
})();

/** One maintenance transaction, signed by whatever the authority requires, against a fresh counter. */
const apply = async (label: string, instruction: () => ReturnType<typeof removeVerifierKey>) => {
  const current = await readAuthority(providers, record.contractAddress);
  const update = signUpdate(buildUpdate(record.contractAddress, [instruction()], current.counter), signers, {
    threshold: current.threshold,
    committeeSize: current.committee.length,
  });
  const check = verifyUpdateSignatures(update, current.committee, current.threshold);
  if (!check.ok) throw new Error(`${label}: refusing to submit, ${check.problems.join('; ')}`);
  log(`${label}: ${check.verified} valid signature(s) against counter ${current.counter}`);
  if (dryRun) {
    log(`${label}: DRY_RUN=1, not submitting`);
    return;
  }
  const tx = await submitUpdate(providers, update);
  const data = tx as { txId?: string; status?: string; txHash?: string; blockHeight?: number };
  log(`${label}: ${data.status ?? 'submitted'} (tx hash ${data.txHash ?? '?'}, block ${data.blockHeight ?? '?'})`);
  // Record it where the README table is generated from. A maintenance update changes what the
  // deployed contract *is*, so leaving it out of the record would make the published history of this
  // address quietly incomplete — and the table claims to be generated, never typed by hand.
  record.events.push({
    label: `${label[0].toUpperCase()}${label.slice(1)}`,
    circuit: 'maintenance',
    txId: data.txId,
    txHash: data.txHash,
    blockHeight: data.blockHeight,
    outcome: `accepted: ${data.status ?? 'submitted'}`,
    at: new Date().toISOString(),
  });
  writeDeployment(network, record);
};

await apply(`remove ${circuit}`, () => removeVerifierKey(circuit));
if (!dryRun) {
  const gone = await onChainVk();
  if (gone !== undefined) throw new Error(`${circuit} still has a verifier key on chain after the removal`);
  log(`${circuit} has no verifier key on chain; inserting the committed one.`);
}

await apply(`insert ${circuit}`, () => insertVerifierKey(circuit, committed) as never);
if (!dryRun) {
  const after = await onChainVk();
  if (!same(after, committed)) {
    throw new Error(`${circuit}'s on-chain key does not match the committed file after the insert`);
  }
  log(`${circuit}'s on-chain verifier key now equals the committed file (${committed.length} bytes).`);
  log(`Authority is now ${(await readAuthority(providers, record.contractAddress)).summary}.`);
}

await ctx.wallet.stop();
log('Done. Run `npm run verify:onchain` to confirm.');
process.exit(0);
