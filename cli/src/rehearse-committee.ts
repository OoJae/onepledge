// SPDX-License-Identifier: Apache-2.0
// Local-devnet rehearsal for the 2-of-3 contract maintenance authority.
//
// This is the evidence that `committee.ts` works. It deploys a throwaway registry to the local
// devnet, installs a 2-of-3 maintenance authority with the deployer's 1-of-1 key, and then -- at
// the point where midnight-js can no longer authorise anything for this contract -- performs a
// real verifier-key remove and re-insert with two of the three new keys, and finally proves that
// one signature alone is refused.
//
// Run it from the repository's `logs/` directory, never from `cli/`: the level private-state store
// lives at `./midnight-level-db` relative to the process's working directory and a Preprod run may
// be holding `cli/midnight-level-db`.
//
//   cd logs && ONEPLEDGE_NETWORK=undeployed PROOF_SERVER_URL=http://127.0.0.1:6300 \
//     npx -y node@22 --import tsx ../cli/src/rehearse-committee.ts
//
// Bring the devnet up first, WITHOUT its own proof server (reuse the one on 6300):
//   docker compose -f local-devnet/standalone.yml up -d node indexer

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  sampleSigningKey,
  signatureVerifyingKey,
  type ContractAddress,
  type SignatureVerifyingKey,
  type SigningKey,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { MidnightProvider, MidnightProviders, UnboundTransaction, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { dayFromIso, publicKeyOf, randomScalar } from '@onepledge/attester';
import { Registry, type OnePledgePrivateState, type RegistryCircuits } from '@onepledge/contract';
import { selectNetwork } from './config.js';
import {
  buildUpdate,
  committeeFromSigningKeys,
  insertVerifierKey,
  readAuthority,
  removeVerifierKey,
  replaceAuthorityUpdate,
  shortKey,
  signUpdate,
  submitUpdate,
  verifyUpdateSignatures,
  type Authority,
} from './committee.js';
import { registryContract, zkConfigPath, type PartyId, type RegistryProviders } from './providers.js';
import { balances, registerNightForDust, startWallet, syncSummary, walletSeed, withDustRetry, type WalletContext } from './wallet.js';

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

// ---------------------------------------------------------------------------
// Guard rails. This script exists to run on the local devnet and nowhere else.
// ---------------------------------------------------------------------------
if ((process.env.ONEPLEDGE_NETWORK ?? 'preprod') !== 'undeployed') {
  console.error(
    `Refusing to run: ONEPLEDGE_NETWORK=${process.env.ONEPLEDGE_NETWORK ?? '(unset, defaults to preprod)'}.\n` +
      'This rehearsal submits irreversible maintenance transactions and is only ever run against the ' +
      'local devnet. Re-run with ONEPLEDGE_NETWORK=undeployed.',
  );
  process.exit(1);
}
const network = selectNetwork('undeployed');

const results: { label: string; ok: boolean; detail: string }[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  results.push({ label, ok, detail });
  return ok;
};

// The circuit whose verifier key we take out and put back. `executeAdmit` is the cheapest to
// re-insert (a 2.1 KiB verifier key) and is not involved in anything else this script does.
const ROUND_TRIP_CIRCUIT = 'executeAdmit';

/** An unsigned update that removes the round-trip circuit's verifier key, valid at `counter`. */
const removeVerifierKeyUpdate = (address: ContractAddress, counter: bigint) =>
  buildUpdate(address, [removeVerifierKey(ROUND_TRIP_CIRCUIT)], counter);

/** An unsigned update that puts those exact bytes back, valid at `counter`. */
const insertVerifierKeyUpdate = (address: ContractAddress, counter: bigint, rawVk: Buffer) =>
  buildUpdate(address, [insertVerifierKey(ROUND_TRIP_CIRCUIT, new Uint8Array(rawVk))], counter);

/**
 * Provider set for the rehearsal.
 *
 * Deliberately NOT `configureProviders` from providers.ts: that helper reads and writes key
 * material under `.secrets/` (party secrets, the tag-authority scalar, the private-state storage
 * password). This rehearsal needs none of that -- it is a throwaway contract on a throwaway chain
 * -- so it generates its own ephemeral material and never touches `.secrets/`. The six provider
 * slots and their arguments are otherwise identical to `configureProviders`.
 */
const rehearsalProviders = async (ctx: WalletContext): Promise<RegistryProviders> => {
  await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const walletProvider: WalletProvider & MidnightProvider = {
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
  const zkConfigProvider = new NodeZkConfigProvider<RegistryCircuits>(zkConfigPath);
  // A fresh store name per run: the rehearsal must never resume someone else's private state.
  const storeName = `onepledge-rehearsal-${Date.now()}`;
  // Generated once, not per call. The provider asks for this password again on every read, and a
  // fresh value each time decrypts to "Cipher job failed". It never leaves this process: the store
  // is thrown away with the run.
  const storagePassword = `${randomBytes(32).toString('hex')}Aa1!`;
  const providers: MidnightProviders<RegistryCircuits, PartyId, OnePledgePrivateState> = {
    privateStateProvider: levelPrivateStateProvider<PartyId, OnePledgePrivateState>({
      privateStateStoreName: storeName,
      privateStoragePasswordProvider: () => storagePassword,
      accountId: 'committee-rehearsal',
    }),
    publicDataProvider: indexerPublicDataProvider(network.indexer, network.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(network.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
  return providers;
};

/** The error message a failure carries, however it is wrapped. */
const errorText = (e: unknown): string => {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur instanceof Error && depth < 5; depth += 1) {
    parts.push(`${cur.name}: ${cur.message}`);
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.length ? parts.join(' <- caused by ') : String(e);
};

const withTimeout = async <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${what}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Wait for the indexer to report the authority we expect; it lags the block by a moment. */
const awaitAuthority = async (
  providers: RegistryProviders,
  address: ContractAddress,
  predicate: (a: Authority) => boolean,
  what: string,
): Promise<Authority> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const authority = await readAuthority(providers, address);
    if (predicate(authority)) return authority;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Indexer never reported ${what} for ${address}`);
};

const operationBytes = async (providers: RegistryProviders, address: ContractAddress, circuit: string) => {
  const state = await providers.publicDataProvider.queryContractState(address);
  const vk = state?.operation(circuit)?.verifierKey;
  return vk ? Buffer.from(vk) : undefined;
};

/** Poll until the named operation is present / absent as expected. */
const awaitOperation = async (
  providers: RegistryProviders,
  address: ContractAddress,
  circuit: string,
  present: boolean,
): Promise<Buffer | undefined> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const bytes = await operationBytes(providers, address, circuit);
    if (present === (bytes !== undefined)) return bytes;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Operation ${circuit} never became ${present ? 'present' : 'absent'} on ${address}`);
};

let ctx: WalletContext | undefined;
try {
  // -------------------------------------------------------------------------
  // 1. Wallet on the devnet, funded from the genesis seed.
  // -------------------------------------------------------------------------
  log(`Devnet: indexer ${network.indexer}, node ${network.node}, proof server ${network.proofServer}`);
  ctx = await startWallet(await walletSeed(network), network, { restore: false });
  log('Waiting for wallet sync...');
  const state = await ctx.wallet.waitForSyncedState();
  log(syncSummary(state));
  const { night, dust } = balances(state);
  log(`NIGHT=${night} DUST=${dust}`);
  if (dust === 0n) {
    if (night === 0n) throw new Error('Devnet wallet has no NIGHT. Is the node the dev preset, at the genesis seed?');
    const txId = await registerNightForDust(ctx);
    log(txId ? `Registered NIGHT for DUST (tx ${txId}). Waiting for DUST...` : 'Waiting for DUST to accrue...');
    await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => balances(s).dust > 0n)));
    log('DUST available.');
  }

  const providers = await rehearsalProviders(ctx);

  // -------------------------------------------------------------------------
  // 2. Deploy a throwaway registry. Ephemeral key material only: nothing here
  //    is read from or written to `.secrets/`.
  // -------------------------------------------------------------------------
  const registrarSecrets = [0, 1, 2].map(() => new Uint8Array(randomBytes(32)));
  const registrarCommittee = registrarSecrets.map((s) => Registry.pureCircuits.registrarKey(s));
  const tagSk = randomScalar();
  const tagPk = publicKeyOf(tagSk);
  const windowStart = dayFromIso('2026-07-01');
  const windowEnd = dayFromIso('2027-01-01');

  log('Deploying a throwaway registry to the devnet (proving on the shared proof server)...');
  // This is the one operation here that races a young chain: the rehearsal runs against a devnet
  // that was just started, where the DUST figure logged above reads full while the ledger still
  // refuses the fee. The maintenance updates further down run minutes later against a chain that has
  // moved on, so they are not exposed to it. See withDustRetry for the measurements.
  const deployed = await withDustRetry(
    () =>
      deployContract(providers, {
        compiledContract: registryContract,
        privateStateId: 'registrar',
        initialPrivateState: { secretKey: registrarSecrets[0] },
        args: [tagPk, BigInt(windowStart), BigInt(windowEnd), registrarCommittee],
      } as never),
    log,
  );
  const pub = (deployed as { deployTxData: { public: { contractAddress: string; txId: string; blockHeight: number } } })
    .deployTxData.public;
  const address = pub.contractAddress as ContractAddress;
  log(`Deployed at ${address} in tx ${pub.txId} (block ${pub.blockHeight})`);

  // -------------------------------------------------------------------------
  // 3. The authority as deployed: 1-of-1, counter 0.
  // -------------------------------------------------------------------------
  const initial = await readAuthority(providers, address);
  check('deployed authority is 1-of-1', initial.committee.length === 1 && initial.threshold === 1, initial.summary);
  check('deployed authority counter is 0', initial.counter === 0n, `counter ${initial.counter}`);

  const deployerKey = (await providers.privateStateProvider.getSigningKey(address)) as SigningKey | null;
  if (!deployerKey) throw new Error(`No signing key stored for ${address}; deployContract should have stored one`);

  // Cross-check the two WASM copies of the signing primitives before relying on them. midnight-js
  // minted this key with onchain-runtime-v3's `sampleSigningKey`; every signature we produce from
  // here on goes through ledger-v8's `signData`. If ledger-v8's `signatureVerifyingKey` reproduces
  // the committee entry the chain holds, the two share one key encoding and one signature scheme.
  check(
    'deployer signing key derives the on-chain committee key (onchain-runtime-v3 <-> ledger-v8)',
    signatureVerifyingKey(deployerKey) === initial.committee[0],
    `${shortKey(initial.committee[0])}`,
  );

  // -------------------------------------------------------------------------
  // 4. Install the 2-of-3, signed by the existing 1-of-1.
  // -------------------------------------------------------------------------
  const newSigningKeys: SigningKey[] = [sampleSigningKey(), sampleSigningKey(), sampleSigningKey()];
  const newCommittee: SignatureVerifyingKey[] = committeeFromSigningKeys(newSigningKeys);
  log(`New committee (2 of 3): ${newCommittee.map(shortKey).join(' ')}`);

  const installUpdate = replaceAuthorityUpdate(address, initial, newCommittee, 2);
  check(
    'ReplaceAuthority update carries the CURRENT counter',
    installUpdate.counter === initial.counter,
    `update counter ${installUpdate.counter}, authority counter ${initial.counter}`,
  );
  const installed = signUpdate(installUpdate, [{ index: 0, signingKey: deployerKey }], {
    threshold: initial.threshold,
    committeeSize: initial.committee.length,
  });
  check(
    'dataToSign is unchanged by addSignature',
    Buffer.from(installUpdate.dataToSign).equals(Buffer.from(installed.dataToSign)),
    `${installUpdate.dataToSign.length} bytes`,
  );
  check(
    'the signature verifies against the OLD committee (the one authorising the change)',
    verifyUpdateSignatures(installed, initial.committee, initial.threshold).ok,
  );

  log('Submitting the ReplaceAuthority (1-of-1 -> 2-of-3)...');
  const installTx = await submitUpdate(providers, installed);
  log(`ReplaceAuthority finalized: tx ${installTx.txId} status ${installTx.status}`);
  check('ReplaceAuthority transaction succeeded', installTx.status === 'SucceedEntirely', installTx.status);

  const twoOfThree = await awaitAuthority(providers, address, (a) => a.committee.length === 3, 'a 3-member committee');
  check('authority committee size is 3', twoOfThree.committee.length === 3, twoOfThree.summary);
  check('authority threshold is 2', twoOfThree.threshold === 2, `threshold ${twoOfThree.threshold}`);
  check('authority counter is 1', twoOfThree.counter === 1n, `counter ${twoOfThree.counter}`);
  check(
    'authority committee is exactly the three keys we generated, in order',
    twoOfThree.committee.length === newCommittee.length &&
      twoOfThree.committee.every((k, i) => k === newCommittee[i]),
    twoOfThree.committee.map(shortKey).join(' '),
  );

  // From here on midnight-js cannot authorise anything for this contract: every maintenance
  // transaction below is assembled by committee.ts.

  // -------------------------------------------------------------------------
  // 5a. Remove a verifier key with two of the three new keys.
  //     Seats 0 and 2, not 0 and 1, so a wrong `idx` cannot pass by luck.
  // -------------------------------------------------------------------------
  const committedVk = fs.readFileSync(path.join(zkConfigPath, 'keys', `${ROUND_TRIP_CIRCUIT}.verifier`));
  const liveVk = await operationBytes(providers, address, ROUND_TRIP_CIRCUIT);
  check(
    `on-chain ${ROUND_TRIP_CIRCUIT} verifier key equals the committed .verifier file`,
    liveVk !== undefined && liveVk.equals(committedVk),
    `${committedVk.length} bytes`,
  );

  const beforeRemove = await readAuthority(providers, address);
  const removeTxUpdate = signUpdate(
    removeVerifierKeyUpdate(address, beforeRemove.counter),
    [
      { index: 0, signingKey: newSigningKeys[0] },
      { index: 2, signingKey: newSigningKeys[2] },
    ],
    { threshold: beforeRemove.threshold, committeeSize: beforeRemove.committee.length },
  );
  check(
    'two-of-three signatures verify against the new committee',
    verifyUpdateSignatures(removeTxUpdate, beforeRemove.committee, beforeRemove.threshold).ok,
    `seats ${removeTxUpdate.signatures.map(([i]) => i).join(',')}`,
  );
  log(`Submitting VerifierKeyRemove(${ROUND_TRIP_CIRCUIT}) signed by seats 0 and 2...`);
  const removeTx = await submitUpdate(providers, removeTxUpdate);
  log(`VerifierKeyRemove finalized: tx ${removeTx.txId} status ${removeTx.status}`);
  check('2-of-3 VerifierKeyRemove transaction succeeded', removeTx.status === 'SucceedEntirely', removeTx.status);
  await awaitOperation(providers, address, ROUND_TRIP_CIRCUIT, false);
  check(`${ROUND_TRIP_CIRCUIT} operation is gone from chain`, true, 'queryContractState().operation() is undefined');

  // -------------------------------------------------------------------------
  // 5b. Put it straight back, again with two of three.
  // -------------------------------------------------------------------------
  const beforeInsert = await readAuthority(providers, address);
  log(`Authority before the re-insert: ${beforeInsert.summary}`);
  const insertTxUpdate = signUpdate(
    insertVerifierKeyUpdate(address, beforeInsert.counter, committedVk),
    [
      { index: 1, signingKey: newSigningKeys[1] },
      { index: 2, signingKey: newSigningKeys[2] },
    ],
    { threshold: beforeInsert.threshold, committeeSize: beforeInsert.committee.length },
  );
  log(`Submitting VerifierKeyInsert(${ROUND_TRIP_CIRCUIT}) signed by seats 1 and 2...`);
  const insertTx = await submitUpdate(providers, insertTxUpdate);
  log(`VerifierKeyInsert finalized: tx ${insertTx.txId} status ${insertTx.status}`);
  check('2-of-3 VerifierKeyInsert transaction succeeded', insertTx.status === 'SucceedEntirely', insertTx.status);
  const restored = await awaitOperation(providers, address, ROUND_TRIP_CIRCUIT, true);
  check(
    `${ROUND_TRIP_CIRCUIT} verifier key is back and byte-identical to the committed file`,
    restored !== undefined && restored.equals(committedVk),
    `${restored?.length ?? 0} bytes`,
  );

  // -------------------------------------------------------------------------
  // 6. The negative: one signature where two are required.
  // -------------------------------------------------------------------------
  const beforeNegative = await readAuthority(providers, address);

  // 6a. committee.ts refuses locally, before any key is used.
  let localRefusal = '';
  try {
    signUpdate(removeVerifierKeyUpdate(address, beforeNegative.counter), [{ index: 0, signingKey: newSigningKeys[0] }], {
      threshold: beforeNegative.threshold,
      committeeSize: beforeNegative.committee.length,
    });
  } catch (e) {
    localRefusal = errorText(e);
  }
  check('committee.ts refuses to assemble a 1-of-3 update', localRefusal !== '', localRefusal);

  // 6b. The real test: force one signature past our own guard and let the chain judge it.
  //     `threshold: 1` here is a deliberate lie to signUpdate so it will build the update; the
  //     authority on chain still requires two.
  const underSigned = signUpdate(
    removeVerifierKeyUpdate(address, beforeNegative.counter),
    [{ index: 0, signingKey: newSigningKeys[0] }],
    { threshold: 1, committeeSize: beforeNegative.committee.length },
  );
  check(
    'the under-signed update carries exactly one valid signature',
    underSigned.signatures.length === 1 &&
      verifyUpdateSignatures(underSigned, beforeNegative.committee, 1).verified === 1,
    `signatures=${underSigned.signatures.length}`,
  );
  // Observed on the devnet: the node rejects it at submission rather than including a failing
  // transaction, so nothing is spent and the counter does not move. polkadot-js logs the RPC-level
  // reason on stderr -- `1010: Invalid Transaction: Custom error: 136` -- and the thrown error that
  // reaches us is `(FiberFailure) SubmissionError: Transaction submission error`.
  log('Submitting a 1-of-3 update that the 2-of-3 authority must refuse...');
  let chainRefusal = '';
  try {
    const bad = await withTimeout(submitUpdate(providers, underSigned), 240_000, 'the node to judge the 1-of-3 update');
    chainRefusal = bad.status === 'SucceedEntirely' ? '' : `rejected with status ${bad.status} (tx ${bad.txId})`;
  } catch (e) {
    chainRefusal = errorText(e);
  }
  check('a single signature is refused when the threshold is 2', chainRefusal !== '', chainRefusal);

  // And the contract is untouched by the refused attempt.
  const after = await readAuthority(providers, address);
  check(
    'the refused attempt left the authority untouched',
    after.counter === beforeNegative.counter && after.threshold === 2 && after.committee.length === 3,
    after.summary,
  );
  const stillThere = await operationBytes(providers, address, ROUND_TRIP_CIRCUIT);
  check(
    `${ROUND_TRIP_CIRCUIT} survived the refused removal`,
    stillThere !== undefined && stillThere.equals(committedVk),
  );

  log(`Rehearsal contract: ${address} (throwaway, devnet only)`);
} catch (e) {
  check('rehearsal ran to completion', false, errorText(e));
  console.error(e);
} finally {
  await ctx?.wallet.stop().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(72)}`);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.label}${f.detail ? `  (${f.detail})` : ''}`);
  console.log('\nREHEARSAL FAILED');
  process.exit(1);
}
console.log('REHEARSAL PASSED: a 2-of-3 maintenance authority was installed and then used.');
process.exit(0);
