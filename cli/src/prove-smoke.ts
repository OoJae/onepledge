// SPDX-License-Identifier: Apache-2.0
// Generates one genuine zero-knowledge proof for the `pledge` circuit against a proof server, with
// no chain, no wallet, no DUST and no secret read from or written to disk — the committed prover key
// is the only thing it loads. CI runs this on every pull request.
//
// Why it exists: the simulator (contract/src/simulator.ts) runs the compiled circuits against an
// in-memory ledger and never asks a prover for anything, so the whole suite can pass while proving
// is broken — a witness the prover cannot satisfy, a committed prover key that no longer matches its
// zkIR, a toolchain bump that changes the proof format. None of that surfaced until someone ran
// `npm run demo` against a real deployment, by hand, after merge.
//
// Why a circuit call and not just the deploy transaction: a deploy carries verifier keys and no
// circuit proof at all, so proving one exercises the transaction plumbing and none of the ZK.
// `pledge` is the circuit the registry exists for — a Schnorr verification, a depth-10 Merkle
// membership proof, a block-time bound and a note commitment — so this script walks the public state
// forward with *unproven* calls (two committee approvals and an execution, which admit the lender)
// and sends only the pledge to the proof server.
//
// What this does and does not show. It shows that a proof for `pledge` can be generated from these
// witnesses with these keys, and how long that takes. It does not verify the proof: nothing here
// checks one against a ledger, because a ledger that verifies is a node. And it proves one circuit
// of nine — the three setup calls are built but not proved, which catches a broken witness or assert
// in them and not a broken key, and the remaining six circuits are not touched at all. Both gaps are
// the devnet job's to close (.github/workflows/ci.yml), which is why that job exists and why it runs
// nightly rather than on pull requests.

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ChargedState, sampleSigningKey } from '@midnight-ntwrk/compact-runtime';
import { createUnprovenCallTxFromInitialStates, createUnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {
  LedgerParameters,
  ZswapChainState,
  sampleEncryptionPublicKey,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import {
  addressBytes,
  attest,
  dayFromIso,
  invoiceCommitment,
  lenderEncryptionKey,
  newSalt,
  parseKsefNumber,
  publicKeyOf,
  randomScalar,
  receivableTag,
  sealOpening,
  syntheticKsefNumber,
  type InvoiceFields,
} from '@onepledge/attester';
import {
  Registry,
  makeRegistryContract,
  type OnePledgePrivateState,
  type RegistryCircuits,
} from '@onepledge/contract';
import { repoRoot, selectNetwork } from './config.js';

// `undeployed` is the honest network id here: nothing is submitted anywhere, and the id only has to
// be set because every transaction is built against one. selectNetwork also carries the
// PROOF_SERVER_URL override, so pointing this at another proof server works the same way it does for
// deploy and demo.
const network = selectNetwork('undeployed');

// The same directory providers.ts points NodeZkConfigProvider at, rebuilt rather than imported:
// providers.ts pulls in wallet.ts and with it the whole wallet SDK, and a gate on proving should not
// be able to fail because wallet code broke. Proving needs no wallet, which is the point.
const zkConfigPath = path.join(repoRoot, 'contract', 'src', 'managed', 'registry');

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

/**
 * Waits for the proof server to answer /health. Polled from here rather than from a workflow step,
 * because the obvious step is a copy of `local-devnet/standalone.yml`'s check,
 * `echo > /dev/tcp/127.0.0.1/6300` — and /dev/tcp is a bash feature, not a device, so under the
 * `sh` that GitHub gives `run:` steps that redirect fails identically whether the server is up or
 * not, and the wait never ends. Waiting here also gives a local run the same message.
 */
const waitForProofServer = async (uri: string, timeoutMs = 120_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${uri}/health`, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) {
        log(`Proof server ${uri} ready: ${(await res.text()).trim()}`);
        return;
      }
    } catch {
      // Still starting, or not there at all. Both look the same until the deadline.
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `No proof server answered ${uri}/health within ${timeoutMs / 1000}s. Start one with: ` +
          'docker run -d -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
};

// createUnprovenDeployTx reads exactly these two getters and nothing else. The coin public key is
// parsed, so it has to be well-formed hex; past that both values only resolve encryption targets for
// coins the constructor creates (the registry's constructor creates none) and stand in for the
// caller's key inside the contract runtime, which no registry circuit asks for — every role key is
// derived from a secret rather than from ownPublicKey(), see contract/src/witnesses.ts. A zero key
// therefore proves exactly as well as a funded one. (createUnprovenCallTxFromInitialStates takes the
// same two as plain arguments and never sees a wallet provider at all.) balanceTx is the one method
// that genuinely needs a funded wallet; it throws rather than pretending, because reaching it would
// mean this script had started trying to submit something.
const COIN_PUBLIC_KEY = '0'.repeat(64);
const ENCRYPTION_PUBLIC_KEY = sampleEncryptionPublicKey();

const walletProvider: WalletProvider = {
  getCoinPublicKey: () => COIN_PUBLIC_KEY,
  getEncryptionPublicKey: () => ENCRYPTION_PUBLIC_KEY,
  balanceTx: () => {
    throw new Error('prove-smoke never submits a transaction, so it never balances one');
  },
};

// Every secret is generated here and discarded when the process exits. Nothing is read from or
// written to .secrets/: a CI runner must not need key material, and a smoke test must not hold a key
// that could spend anything.
const freshSecret = () => new Uint8Array(randomBytes(32));
const committee = [freshSecret(), freshSecret(), freshSecret()];
const borrowerSecret = freshSecret();
const lenderSecret = freshSecret();
const authoritySk = randomScalar();
const tagSecret = freshSecret();

// Fixed window and invoice date. Deriving them from today would make this job start failing on a
// calendar boundary rather than on a code change, which is the opposite of what a gate is for.
const WINDOW_START = dayFromIso('2026-07-01');
const WINDOW_END = dayFromIso('2027-01-01');
const ACCEPTANCE_DATE = '2026-09-10';
// Clearly synthetic, like the demo's: real KSeF numbers are assigned by KSeF.
const KSEF_NUMBER = syntheticKsefNumber('5265877635', ACCEPTANCE_DATE, 'C1C1C1C1C1C1');

const main = async (): Promise<void> => {
  await waitForProofServer(network.proofServer);

  const zkConfigProvider = new NodeZkConfigProvider<RegistryCircuits>(zkConfigPath);
  const registry = makeRegistryContract(zkConfigPath);

  // The constructor runs locally; what comes back is the address the contract would have and an
  // initial state carrying the verifier keys for all nine circuits.
  const deployed = await createUnprovenDeployTx({ zkConfigProvider, walletProvider }, {
    compiledContract: registry,
    args: [
      publicKeyOf(authoritySk),
      BigInt(WINDOW_START),
      BigInt(WINDOW_END),
      committee.map((sk) => Registry.pureCircuits.registrarKey(sk)),
    ],
    initialPrivateState: { secretKey: committee[0] } satisfies OnePledgePrivateState,
    // A throwaway maintenance authority. This contract is never deployed, so nothing is ever signed
    // with it; a real deployment keeps the deployer's key in the private-state store and records only
    // its committee size and threshold in deployments/<network>.json.
    signingKey: sampleSigningKey(),
  } as never);
  const contractAddress = deployed.public.contractAddress;
  const contractState = deployed.public.initialContractState;
  log(`Registry constructed locally at ${contractAddress} (not deployed: nothing is submitted)`);

  /**
   * Runs one circuit against the current public state and keeps the result, without proving it.
   * Threading the state this way is what midnight-js itself does between calls inside a scoped
   * transaction: replace the contract state's `data` and keep the rest, because the verifier keys
   * hanging off that state are where createUnprovenCallTxFromInitialStates looks the circuit's
   * operation up. Rebuilding a bare ContractState from the next state value would drop them.
   *
   * `as never` on the options, as in deploy.ts: the SDK types the argument list per circuit id, and
   * a helper that takes a union of circuit ids cannot satisfy that without a cast.
   */
  const call = async (circuitId: RegistryCircuits, privateState: OnePledgePrivateState, args: unknown[]) => {
    const tx = await createUnprovenCallTxFromInitialStates(
      zkConfigProvider,
      {
        compiledContract: registry,
        circuitId,
        contractAddress,
        args,
        coinPublicKey: COIN_PUBLIC_KEY,
        initialContractState: contractState,
        // An empty Zswap chain state and the genesis ledger parameters: both are consulted only for
        // coins, and no registry circuit mints, spends or receives one.
        initialZswapChainState: new ZswapChainState(),
        ledgerParameters: LedgerParameters.initialParameters(),
        initialPrivateState: privateState,
      } as never,
      ENCRYPTION_PUBLIC_KEY,
    );
    contractState.data = new ChargedState(tx.public.nextContractState);
    return tx;
  };

  const lenderKey = Registry.pureCircuits.lenderKey(lenderSecret);
  const lenderEncKey = lenderEncryptionKey(lenderSecret);

  // Two of the three committee members approve, then any party executes. Unproven on purpose: these
  // steps only exist to put a lender in the registry tree so `pledge` has a membership path to
  // prove. Proving all four calls would cost four times the wall clock for no extra coverage of the
  // circuit that matters.
  log('Admitting a lender through the 2-of-3 committee (unproven: these only set up the state)...');
  await call('approveAdmit', { secretKey: committee[0] }, [lenderKey, lenderEncKey]);
  await call('approveAdmit', { secretKey: committee[1] }, [lenderKey, lenderEncKey]);
  await call('executeAdmit', { secretKey: committee[2] }, [lenderKey, lenderEncKey]);

  const invoice = parseKsefNumber(KSEF_NUMBER);
  const fields: InvoiceFields = {
    ksefNumber: invoice.canonical,
    sellerNip: invoice.sellerNip,
    debtorNip: '7010002139',
    amountGrosz: '12500000',
    currency: 'PLN',
    dueDate: '2026-11-30',
  };
  const invoiceSalt = newSalt();
  const attestation = attest(authoritySk, {
    registry: addressBytes(contractAddress),
    tag: receivableTag(tagSecret, invoice.canonical),
    invoiceCommit: invoiceCommitment(fields, invoiceSalt),
    amount: BigInt(fields.amountGrosz),
    acceptanceDay: invoice.acceptanceDay,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400),
    borrower: Registry.pureCircuits.borrowerKey(borrowerSecret),
  });

  const noteSalt = newSalt();
  // The circuit cannot constrain an Opaque value, so an empty buffer would prove just as well. This
  // runs the helper a borrower really calls so that a change breaking sealOpening shows up here
  // rather than only in the demo; it does not make the proof any stronger.
  const delivery = sealOpening(lenderEncKey, {
    tag: attestation.tag,
    invoiceCommit: attestation.invoiceCommit,
    amount: attestation.amount,
    salt: noteSalt,
  });

  const pledge = await call(
    'pledge',
    { secretKey: borrowerSecret, attestation, pledgeLender: lenderKey, noteSalt },
    [lenderKey, delivery],
  );

  // The circuit's own asserts fire while the call is built, before any proving, so reaching here
  // already means every check passed. The counter confirms the ledger moved rather than the call
  // quietly doing nothing.
  const ledger = Registry.ledger(pledge.public.nextContractState);
  if (ledger.pledgeCount !== 1n) {
    throw new Error(`pledge did not record a note: pledgeCount is ${ledger.pledgeCount}, expected 1`);
  }

  const unprovenBytes = pledge.private.unprovenTx.serialize().length;
  const proverKeyBytes = (await zkConfigProvider.getProverKey('pledge')).length;
  log(`Proving circuit 'pledge' on ${network.proofServer} (${mib(proverKeyBytes)} prover key)...`);

  const started = performance.now();
  const proven = await httpClientProofProvider(network.proofServer, zkConfigProvider).proveTx(
    pledge.private.unprovenTx,
  );
  const seconds = (performance.now() - started) / 1000;
  const provenBytes = proven.serialize().length;

  // The proof is the difference. A provider that handed the transaction straight back, or that
  // dropped the call, would not grow it.
  if (provenBytes <= unprovenBytes) {
    throw new Error(`Proving added no proof: ${unprovenBytes} bytes in, ${provenBytes} bytes out`);
  }

  log(`Proof generated in ${seconds.toFixed(1)}s`);
  log(`  unproven transaction: ${unprovenBytes.toLocaleString('en-US')} bytes`);
  log(`  proven transaction:   ${provenBytes.toLocaleString('en-US')} bytes`);
  log(`  proof:                ${(provenBytes - unprovenBytes).toLocaleString('en-US')} bytes`);
};

await main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
// Explicit, like the other CLI entry points: the ledger wasm and the proof server's keep-alive
// socket can hold the event loop open long after there is nothing left to do.
process.exit(0);
