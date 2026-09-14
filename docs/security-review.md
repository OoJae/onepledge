# Wave 1 security review

Before submitting Wave 1 we ran an adversarial review of the whole project: contract soundness, protocol and trust model, privacy, off-chain code, the web app, tests, docs, reproducibility and presentation. Independent reviewers raised findings; separate skeptics tried to refute each one against the code and the live Preprod state. 121 raw findings merged into 88; 2 were refuted. This page records what was found, what was fixed, and what is accepted for now.

Severity scale: **critical** breaks the core guarantee; **high/medium** a reviewer or attacker would plausibly find it and it materially matters; **low/info** hardening.

## Fixed

### F01 (critical): one attestation could be pledged 256 times

**What was wrong.** The v1 `pledge` circuit verified the tag authority's Schnorr signature over a message built with `degradeToTransient(tag)`. That function maps a `Bytes<32>` to a field element by keeping only the low 248 bits, so the last byte of the tag never entered the signed message. The circuit then inserted the full 32-byte tag into the `tags` set.

**Impact.** A borrower holding one valid attestation could change byte 31 of the tag, and the result still verified, was not yet in the set, and was accepted. One invoice could be pledged to up to 256 lenders, exactly the double financing OnePledge exists to prevent. The same truncation applied to the invoice commitment. The borrower key was not affected, because the circuit compares it in full.

**How it was confirmed.** In the simulator with the v1 contract: after a valid pledge, flipping byte 0 or byte 30 of the tag was rejected, and flipping byte 31 produced a second accepted pledge (`pledgeCount = 2`). The v1 contract deployed on Preprod had the same verifier key, so it had the same flaw. No exploit transaction was ever sent to Preprod.

**Fix (registry v2).** The tag authority now signs a single field: `degradeToTransient(persistentHash(AttestationBody))`, where the body is the whole attestation (domain `onepledge:attest:v2`, the registry's own address, tag, invoice commitment, acceptance day, expiry, borrower key). Every bit of every field goes through SHA-256. The field then keeps 248 bits of a SHA-256 digest, which is sound for a hash output. The truncation in v1 was harmful only because it was applied to raw data.

**Regression tests** ([`security.test.ts`](../contract/src/test/security.test.ts)): for every byte position 0–31, a second pledge with that tag byte flipped is rejected; for every byte position, a flipped invoice commitment is rejected; a stretched expiry is rejected.

**v1 status.** The v1 registry `9eefef80…` is deprecated. Its record is kept in [`deployments/archive/`](../deployments/archive/) for transparency. The Live page and all links point to v2.

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

## Accepted for Wave 1, planned

| Id | Limitation | Plan |
|---|---|---|
| F10 | A borrower with a valid attestation can pledge to any admitted lender without that lender's consent, permanently using up the tag; there is no void path. | Wave 2: lender acceptance (pledge then accept-with-timeout) and a time-locked registrar-and-authority void path. |
| F31, F27 | A stolen tag-authority signing key allows forged attestations; keys are stored as local files. | Wave 2: split signing and HMAC keys into a KMS, add a registrar pause. Wave 3: threshold tags, so no single key signs. |
| F09 | The deployer holds a 1-of-1 contract maintenance key that can replace verifier keys. Recorded in `deployments/preprod.json`. | Wave 2: 2-of-3 committee. Wave 3: freeze a v1.0 deployment. |
| F24 | Pledges and releases disclose the Merkle root they used; a stale root narrows timing. | Honest clients use the current root; Wave 2 asserts it. |
| F25 | Release publishes a nullifier but does not free the receivable; tags are permanent by design. | Wave 3: an `assign` circuit for lender-to-lender transfer. |
| F34 | A correction invoice has its own KSeF number; tagging by root invoice is attester policy, not contract-enforced. | Wave 2 KSeF adapter maps corrections to the root number. |
| F35, F36 | Lender tree holds 1,024 entries, notes 65,536; lenders cannot be retired. | Wave 2: revocation set, duplicate-admission check, sized trees. |
| F68 | `rotateRegistrar` is one step; rotating to a wrong key locks admissions. | Wave 2: two-step handover. |
| F12 | The web app does not originate transactions; real transactions come from the CLI. | Wave 2: Lace-connected borrower desk and lender inbox. |
| F37, F38, F39 | No proof-server-level tests, no racing-transaction test, no web or CLI tests in CI. | Wave 2 test plan. |

## Refuted during review

- **F74:** "App screenshot text in the demo video is unreadable at 1080p." It reads fine.
- **F78:** "The web walkthrough leaks the amount behind a public pledge." The linkage it described was already public and the data is synthetic.
