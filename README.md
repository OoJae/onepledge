# OnePledge

**One pledge per receivable, across rival lenders, without any lender seeing another's book.**

OnePledge is a registry on [Midnight](https://midnight.network) that refuses to let the same invoice be financed twice. A borrower proves, in zero knowledge, that the tag authority attested an invoice for this registry and that the invoice has never been pledged. The public ledger stores an opaque tag and a note commitment. The financing lender learns the invoice; a rival lender learns only that it is already pledged; the tag authority learns that its invoice was pledged but not to whom; the public learns neither the invoice nor the lender.

This project is built on the Midnight Network.

<!-- links:start -->
| | |
|---|---|
| Start here (3 minutes, no install) | 1. [Walkthrough](https://onepledge.vercel.app/demo): pledge, refused double pledge, release. 2. [Attacks](https://onepledge.vercel.app/attacks): why a public hash registry fails. 3. [Live registry](https://onepledge.vercel.app/live): the deployed Preprod contract, read in your browser. Then [How to evaluate](#how-to-evaluate). |
| Live demo | [onepledge.vercel.app](https://onepledge.vercel.app): the landing page's 3D scene tells the pledge in four beats; the walkthrough runs the compiled circuits in your browser; the Live page reads Preprod |
| Proof | Registry v2 [on Preprod](#live-on-midnight-preprod) with 6 transactions · `npm run verify:onchain` matches every verifier key · 176 tests in CI · our own review found and fixed a critical bug ([F01](docs/security-review.md#f01-critical-one-attestation-could-be-pledged-256-times)) |
| Demo video | [youtu.be/tftA-AMT9VQ](https://youtu.be/tftA-AMT9VQ) (1:42): the problem, the refused second pledge, and the six Preprod transactions |
| Deck | [docs/OnePledge-Wave1-deck.pdf](docs/OnePledge-Wave1-deck.pdf) |
| Security review | [docs/security-review.md](docs/security-review.md) · [threat model](docs/threat-model.md) |
| Brand | [onepledge.vercel.app/brand](https://onepledge.vercel.app/brand) · [docs/brand](docs/brand/README.md) (mark, lockups, tokens, type, guilloché) |
| CI | [![CI](https://github.com/OoJae/onepledge/actions/workflows/ci.yml/badge.svg)](https://github.com/OoJae/onepledge/actions/workflows/ci.yml) |
<!-- links:end -->

Built for the Midnight Buildathon (AKINDO WaveHack), Wave 1.

![The OnePledge landing page: a notary seal has pressed a wax pledge onto an invoice, and the same invoice at Lender B is refused](docs/img/landing-scene.png)

---

## Live on Midnight Preprod

<!-- v2-deployment:start -->
**Registry v3** · contract [`488f67156c541957614bcd7be7e88593d5fc68bb1188fe18893c0485f0ba4900`](https://preprod.midnightexplorer.com/contracts/488f67156c541957614bcd7be7e88593d5fc68bb1188fe18893c0485f0ba4900) · deployed 2026-10-15 in block 2991455 · upgrade key: 1-of-1 deployer key

| Step | Circuit | Transaction | Block | Proved in | Finalized after |
|---|---|---|---|---|---|
| Deploy registry v3 | constructor | [`b48711e29351…`](https://preprod.midnightexplorer.com/transactions/b48711e29351677ef858376009d6ffba5d0651239462b4b2e34beac244d916bd) | 2991455 | | |
| Registrar admits lender A | `admitLender` | [`c7f2edb94fb5…`](https://preprod.midnightexplorer.com/transactions/c7f2edb94fb5e6d04e796490913363026773483212c717315470528f0b8401ae) | 2991568 | 0.6 s | 28.4 s |
| Registrar admits lender B | `admitLender` | [`dac7e2d3ab3c…`](https://preprod.midnightexplorer.com/transactions/dac7e2d3ab3c530fdec6015aeb0a6c660b75a9f2ba7f2adad184b0dea4902083) | 2991573 | 0.7 s | 29 s |
| Borrower pledges invoice 1 to lender A | `pledge` | [`d7012e0af2de…`](https://preprod.midnightexplorer.com/transactions/d7012e0af2de4282b4b8d6e330cdb41ffbaa80ba83a4789d1345833b8a7bda26) | 2991579 | 2.7 s | 35.9 s |
| Borrower re-pledges invoice 1 to lender B | `pledge` | none: rejected before proving: Receivable already pledged, so no proof or transaction could be built | | | |
| Lender A accepts invoice 1 | `acceptPledge` | [`55d65d52366e…`](https://preprod.midnightexplorer.com/transactions/55d65d52366ec66f11810f6c4c84911a547120df3dbc7d2ec5d685e711943fdf) | 2991584 | 2.2 s | 28.2 s |
| Borrower pledges invoice 2 to lender B | `pledge` | [`376c53a7a468…`](https://preprod.midnightexplorer.com/transactions/376c53a7a4680f975ef612cae34f501b5895de5a40547fb27452b44af46d6be5) | 2991589 | 1.8 s | 28.5 s |
| Lender B declines invoice 2, freeing the receivable | `declinePledge` | [`a7b3ecff91b0…`](https://preprod.midnightexplorer.com/transactions/a7b3ecff91b05aef406beb014de80edf7ded0a1783b08e67094a487ecfec5175) | 2991595 | 1.9 s | 33.7 s |
| Borrower pledges the freed invoice 2 to lender A | `pledge` | [`edb90b824280…`](https://preprod.midnightexplorer.com/transactions/edb90b824280d0654d5544a131f147a43459178bf0985b4bc9bed4fbc961c30d) | 2991600 | 1.8 s | 31.1 s |
| Lender A releases invoice 1 | `release` | [`7917e51555f9…`](https://preprod.midnightexplorer.com/transactions/7917e51555f917913427dcc4b6b8caeb011bc62b15acdc45ce89c3117a43f5f7) | 2991605 | 2.2 s | 28.7 s |

Step labels come from the operator's run log (`npm run demo`), not from the chain: on chain these are plain circuit calls that do not say which lender or invoice they concern. Proving ran on a local proof server (Docker, Apple silicon laptop); "finalized after" is from starting the call to the indexer reporting it.
<!-- v2-deployment:end -->

**Registry v1 is deprecated.** The Wave 1 security review found that v1 signed only 248 of the tag's 256 bits, so one attestation could be pledged again with a different last byte. v2 fixes it and adds deployment binding and expiry; see [docs/security-review.md](docs/security-review.md). The v1 record is kept in [`deployments/archive/`](deployments/archive/). v1 is still callable on Preprod (contracts cannot be deleted, and its verifier keys were not removed) and shares v2's tag authority and acceptance window; the tag authority now signs only v2 attestations, which name the v2 address. Do not use v1.

The explorer's contract page may label the most recent call as the "Deployment Tx"; the deploy transaction is the first row of the table above.

Check that the deployed contract is this repository's contract (no wallet needed):

```bash
npm ci && npm run verify:onchain
```

It compares every circuit's verifier key on chain with `contract/src/managed/registry/keys/*.verifier`, and the sealed tag authority and window with `deployments/preprod.json`. It trusts the public Preprod indexer; set `ONEPLEDGE_INDEXER` (and `ONEPLEDGE_INDEXER_WS`) to check against your own.

## The problem

In receivables finance a company borrows against invoices it has issued. The classic fraud is to pledge the same invoice to several lenders. Lenders could catch it by pooling their books, but a lender's client list and pricing are its business, so no lender will show them to a competitor.

The obvious blockchain fix, publishing `hash(invoice number, supplier, amount, due date)` and rejecting repeats, fails in two ways ([both attacks are in the live demo](https://onepledge.vercel.app/attacks)):

1. **Bypass.** Each bank writes invoice data its own way (`FV/2026/09/0412` vs `FV-2026-09-0412`, `PL5265877635` vs `5265877635`). A different spelling is a different hash, so the second pledge is accepted.
2. **Snooping.** Anyone who knows an invoice's details (the debtor, a lender that saw it during underwriting) can hash them and learn from the public registry whether, and when, it was financed.

## How OnePledge works

- **Canonical identity.** Poland's KSeF e-invoicing system assigns each invoice issued through it a unique 35-character number with a CRC-8 checksum. OnePledge accepts exactly one spelling of it.
- **Keyed tags.** The tag authority computes `T = HMAC-SHA256(tagSecret, KSeF number)`. The same invoice always has the same tag, and without the key nobody can turn an invoice number into its tag, so the public tag set cannot be searched by guessing numbers.
- **Attestation checked in-circuit.** The authority signs one SHA-256 digest of `(domain, registry address, T, invoiceCommit, acceptanceDay, expiresAt, borrowerKey)` with a Jubjub Schnorr key. The `pledge` circuit recomputes the digest and verifies the signature inside the proof. Any change to any field fails, and the attestation is valid only for this registry and until it expires.
- **One pledge, forever.** `pledge` inserts `T` into a public `Set` and fails if it is already there. Tags are never removed.
- **Private lender, private invoice.** The lender is proven to be admitted through a Merkle path, without revealing which lender. The note commitment hides the lender, the invoice commitment and a salt.
- **Unlinkable release.** Only the lender of record can release a pledge. It publishes a nullifier that cannot be linked to the note, the tag or the lender.

### What each party learns

| Party | Learns | Does not learn |
|---|---|---|
| Public (anyone reading the chain) | Tags, note leaf hashes, the roots used, expiry days, nullifiers, counts, timing | Invoice number, amount, debtor, borrower, which lender financed a pledge, which pledge was released |
| Financing lender | The full invoice (it receives the opening of `invoiceCommit` and checks it) | Other lenders' deals |
| Rival lender given a tag | That this invoice is pledged, and, since tags are permanent, its status from then on | By whom, for how much, on what terms |
| Tag authority | Which invoices it attested, the borrower key and invoice commitment it signed, and whether and when each was pledged (it computes the tags, and the tag set is public) | Which lender financed them, or the terms |

Lender keys are public leaves of the admitted-lender tree, so "which lender" is hidden among the admitted lenders, currently a small set.

These properties are enforced by [privacy tests](contract/src/test/privacy.test.ts) that check every value longer than two bytes in each circuit's public transcript against an allowlist of what the design publishes. During the review, a one-off mutant contract that disclosed `degradeToTransient(borrower)` failed them while the earlier search-based tests passed (security review F11).

## Why not a trusted registry, and why Midnight

| | Operator-run registry | Public hash registry | OnePledge on Midnight |
|---|---|---|---|
| Who sees each lender's queries and deals | The operator | Anyone who can hash the invoice | Nobody |
| Can a spelling change dodge it | No | Yes | No: one canonical KSeF number, keyed tag |
| Can outsiders enumerate who financed what | No | Yes | No: tags need the authority's key |
| Is "one pledge per invoice" checked by code anyone can verify | No: trust the operator's database | Yes | Yes: in-circuit, verifier keys on chain |
| What is still trusted | The operator, for everything | Nothing, but it leaks | The tag authority, to tag each invoice once (threshold tags in Wave 3), and the 1-of-1 upgrade key (2-of-3 in Wave 2) |

Midnight is what makes the right-hand column possible:
- **Private state with public verification.** The borrower's attestation, secret and the lender's identity stay in local private state; only what the circuit discloses reaches the public ledger.
- **Proofs over private data.** The signature check, lender-membership proof and borrower binding all run inside a zero-knowledge proof.
- **Selective disclosure as code.** Each `disclose()` is a deliberate, testable publication (see [the disclose ledger](docs/threat-model.md#what-each-circuit-publishes-the-disclose-ledger)).
- **Fees without linkage.** DUST fees are shielded, so paying a fee does not identify the party on chain.

## Lender protocol

What a lender does before funding a pledged invoice:

1. **Get the attestation and opening from the borrower.** The borrower hands over the attestation, the invoice fields and the salt behind `invoiceCommit`.
2. **Verify the attestation off-chain.** Use `verifyAttestation(tagAuthority, registryAddress, attestation)` from the attester package. It checks the tag authority's signature for this registry, the same way the circuit does.
3. **Check the tag against the public set.** Use the Live page's "Check a tag" box or the indexer. If the tag is already present, refuse: the invoice is encumbered.
4. **Check the invoice opening.** Use `verifyInvoiceOpening(invoiceCommit, fields, salt)`.
5. **Fund only against a note naming you.** Fund only after a pledge to your lender key lands on chain, then verify the note commitment with the opening you hold.

An honest borrower's client stops before proving when a tag is already pledged. A dishonest one that proves against stale state still fails: the proof's public transcript contains the tag-set lookup, and the ledger re-runs that transcript against its current state when it applies the transaction. That race has not yet been demonstrated on Preprod; a racing-transaction test is planned for Wave 2. Encrypted delivery of the opening to the lender is Wave 2.

## Midnight integration

**Public ledger state vs private state**

| Public ledger (`registry.compact`) | Private state (per party, local, [`witnesses.ts`](contract/src/witnesses.ts)) |
|---|---|
| `registrar` (hash of the registrar secret) | Registrar: `secretKey` |
| `tagAuthority`, `windowStart`, `windowEnd` (sealed) | Borrower: `secretKey`, the attestation, target lender key, note salt |
| `lenders` (HistoricMerkleTree of lender keys) | Lender: `secretKey`, the note opening it releases |
| `tags` (Set), `notes` (HistoricMerkleTree), `releases` (Set) | |
| `pledgeCount`, `releaseCount` (Counter) | |

**Transaction lifecycle (CLI, [`cli/src`](cli/src))**
1. **Witnesses:** the compiled contract calls into the party's private state.
2. **Proving:** the local proof server (`httpClientProofProvider`) generates the proof.
3. **Balancing:** the wallet (`WalletFacade`: shielded, unshielded and DUST) pays the fee in DUST.
4. **Submission:** the transaction goes to the Preprod node.
5. **Finalization:** the indexer (`indexerPublicDataProvider`) reports it and exposes the new ledger state.
6. **Storage:** private state is kept encrypted with `levelPrivateStateProvider`, scoped per contract address.

**Upgrade authority.** Midnight contracts have a maintenance authority that can insert or remove verifier keys. For this deployment it is a 1-of-1 key held by the deployer, recorded in `deployments/preprod.json`. Wave 2 moves it to a 2-of-3 committee; Wave 3 freezes a v1.0 deployment.

## Architecture

```mermaid
flowchart LR
  subgraph Off-chain
    KSeF[KSeF invoice number] --> TA[Tag authority<br/>attester package]
    TA -- "attestation: T, invoiceCommit, day,<br/>expiry, borrowerKey, Schnorr sig<br/>(signed for one registry)" --> B[Borrower<br/>private state]
    L[Lender] -- "lender key" --> B
  end
  subgraph Midnight
    B -- "pledge(lender): ZK proof" --> R[(Registry v2)]
    L -- "release(): ZK proof" --> R
    Reg[Registrar] -- "admitLender" --> R
  end
  R -. "public indexer" .-> W[Web: live registry page]
```

### Contract: [`contract/src/registry.compact`](contract/src/registry.compact)

Compact toolchain **0.31.1** (language 0.23), the version Preprod runs. 4 provable circuits.

| Circuit | Who runs it | What it proves |
|---|---|---|
| `admitLender(lender)` | Registrar | Caller knows the registrar secret. |
| `rotateRegistrar(next)` | Registrar | Same, then hands the role over. |
| `pledge(lender)` | Borrower | The attestation is bound to the caller's key; the tag authority (not the identity point) signed the digest of the exact body for this registry; the attestation has not expired; the acceptance day is inside the window; the lender is admitted; the tag is new. |
| `release()` | Lender of record | The caller's key is inside a note on the ledger; the nullifier is new. |
| `acceptPledge()` | Lender of record | Same proof of record as `release`; the lender has not already decided on this note. |
| `declinePledge()` | Lender of record | Same, and then removes the tag, so the receivable can be pledged again. |

- **Identity:** never uses `ownPublicKey()`. Every role key is a domain-separated hash of a witness secret.
- **Signatures:** public networks do not ship `jubjubSchnorrVerify` yet (toolchain 0.32+, ledger 9), so the Schnorr polyfill from [midnightntwrk/example-zkloan](https://github.com/midnightntwrk/example-zkloan) is used, including its bounded-quotient challenge reduction. The signer computes the message and challenge with the contract's own compiled pure circuits.
- **Decisions:** a lender records accept or decline as a domain-separated nullifier, unlinkable to the note and to the lender. Which set it lands in is public, because a declined receivable has to become visibly free again; the tag is disclosed only by `declinePledge`, so accepting never says which receivable was accepted.
- **Proving keys:** `pledge` 10.5 MB, `release`, `acceptPledge` and `declinePledge` about 10 MB each, `admitLender` and `rotateRegistrar` 2.7 MB each.

## Repository layout

```
contract/     Compact contract, witnesses, simulator, tests (vitest)
attester/     KSeF parser (CRC-8, NIP check digit), keyed tags, invoice commitments, signer and verifier
cli/          Headless wallet, deploy, end-to-end demo, verify:onchain
web/          React app: 3D landing scene (three.js), walkthrough on the compiled circuits, attacks, live Preprod reader, brand page; Playwright e2e
docs/         Security review, threat model, brand kit, deck, video script
local-devnet/ Docker Compose for a local Midnight node + indexer (from midnightntwrk/midnight-local-dev)
deployments/  Public record of deployments (active and archived)
```

## How to evaluate

### 1. Open the live demo

[onepledge.vercel.app](https://onepledge.vercel.app) needs no install:
- **Landing (`/`):** the pledge in four beats, as a scroll-driven 3D scene (illustrated beats with reduced motion or without WebGL).
- **Walkthrough (`/demo`):** pledge, rejected double pledge and release, running the compiled circuits in your browser.
- **Attacks (`/attacks`):** both attacks on a public hash registry, side by side with OnePledge.
- **Live registry (`/live`):** reads the Preprod contract from the public indexer, with a "Check a tag" box.
- **Brand (`/brand`):** the seal mark, lockups, colour, type and pattern, with files to download.

Old `/#/`, `/#/attack` and `/#/live` links still work.

![The walkthrough: the second pledge is refused, Lender A declines, and the freed invoice is financed by Lender B, which never learns who refused it](docs/img/walkthrough.png)

The walkthrough runs the compiled circuits against an in-memory ledger: no proofs, no transactions. The Preprod transactions come from the CLI.

### 2. Build and test (about a minute)

Requires Node.js 22.12+ and npm.

```bash
npm ci
npm test                          # contract (137) + attester (39) suites
npm run typecheck
npm run build --workspace web     # web app
npm run verify:onchain            # read-only check against Preprod
```

The compiled contract, ZK intermediate files and proving keys are committed, so nothing above needs the Compact toolchain. To recompile (CI does this and fails if the generated contract or ZK intermediate files differ from what is committed; verifier keys are checked against the chain by `verify:onchain`):

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.31.1
npm run compact    # runs compact compile +0.31.1; the first run downloads about 8 MB of ZK parameters
```

### 3. Run the web app locally

```bash
npm run build --workspace web && npx --workspace web vite preview   # then open http://localhost:4173
```

### 4. Deploy and run the scenario yourself

```bash
docker run -d -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v

# Preprod
npm run wallet:init --workspace cli     # prints an address; fund it at https://midnight-tmnight-preprod.nethermind.dev/
npm run wallet:daemon --workspace cli   # first sync takes about 2 hours (shielded minutes, DUST the rest)
npm run deploy --workspace cli          # stop the daemon first
npm run demo --workspace cli            # admit lenders, pledge, rejected double pledge, second pledge, release

# Local devnet instead (minutes, no faucet)
docker compose -f local-devnet/standalone.yml up -d node indexer
ONEPLEDGE_NETWORK=undeployed npm run deploy --workspace cli
ONEPLEDGE_NETWORK=undeployed npm run demo --workspace cli
```

- **Secrets:** the wallet mnemonic, tag-authority key and party secrets go into `.secrets/` (mode 0600, git-ignored).
- **Node version and RPC disconnects:** the CLI scripts run on Node 22 through `npx node@22`. The Preprod RPC sometimes closes the WebSocket as a transaction is sent ("Normal Closure"): repeatedly for us under Node 26.0.0, occasionally under Node 22.23 (two of three v2 deploy attempts). Rerunning succeeds; `npm run demo` retries on its own after checking that the ledger counter did not change. The root cause is not isolated.

## Tests

| Suite | Tests | Covers |
|---|---:|---|
| [`registry.test.ts`](contract/src/test/registry.test.ts) | 49 | Deployment; registrar auth and rotation; pledge; five double-pledge variants; forgery (swapped fields, foreign key, tampered response and announcement, other digest, malicious Schnorr reduction); borrower binding; window boundaries; lender paths and historic roots; release authorization, double release, forged note paths |
| [`security.test.ts`](contract/src/test/security.test.ts) | 76 | Regression tests from the security review: every byte of the tag and invoice commitment, stretched expiry, cross-registry replay, expiry boundaries, identity-point authority, off-chain `verifyAttestation` agreeing with the circuit |
| [`privacy.test.ts`](contract/src/test/privacy.test.ts) | 12 | Allowlist of every public value in the pledge, release, admit and rotate transcripts, with positive controls; no private value in public state |
| [`ksef.test.ts`](attester/test/ksef.test.ts) | 16 | Official Ministry of Finance example, CRC-8 check value, malformed spellings, NIP check digit, calendar validation |
| [`tag.test.ts`](attester/test/tag.test.ts) | 17 | Tag determinism and keying, canonical-spelling enforcement, commitment hiding and binding for every field |
| [`signing.test.ts`](attester/test/signing.test.ts) | 6 | Schnorr equation, scalar ranges, nonce freshness, wrong key and message |

- **Web end-to-end:** `npm run e2e --workspace web` runs Playwright against the production build (walkthrough, attacks, live read and tag check, legacy links, the 3D scene's modes, axe) at desktop and phone sizes.
- **What the tests run:** the compiled circuits in the simulator. Proof-server-level and racing-transaction tests are Wave 2.
- **Kinds of negative test:** some replace honest witnesses with malicious ones and exercise the circuit's own asserts. Others (missing lender path, unknown note) exercise client-side guards.

## Trust model and known limitations

- **Single tag authority.** Uniqueness relies on the authority tagging each invoice once and keeping its keys safe. A stolen signing key allows forged attestations; a leaked HMAC key lets the holder compute tags for known invoice numbers. Wave 3 replaces it with a verifiable threshold tag.
- **The authority attests existence, not truth.** OnePledge stops the same invoice being financed twice; it does not stop a fabricated invoice.
- **Lender consent is in, as of Wave 2.** A borrower can still pledge to any admitted lender, but the lender decides: accepting keeps the tag, declining removes it so the receivable can be financed elsewhere. What is still missing is a deadline — an undecided pledge holds the tag until the lender acts.
- **Invoices outside KSeF.** In 2026 some small sellers may still invoice outside KSeF. Lenders should require a KSeF number as a funding condition.
- **Corrections.** A correction invoice has its own KSeF number; the attester must tag it by the root invoice.
- **Tags are permanent once accepted.** A released pledge does not free the invoice, and anyone holding a tag can watch its status. Only a declined pledge frees it.
- **Metadata.** DUST fee spends are shielded and do not link parties. What does link activity is network-level: one client submitting several transactions to a shared RPC node, indexer subscriptions, and timing. The CLI demo runs all parties from one machine.
- **Synthetic KSeF numbers** until the Wave 2 test-environment adapter.
- **Upgrade key.** A 1-of-1 deployer maintenance key (see Midnight integration).

## Business model

- **Who runs the tag authority:** a KSeF-connected e-invoicing provider or a lenders' association, which already sees the invoices it attests.
- **Who pays:** lenders, per attestation checked or pledge registered, because a refused double pledge is a loss avoided; borrowers pay only the DUST network fee.
- **Why lenders join:** it works with two lenders, so no consortium has to form first, and no participant exposes its book.
- **Validation so far:** none with customers yet; Wave 2 starts with interviews with Polish factors and KSeF integrators.

## Roadmap

- **Wave 2:**
  - Lace-connected borrower desk and lender inbox on Preprod
  - lender acceptance and a void path
  - facilities with borrowing-base draws
  - encrypted invoice delivery to the lender
  - 2-of-3 registrar and upgrade committee
  - KSeF test-environment adapter
  - proof-server and end-to-end tests in CI
  - conversations with factors and KSeF integrators
- **Wave 3:**
  - verifiable threshold tags, so no single party can compute or sign tags
  - pledge assignment between lenders
  - a reusable uniqueness module for registries with guessable IDs
  - external review

## Attribution

- Schnorr polyfill, wallet construction and UI build setup adapted from [midnightntwrk/example-zkloan](https://github.com/midnightntwrk/example-zkloan) (Apache-2.0).
- Local devnet compose file from [midnightntwrk/midnight-local-dev](https://github.com/midnightntwrk/midnight-local-dev) (Apache-2.0).
- KSeF number format from the Polish Ministry of Finance specification, [CIRFMF/ksef-api](https://github.com/CIRFMF/ksef-api/blob/main/faktury/numer-ksef.md).

## License

[Apache-2.0](LICENSE)
