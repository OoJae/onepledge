# AKINDO Wave 1 submission: OnePledge

Paste-ready text for the AKINDO submission form. The rules require entries to be submitted personally.

## Product name

OnePledge

## Tagline

One pledge per invoice, without any lender seeing another's book.

## Tags

Privacy · DeFi · Market Infrastructure

## Links

- Live demo: https://onepledge.vercel.app
- GitHub (Wave 1 tag): https://github.com/OoJae/onepledge/tree/wave-1
- Demo video: {{VIDEO_URL}}
- Deck: https://github.com/OoJae/onepledge/blob/wave-1/docs/OnePledge-Wave1-deck.pdf
- Registry v2 on Midnight Preprod: https://preprod.midnightexplorer.com/contracts/567df565569f032c0a32a0029fb2fdea9befb8b8ccccb3fb86736f10030c2355
- Security review: https://github.com/OoJae/onepledge/blob/wave-1/docs/security-review.md

## Updates in this Wave

Wave 1 took OnePledge from an empty repository to a registry deployed and exercised on Midnight Preprod, then attacked by its own adversarial review and redeployed with the fixes.

**The problem.** The same invoice gets pledged to several lenders, and each pays out. Lenders could catch it by pooling their books, but no lender will show a rival its clients. The obvious blockchain fix, a public hash of each financed invoice, fails twice: a differently spelled invoice number is a new hash, and anyone holding an invoice can look up whether and when it was financed.

**What OnePledge does.** Poland's KSeF e-invoicing system gives each invoice issued through it one canonical 35-character number. A tag authority turns it into a keyed tag (HMAC under its secret, so the public tag set cannot be searched by guessing numbers). It signs one SHA-256 digest of the whole attestation: the registry's address, the tag, an invoice commitment, the acceptance day, an expiry and the borrower's key. The borrower's pledge proof checks, in zero knowledge, that the signature is valid for this registry and unexpired, the date is inside the registry's window, the lender is admitted, and the tag has never been pledged. The financing lender receives the invoice; a rival lender given the tag learns only "already pledged"; the public sees an opaque tag and a note commitment.

**Built this wave**

- Compact contract (toolchain 0.31.1, the version Preprod runs), 4 circuits with proving keys: `admitLender`, `rotateRegistrar`, `pledge`, `release`.
  - In-circuit Jubjub Schnorr verification of the tag authority's attestation (bounded-quotient polyfill, adapted from midnightntwrk/example-zkloan).
  - Lender membership proven against a historic Merkle root without revealing which lender; tags in a permanent `Set`; pledge notes in a `HistoricMerkleTree`; unlinkable release nullifiers.
  - Every role key is a domain-separated hash of a witness secret; `ownPublicKey()` is never used.
- Attester package: KSeF number parser (CRC-8 and NIP check digit), keyed tags, invoice commitments, a Schnorr signer that hashes with the contract's compiled pure circuit, and `verifyAttestation` for lenders.
- 176 tests, all passing in CI on every push:
  - 49 registry tests: double-pledge variants, forgery cases including a malicious prover, borrower binding, window boundaries, forged lender and note paths, release authorization.
  - 76 security regression tests: every tag and invoice-commitment byte flipped, cross-registry replay, expiry, identity-point keys.
  - 12 privacy tests that check every value longer than two bytes in each circuit's public transcript against an allowlist; during the review a one-off mutant contract that leaked a borrower value failed them.
  - 39 attester tests.
- CLI: headless wallet with sync snapshots, deploy and end-to-end scenario scripts, and `verify:onchain`, which checks each on-chain verifier key against the repository.
- Web app, hosted: a walkthrough that runs the compiled circuits in the browser; the two hash-registry attacks side by side with OnePledge; a live page that reads the Preprod contract from the public indexer with a tag check, no wallet.

**Security review.** Before submitting we ran a structured adversarial self-review of the whole project (reviewer passes plus skeptic passes, not an external audit): 88 findings. It found a critical bug in registry v1: the signed message dropped the tag's last byte, so one attestation could be pledged up to 256 times. We confirmed it in the simulator (never exploited on Preprod), fixed it in v2, added a regression test for every byte, deprecated v1 and published the review: the critical bug, every security fix and every accepted limitation.

**On Midnight Preprod.** Registry v2 `567df565…0c2355` deployed at block 2,550,929. Then: two lenders admitted, invoice 1 pledged to lender A, the same invoice refused at lender B before proving ("Receivable already pledged"), invoice 2 pledged to lender B, invoice 1 released. Proofs took 0.9–4.5 s each on a laptop. Every transaction is linked from the README and the live page.

**Stated limitations.** A single tag authority is trusted to tag each invoice once and keep its keys safe (Wave 3: threshold committee). The deployer holds a 1-of-1 contract upgrade key (Wave 2: 2-of-3). There is no lender consent step or void path yet. OnePledge stops double financing, not fabricated invoices. Demo invoices use synthetic KSeF-format numbers.

**Found along the way.** The Preprod RPC sometimes closes the WebSocket as a transaction is sent ("Normal Closure"): repeatedly under Node 26.0.0, occasionally under Node 22. Retrying after checking that the ledger counter did not move handles it safely. The transaction ID midnight-js returns is not the hash the explorer uses; `FinalizedTxData.txHash` is. A wallet snapshot saved right after your own transactions can fail to restore; snapshot only when nothing is pending.

This project is built on the Midnight Network.

## What's next (Wave 2)

Lace-connected borrower desk and lender inbox; lender acceptance and a void path; encrypted invoice delivery; a KSeF test-environment adapter; a 2-of-3 upgrade committee; conversations with factors and KSeF integrators.
