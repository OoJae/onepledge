# Threat model (registry v4, Wave 2)

## What we protect

| Asset | Property |
|---|---|
| "One pledge per receivable" | No invoice is pledged twice in a registry, whoever colludes, as long as the tag authority is honest and the 1-of-1 maintenance key does not replace verifier keys. |
| A lender's book | Which invoices a lender financed, for whom, and on what terms. |
| How large a lender's book is | A borrowing-base draw publishes a floor the lender chose to claim, and nothing else about the money. |
| Invoice contents | Amount, debtor, due date. The amount is now attested and bound into the note commitment, and still never published. |
| Borrower identity | Which company pledged. |
| Who vouched for a lender | An admission needs two of three registrars, and no approval says which two. |

## Parties and what they are trusted with

| Party | Holds | Trusted for | Not trusted for |
|---|---|---|---|
| Tag authority | Jubjub signing key, HMAC tag secret | Computing one tag per KSeF invoice, signing only real invoices, and attesting the right amount | Anything else: it never sees lenders or terms |
| Registrar committee | Three registrar secrets, 2-of-3 | Admitting real lenders and rotating itself | Pledges, tags, decisions or draws |
| Borrower | Borrower secret, attestations, note salts | Nothing | Everything is checked in-circuit |
| Lender | Lender secret, invoice openings it receives | Nothing | — |
| Deployer | Contract maintenance key (1-of-1, disclosed) **and all three registrar seats in this demo** | Not replacing verifier keys | Nothing else |
| Proof server | Witnesses while proving | Run locally by each party | A remote proof server would see private inputs |

The 2-of-3 registrar committee is enforced on chain, but in this demo the deployer holds all three seats
(`deployments/preprod.json` records them and says so). The demo distributes the mechanism, not the custody.
The Midnight *maintenance authority* — the key that can insert or remove verifier keys — is a separate thing
and is still 1-of-1; the registrar committee has no power over it.

## Adversaries considered

1. **Double-pledging borrower.** Tries to finance one invoice with several lenders by reusing, modifying or re-requesting attestations. Stopped by:
   - the in-circuit signature over a digest of the whole attestation
   - the tag set, which nothing but a `declinePledge` ever removes from
   - binding to the registry address
   - canonical KSeF numbers, one spelling each

   Tests: `registry.test.ts`, `security.test.ts`.
