# Wave 1 security review

Before submitting Wave 1 we ran an adversarial review of the whole project: contract soundness, protocol and trust model, privacy, off-chain code, the web app, tests, docs, reproducibility and presentation. It was a structured self-review, not an external audit: separate AI-assisted reviewer passes looked at the project through different lenses, and separate skeptic passes tried to refute each finding against the code and the live Preprod state. 121 raw findings merged into 88; 2 were refuted.

This page lists every finding that changes the security or trust story: the critical bug, each fix, and each limitation we accept for now. The remaining findings were lower-severity documentation, test, tooling, web and video items; they are not itemized here. An external review is planned for Wave 3.

The review itself was run for Wave 1 and has not been repeated: Wave 2's new circuits (the registrar committee, the borrowing base, encrypted delivery) have not been through an adversarial pass of their own. What this page does record is which Wave 1 findings Wave 2 actually closed, in the table below — and, where a row is only partly closed, which part is still open.

Severity scale: **critical** breaks the core guarantee; **high/medium** a reviewer or attacker would plausibly find it and it materially matters; **low/info** hardening.

## Fixed

### F01 (critical): one attestation could be pledged 256 times

**What was wrong.** The v1 `pledge` circuit verified the tag authority's Schnorr signature over a message built with `degradeToTransient(tag)`. That function maps a `Bytes<32>` to a field element by keeping only the low 248 bits, so the last byte of the tag never entered the signed message. The circuit then inserted the full 32-byte tag into the `tags` set.

**Impact.** A borrower holding one valid attestation could change byte 31 of the tag, and the result still verified, was not yet in the set, and was accepted. One invoice could be pledged to up to 256 lenders, exactly the double financing OnePledge exists to prevent. The same truncation applied to the invoice commitment. The borrower key was not affected, because the circuit compares it in full.

**How it was confirmed.** In the simulator with the v1 contract: after a valid pledge, flipping byte 0 or byte 30 of the tag was rejected, and flipping byte 31 produced a second accepted pledge (`pledgeCount = 2`). The v1 contract deployed on Preprod had the same verifier key, so it had the same flaw. No exploit transaction was ever sent to Preprod.

