# Threat model (registry v2, Wave 1)

## What we protect

| Asset | Property |
|---|---|
| "One pledge per receivable" | No invoice is pledged twice in a registry, whoever colludes, as long as the tag authority is honest. |
| A lender's book | Which invoices a lender financed, for whom, and on what terms. |
| Invoice contents | Amount, debtor, due date. |
| Borrower identity | Which company pledged. |

## Parties and what they are trusted with

| Party | Holds | Trusted for | Not trusted for |
|---|---|---|---|
| Tag authority | Jubjub signing key, HMAC tag secret | Computing one tag per KSeF invoice and signing only real invoices | Anything else: it never sees lenders or terms |
| Registrar | Registrar secret | Admitting real lenders | Pledges or tags |
| Borrower | Borrower secret, attestations, note salts | Nothing | Everything is checked in-circuit |
| Lender | Lender secret, invoice openings it receives | Nothing | — |
| Deployer | Contract maintenance key (1-of-1) | Not replacing verifier keys | Disclosed; 2-of-3 committee planned |
| Proof server | Witnesses while proving | Run locally by each party | A remote proof server would see private inputs |

## Adversaries considered

1. **Double-pledging borrower.** Tries to finance one invoice with several lenders by reusing, modifying or re-requesting attestations. Stopped by:
   - the in-circuit signature over a digest of the whole attestation
   - the permanent tag set
   - binding to the registry address
   - canonical KSeF numbers, one spelling each

   Tests: `registry.test.ts`, `security.test.ts`.
2. **Thief of an attestation.** Tries to pledge someone else's attestation. Stopped by the borrower-key binding checked in-circuit.
3. **Outside observer.** Reads the chain and indexer. Sees tags, note leaf hashes, nullifiers, roots, expiry days, counters and timing. Cannot compute a tag from an invoice number without the HMAC secret.
4. **Rival lender shown an invoice.** Learns "already pledged" if a borrower hands it the tag. Once it holds a tag it can keep watching that tag's status; it never learns who financed it or on what terms.
5. **Curious tag authority.** It computes tags itself, so it can tell whether and when an invoice it attested was pledged, and it saw the borrower key and invoice commitment it signed. It does not learn the lender or the terms.
6. **Malicious prover.** Supplies forged witnesses: challenge reductions, Merkle paths, note openings. Every value is constrained in-circuit. Tests replace honest witnesses with malicious ones.

## Out of scope for Wave 1

- A dishonest or compromised tag authority. It could sign a second tag for one invoice or sign invoices that do not exist. This is mitigated by threshold tags in Wave 3.
- Fabricated invoices. The authority attests existence via KSeF; OnePledge does not judge truth.
- Network-level linkage (RPC/indexer visibility, timing). Use your own node and indexer where it matters.
- Legal and data-protection analysis (planned for Wave 2).

## What each circuit publishes (the `disclose()` ledger)

| Circuit | Published | Why |
|---|---|---|
| `pledge` | tag | Needed to reject a second pledge |
| `pledge` | note commitment (as a Merkle leaf) | The lender of record later proves membership |
| `pledge` | lender-tree root used | The chain must check it is a real (historic) root |
| `pledge` | expiry (a whole UTC day) | Block-time checks take public arguments |
| `pledge` | registry address, tag-authority key, window | Public ledger reads |
| `release` | nullifier | Prevents a second release; unlinkable to the note |
| `release` | notes-tree root used | Same as above |
| `admitLender` | the admitted lender key | Lenders are a public, admitted set |
| `rotateRegistrar` | the next registrar key | Public role |

These are enforced by the allowlist tests in [`privacy.test.ts`](../contract/src/test/privacy.test.ts): any other value in a transcript fails the build.