2. **Thief of an attestation.** Tries to pledge someone else's attestation. Stopped by the borrower-key binding checked in-circuit.
3. **Outside observer.** Reads the chain and indexer. Sees tags, note commitments, delivery ciphertexts, nullifiers, roots, expiry days, committee action hashes, draw ids, floors, counters and timing. Cannot compute a tag from an invoice number without the HMAC secret, and cannot tell which lender any note, decision, release or draw belongs to.
4. **Rival lender shown an invoice.** Learns "already pledged" if a borrower hands it the tag. Once it holds a tag it can keep watching that tag's status; it never learns who financed it or on what terms.
5. **Curious tag authority.** It computes tags itself, so it can tell whether and when an invoice it attested was pledged, and it saw the borrower key, invoice commitment and amount it signed. It does not learn the lender or the terms.
6. **Malicious prover.** Supplies forged witnesses: challenge reductions, Merkle paths, note openings, committee paths, pool openings. Every value is constrained in-circuit. Tests replace honest witnesses with malicious ones — including a lender that supplies another lender's real note paths, which fails because the note commitment binds the lender key the circuit derived from the prover's own secret.
7. **A lender's own funder.** Wants evidence that a drawdown is covered. It gets `proveBorrowingBase`: four receivables pledged to this lender, each on this ledger, together worth at least a public floor. It does not get the client list, the invoices or the amounts. What it must accept is weaker than a full book review — see the limitations below.
8. **An observer trying to group one lender's activity.** Decision, release and approval nullifiers are domain-separated hashes of a secret, so none links to a note, a lender or each other. Draw ids are keyed on the round, so two rounds give unlinkable ids. Deliveries are keyed by the note commitment with no recipient hint, so the `deliveries` map cannot be grouped by lender. `privacy.test.ts` asserts each of these against an allowlist.
9. **Someone fishing KSeF for invoice numbers to try.** This fails at KSeF before it reaches OnePledge, which is worth stating because it is the other half of the keyed-tag defence. In the Ministry of Finance's API, authentication always happens in the context of one subject ("Kontekst logowania – określa podmiot, w imieniu którego wykonywane będą operacje w systemie"), and reading invoices needs `InvoiceRead` in that context, which lets a party "pobierać listy faktur w ramach danego kontekstu". The anonymous QR route runs the other way round: the KOD I link carries the issue date, the seller's NIP and a SHA-256 hash of the invoice file — so a verifier has to hold the invoice already — and the KSeF number is not part of it. There is no published endpoint that turns a KSeF number into an invoice for a party with no permission on either side of it. Source: [CIRFMF/ksef-docs](https://github.com/CIRFMF/ksef-docs) (`uprawnienia.md`, `uwierzytelnianie.md`, `kody-qr.md`, `pobieranie-faktur/`).

## Out of scope for Wave 2

- An undecided pledge. A lender that never accepts or declines leaves the receivable encumbered; there is no deadline yet, so a borrower still depends on the lender acting.
- **What a borrowing-base draw does not prove.** It proves four notes exist on the ledger, are distinct, are pledged to the prover, and sum to at least the floor. It does **not** prove they were accepted, or that they were not declined, or that they have not been released. All three live in `Set`s, and a `Set` can only be checked on a disclosed value: proving anything about them would mean publishing the decision or release nullifier, which ties the draw back to the decisions behind it and lets an observer group one lender's book. That is the trade this design makes on purpose, and a funder relying on a draw should know it is relying on the lender not counting receivables it has refused or already been paid for.
- **A borrower posting garbage as a delivery.** The ciphertext is `Opaque<"Uint8Array">`, which a circuit cannot constrain, so nothing stops a borrower storing nonsense under a note. The lender then decrypts nothing, declines, and the receivable is freed. No new mechanism was added for this because the void path already handles it.
- **The published demo lender secrets.** The demo bundle the desk fetches is minted with the demo borrower's and demo lenders' party secrets in it (`cli/src/mint-demo-attestations.ts` → `web/public/demo-attestations.json`), on purpose, so that a visitor's browser can act as a lender and watch the inbox decrypt. On a real deployment publishing a lender secret would let anyone accept, decline or release that lender's pledges and read every delivery addressed to it. It is a testnet toy, not a key-management proposal.
- A dishonest or compromised tag authority. It could sign a second tag for one invoice, sign invoices that do not exist, or attest a wrong amount — and a borrowing-base proof is only as honest as the amounts it sums. Mitigated by threshold tags in Wave 3.
- Fabricated invoices. The authority attests existence via KSeF; OnePledge does not judge truth.
- Network-level linkage (RPC/indexer visibility, timing). Use your own node and indexer where it matters.
- Legal and data-protection analysis.

## What each circuit publishes (the `disclose()` ledger)

Every row below is what the circuit's public transcript actually contains, checked against an allowlist in
[`privacy.test.ts`](../contract/src/test/privacy.test.ts): any value longer than a 2-byte constant that is not
on the list fails the tests. Where a value is conspicuously *absent*, that absence is asserted too.

| Circuit | Published | Why |
|---|---|---|
| constructor | the three registrar key commitments (public arguments), stored as epoch-0 `committeeLeaf` leaves; the tag authority point; the acceptance window | Sealed public parameters of the deployment. The tree holds epoch-bound leaves, never a bare registrar key, which is what lets a rotation retire a member from an append-only tree. |
| `approveAdmit` | the action hash; the committee root proven against; one approval nullifier; the lender key | The lender key is read as a map key by the already-admitted guard, so it is public here. The approver is not: membership is a Merkle path, so no registrar key, leaf or secret appears. The lender's encryption key is bound into the action hash but is **not** disclosed by this circuit. |
| `executeAdmit` | the action hash; the lender key; the lender's encryption key; the lender's Merkle leaf | Lenders are a public, admitted set, and a borrower needs the encryption key to address a delivery. Execution takes no witness at all, so it publishes neither the committee root nor any approval nullifier. |
| `approveRotate` | the action hash; the committee root; one approval nullifier | Quieter than an admission: the proposed members are bound into the action hash and travel with the proposal off chain until execution, so a pending rotation does not announce its candidates. |
| `executeRotate` | the action hash; the three proposed registrar keys; the three new epoch-bound leaves | The new committee has to be public to be provable against. Who approved it still is not. |
| `pledge` | the tag | Needed to reject a second pledge |
| `pledge` | the note commitment, both as a Merkle leaf and raw as the `deliveries` map key | The lender of record later proves membership; the delivery is filed under the commitment so the lender can find its own. The commitment is hiding over tag, lender, invoice commitment, amount and salt, so the map key adds no fact the leaf had not already committed to. |
| `pledge` | the encrypted delivery | A ciphertext with no recipient hint. Public, and unreadable without the lender's encryption secret. This row is read off `deliveries.insert(note, disclose(delivery))` in the contract, not off the allowlist test: that test pledges with an empty payload, so it is the one row here no test covers. |
| `pledge` | the lender-tree root used | The chain must check it is a real (historic) root |
| `pledge` | the expiry (a whole UTC day) | Block-time checks take public arguments |
| `pledge` | registry address, tag-authority key, window | Public ledger reads |
| `pledge` | *not* the amount, the acceptance day, the invoice commitment, the salt, the borrower or the lender | The amount is signed and bound into the note; `privacy.test.ts` searches the transcript for it in both byte orders, with a positive control proving the search is not vacuous. |
| `release` | the release nullifier; the notes-tree root used | Prevents a second release; unlinkable to the note, the tag and the lender |
| `acceptPledge` | the decision nullifier; the notes-tree root used | Records that the lender of record decided, without saying which receivable or which lender. The tag is deliberately kept out, so accepting never says what was accepted. |
| `declinePledge` | the decision nullifier; the notes-tree root used; the tag | The receivable has to become visibly free again. The tag was already published by `pledge`, so this adds no new fact about the invoice; it only says this pledge was refused. |
| `proveBorrowingBase` | the notes-tree root each of the four membership proofs used; the draw id; the round; the floor | The floor is the whole claim, so it is public. The draw id is keyed on (round, lender secret): unlinkable to the lender, and the same in one round, which is how a lender is held to one draw per round. No amount, no total, no tag, no note commitment and no lender key appears — the test checks all four pool items for each. |