**Fix (registry v2).** The tag authority now signs a single field: `degradeToTransient(persistentHash(AttestationBody))`, where the body is the whole attestation (domain `onepledge:attest:v2`, the registry's own address, tag, invoice commitment, acceptance day, expiry, borrower key). Every bit of every field goes through SHA-256. The field then keeps 248 bits of a SHA-256 digest, which is sound for a hash output. The truncation in v1 was harmful only because it was applied to raw data.

**Regression tests** ([`security.test.ts`](../contract/src/test/security.test.ts)): for every byte position 0–31, a second pledge with that tag byte flipped is rejected; for every byte position, a flipped invoice commitment is rejected; a stretched expiry is rejected.

**v1 status.** The v1 registry `9eefef80…` is deprecated. Its record is kept in [`deployments/archive/`](../deployments/archive/) for transparency. The Live page and all links point at whatever `deployments/preprod.json` records as live. v1 is still callable on Preprod (its verifier keys were not removed) and shares the tag authority and window of every later version, so it must not be used; the authority signs only attestations naming the current registry (M1 below).

### F70 (high): one receivable could be counted twice in a borrowing base

**Found after the Wave 2 code was written**, by an adversarial review of the submission deck rather
than of the contract — the reviewer was checking whether a slide overclaimed and read the circuit to
find out.

**What was wrong.** `proveBorrowingBase` asserted that the four pool items' *note commitments* were
pairwise distinct. A note commitment is `persistentHash(domain, tag, lender, invoiceCommit, amount,
salt)`, so two pledges of the same receivable to the same lender under different salts are two
different commitments. `declinePledge` removes the tag from `tags` but cannot remove the note from
`notes`, which is an append-only `HistoricMerkleTree`, and the declining lender necessarily still
holds that note's opening — it needed it to decline. So a receivable pledged, declined and pledged
again to the same lender leaves that lender holding two valid, distinct openings for one invoice.

**Impact.** A lender could pad its borrowing base with one receivable counted up to four times, by
colluding with a borrower to repeat pledge-and-decline. Confirmed in the simulator: a pool of
9,000,000 + 9,000,000 + 1,000,000 + 1,000,000 grosz, where the two nines are the same invoice,
proved a floor of **20,000,000 grosz against a book genuinely worth 11,000,000**. This is the
registry's own guarantee — one pledge per receivable — failing one level up, in the circuit meant to
prove a book is real.

**Fix.** Compare the *tags*, which are what identify a receivable, instead of the notes. The tags are
private witnesses and only their inequality is proven, so the fix costs nothing and discloses
nothing: it is strictly better at the same price. Only `proveBorrowingBase` changed, so exactly one
verifier key changed and the other eight stayed byte-identical.

**How it reached the live contract, and how it was repaired.** The hole was deployed. Rather than
redeploy and abandon an address that the recorded scenario, the published attestations and the
README table all point at, the single changed verifier key was replaced in place through the
contract maintenance authority — a `VerifierKeyRemove` followed by a `VerifierKeyInsert`, each a
signed maintenance update, rehearsed end to end on a local devnet first. The draw proven at block
2,993,004 was made under the old circuit; its pool was four genuinely distinct receivables, so that
proof was sound in fact, but it was not *guaranteed* sound, and it is left on chain and described
here rather than quietly forgotten.

**Regression tests** ([`registry.test.ts`](../contract/src/test/registry.test.ts)): the attack
itself — pledge, decline, re-pledge to the same lender, then a pool counting both notes — is
refused, at a floor the padded book would clear *and* at a floor the real book clears, because the
pool itself is invalid. A positive control proves a decline in a lender's history does not make its
genuine book unprovable.

**What a draw still cannot prove.** `accepted`, `declined` and `releases` are `Set`s, and a Compact
circuit can only ask a `Set` about a key it discloses. So a draw cannot require that its four
receivables were accepted, nor that they were not later declined or released, without publishing the
decision nullifier and tying the draw back to the accepts behind it — which would group a lender's
book, the one thing the contract exists to prevent. A lender can therefore still include a
receivable it declined, or one it has already been paid for. That is a stated limitation, not an
oversight, and it is the reason the pool-distinctness check had to be right.

### F32 (medium): attestations were not bound to a deployment

A signed attestation did not name the registry it was for, so a redeploy with the same tag authority and window, or a clone, accepted the same invoice again with an empty tag set. **Fix:** the signed body includes `kernel.self()`, the registry's address. **Tests:** an attestation signed for another address is rejected, and replaying one attestation on a second deployment with the same authority and window is rejected.

### F33 (low): attestations never expired

**Fix:** attestations carry `expiresAt`, rounded up to a whole UTC day because the pledge publishes it, and `pledge` asserts `blockTimeLt(expiresAt)`. **Tests:** accepted one second before expiry, rejected at and after expiry, expiry rounding.

### F67 (low): the identity point was accepted as tag authority

With the identity point as authority, any signature would verify. **Fix:** the constructor and `pledge` both reject the identity point; signing keys must satisfy `0 < sk < order`. **Tests:** deployment with the identity point is refused; out-of-range keys are refused.

### F46 (low): four `disclose()` calls had no effect

Removed the wrappers around the window asserts and the Schnorr quotient and remainder. The compiler accepts the contract without them, and the comments now say assert conditions are proven, not published.

### F11 (medium): privacy tests could not detect a leak of a Field or a hash

The v1 privacy tests searched transcripts for known private values in a few encodings. A contract that published a Field-typed or hashed private value passed them. **Fix:** each circuit's public transcript is now checked against an allowlist. Every value longer than a 2-byte constant must be something the design publishes (tag, note leaf hash, roots, nullifier, registry address, expiry, public ledger reads), in either byte order. Positive controls check that the detector flags injected values. **Verified by mutation:** a contract that disclosed `degradeToTransient(borrower)` failed the new test while the old search-based tests still passed.

### F47 (low): a wallet snapshot saved after our own transactions corrupted the next restore

Found during the v2 redeploy. The CLI saved wallet state right after submitting transactions; that state included optimistic local updates the indexer later replayed, and the next restore looped on "values inserted non-linearly". **Fix:** commands that submit transactions no longer snapshot; snapshots are refused while transactions are pending; the previous snapshot is kept as `.bak`; each sub-wallet restores independently.

### Also fixed from the review

- **Documentation accuracy:** the tag authority's view of pledges; which parties the snooping defence covers; the upgrade key; KSeF coverage; the exact attribution sentence; the explorer link. See the README.
- **Off-chain verification for lenders:** `verifyAttestation` in the attester package, and a tag check on the Live page.
- **Tooling:**
  - `npm run verify:onchain` compares each circuit's on-chain verifier key and the sealed ledger fields with this repository.
  - `deploy` refuses to overwrite a deployment record without `FORCE=1` and archives the old one.
  - The demo records transaction hashes and proving times.

## Accepted for Wave 1, and what Wave 2 did with each

| Id | Limitation | Status after Wave 2 |
|---|---|---|
| F10 | A borrower with a valid attestation can pledge to any admitted lender without that lender's consent, permanently using up the tag; there is no void path. | **Fixed in Wave 2 (registry v3).** `acceptPledge` and `declinePledge`: the lender of record decides, proving it is the lender the same way `release` does. Declining removes the tag, so the receivable can be financed elsewhere. Still open: there is no deadline, so an undecided pledge holds the tag until the lender acts. |
| F31, F27 | A stolen tag-authority signing key allows forged attestations; keys are stored as local files. | **Still open**, and the attestation now also carries the invoice amount, so a stolen key can inflate a borrowing base as well as forge a pledge. The KMS split and the registrar pause did not land. Wave 3: threshold tags, so no single key signs. |
| F09 | The deployer holds a 1-of-1 contract maintenance key that can replace verifier keys. Recorded in `deployments/preprod.json`. | **Still open.** Wave 2's 2-of-3 committee is the registrar role *inside* the contract; the Midnight maintenance authority is a separate key and is still 1-of-1 (`maintenanceAuthority` in `deployments/preprod.json`). These two are easy to conflate and the README and threat model now separate them explicitly. Wave 3: a committee here too, then freeze a v1.0 deployment. |
| F24 | Pledges and releases disclose the Merkle root they used; a stale root narrows timing. | **Still open**, and now wider: `proveBorrowingBase` discloses a root per membership proof too. Honest clients use the current root. Wave 2 did not add the assertion as planned. |
| F25 | Release publishes a nullifier but does not free the receivable; tags are permanent by design. | **Still open.** A declined pledge frees the tag (F10); a released one does not. Wave 3: an `assign` circuit for lender-to-lender transfer. |
| F34 | A correction invoice has its own KSeF number; tagging by root invoice is attester policy, not contract-enforced. | **Still open.** A read-only KSeF 2.0 client landed (`attester/src/ksef-client.ts`, 27 tests), but it is exercised only against hand-authored fixtures, has never called the live test environment, and is not wired into the attestation flow. Demo invoices still use synthetic numbers and corrections are still unmapped. |
| F35, F36 | Lender tree holds 1,024 entries, notes 65,536; lenders cannot be retired. | **Partly fixed in Wave 2.** `approveAdmit` and `executeAdmit` both refuse a lender already in `lenderEncryptionKeys`, so the duplicate-admission check landed. The revocation set and resized trees did not: a lender still cannot be retired, and the depths are unchanged. The notes depth is also what caps a borrowing-base pool at four — see the README. |
| F68 | `rotateRegistrar` is one step; rotating to a wrong key locks admissions. | **Fixed in Wave 2 (registry v4).** `rotateRegistrar` is gone. A 2-of-3 registrar committee replaced the single registrar key: `approveRotate` plus `executeRotate` need two approvals from distinct members, the new committee must have three distinct members, a rotation is replay-protected by the `executed` set, and because every action hash binds `committeeEpoch`, rotating also voids every proposal pending under the old committee. One member can no longer hand the role anywhere. Tests: `registry.test.ts` "registrar committee" (13 cases). **Still open:** all three seats are deployer-held in this demo, so the mechanism is distributed and the custody is not, and the anonymity set for an approval is three. Also still open, and narrower than the original finding rather than gone: `registrars` is a depth-4 tree (16 leaves) and each committee spends three, so the fifth rotation fails on the tree bound and the committee seated at that point can never be replaced. |
| M1 (post-review) | Versions are separated only by disjoint acceptance windows or by the authority's discipline. v1 through v4 all share one acceptance window and one tag authority, so migration relies on the authority not re-attesting for the current registry an invoice already tagged on an earlier one. Every invoice pledged on a previous version was synthetic. | Still open, and one version wider each wave. Wave 3: a disjoint window, or import of the previous tag set. |
| F12 | The web app does not originate transactions; real transactions come from the CLI. | **Fixed in Wave 2.** `/desk` connects a Midnight wallet, builds the provider stack a Preprod pledge actually goes through, and submits a real `pledge` from the visitor's own wallet. The transactions recorded in the README's deployment table still come from the CLI demo run, which is what exercises all nine circuits in order. |
| F37, F38, F39 | No proof-server-level tests, no racing-transaction test, no web or CLI tests in CI. | **Mostly fixed in Wave 2.** CI now runs three jobs: (1) compile the contract, typecheck, all 272 unit tests, and the Playwright browser suite against the production build; (2) start a proof server and generate one genuine `pledge` proof (`npm run prove:smoke --workspace cli`) — the simulator never asks a prover for anything, so this is what stops the whole suite passing while proving is broken; (3) bring up a local devnet, deploy the registry and run the whole scenario. **Still open:** a racing-transaction test, and any test of the CLI's own code paths. |

## Refuted during review

- **F74:** "App screenshot text in the demo video is unreadable at 1080p." It reads fine.
- **F78:** "The web walkthrough leaks the amount behind a public pledge." The linkage it described was already public and the data is synthetic.
