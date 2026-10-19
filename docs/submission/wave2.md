# AKINDO Wave 2 submission: OnePledge

Paste-ready text for the AKINDO submission form. The rules require entries to be submitted personally.

Field limits: **"Updates in this Wave" caps at 3,000 characters** and **"About" caps at 6,000**. Each section
below states its own character count, measured on the text between its heading and the next one. Keep them
under the cap when editing.

## Product name

OnePledge

## Tagline

One pledge per invoice, without any lender seeing another's book.

## Tags

Privacy · DeFi · Market Infrastructure

## Links

- Live demo: https://onepledge.vercel.app
- GitHub (Wave 2 tag): https://github.com/OoJae/onepledge/tree/wave-2
- Demo video: https://youtu.be/lszexMPlro8
- Registry on Midnight Preprod: the deployment table in the README carries the contract address, every
  transaction and every block, generated from `deployments/preprod.json` rather than typed by hand —
  https://github.com/OoJae/onepledge/tree/wave-2#live-on-midnight-preprod
- Security review (Wave 1 findings, and what Wave 2 did with each):
  https://github.com/OoJae/onepledge/blob/wave-2/docs/security-review.md
- Threat model, including what each of the nine circuits publishes:
  https://github.com/OoJae/onepledge/blob/wave-2/docs/threat-model.md
- Deck (Wave 2): https://docs.google.com/presentation/d/1FbKQK26LOPgw-pJhXB-GmiPsDdYkv5y2EcJH9M73Oak/edit?usp=sharing
- Deck (Wave 2, .pptx): https://github.com/OoJae/onepledge/blob/wave-2/docs/OnePledge-Wave2-deck.pptx
- Deck (Wave 1): https://github.com/OoJae/onepledge/blob/wave-2/docs/OnePledge-Wave1-deck.pdf

## Updates in this Wave

*2,972 characters. Cap 3,000.*

Wave 1 shipped the registry: one pledge per receivable, proven in zero knowledge, with no lender seeing
another's book. Wave 2 shipped the three things a real lender asks about next — and then found and fixed a
bug in one of them.

**A lender can now prove its own book.** A factor that finances receivables is itself financed, and showing
its funder the book behind a drawdown means handing over the client list, the invoices and the amounts.
`proveBorrowingBase(round, floor)` proves instead that four receivables pledged to this lender are together
worth at least a public floor. Published: the round, the floor, and a draw id unlinkable to the lender. Not
published: any amount, which receivables, whose book. Only the lender of record for all four can prove it —
the circuit recomputes each note commitment from the prover's own secret. This is also the answer to
"doesn't this need every lender to join first?". It does not: the registry is useful to the first two
lenders on it, and a borrowing-base proof is useful to a lender with no counterparties at all.

**We shipped that circuit with a hole in it, found it ourselves, and fixed it on the live contract.** It
compared the four pool items' note commitments rather than their tags. Declining frees a tag but leaves the
note, and the decliner keeps its opening — so one invoice pledged, declined and pledged again to the same
lender became two notes for one receivable. A test proved **20,300,000 grosz against a book worth
16,200,000**. Only that circuit changed, so only its verifier key did, and the contract maintenance
authority replaced it in place rather than abandoning the address. Then the attack was re-run against the
live registry: refused, before a proof is even built. Published in full as F70.

**The registrar is now a 2-of-3 committee**, and so is the upgrade authority. Two approvals admit a lender;
a member cannot approve twice; an outsider cannot approve. Approvals are unlinkable to a member, because
membership is a Merkle path into an epoch-bound tree — the obvious alternative, a `Set` the circuit calls
`member()` on, can only be checked on a disclosed value, so it would publish a log of which registrar
vouches for which lender. Every seat on both committees is deployer-held here: this distributes the
mechanism, not the custody.

**The note opening now reaches the lender encrypted, on chain**, filed under the note commitment and found
by trial decryption, with nothing saying who a delivery is for.

Nine circuits. 272 tests, including an allowlist over every value in each circuit's public transcript. CI
runs the unit and browser suites, a real `pledge` proof, and a devnet deploy-and-run. `verify:onchain`
passes 24 checks against the live registry.

Not delivered: upgrade keys in three pairs of hands; a KSeF adapter that has actually called KSeF; a
racing-transaction test; interviews with factors. Limitations in full below.

This project is built on the Midnight Network.

## About (replaces the field wholesale — do not append)

*The Wave 1 About was 5,939 of 6,000 characters, so nothing could be added to it, and most of it
had gone stale: four circuits, 176 tests, registry v2, and Wave 2's work still written as future.
This replaces it, in the same six headings AKINDO uses. 5,914 characters; 5,967 if the form stores
CRLF line endings. Cap 6,000.*

## The problem it solves

Invoice financing assumes a supplier pledged each invoice once. The same invoice pledged to three lenders means three payouts against one receivable — one of the oldest frauds in trade finance. Lenders could catch it by pooling their books, but none will show a rival its clients or exposure. So they don't pool, and the fraud keeps working.

The obvious blockchain fix — publish `hash(invoice number, supplier, amount, due date)` and reject repeats — fails twice, and [both failures are playable](https://onepledge.vercel.app/attacks):

- **Spelling.** "FV 1/2026" and "FV1/2026" are the same invoice and different hashes, so the duplicate sails through.
- **Lookup.** Anyone holding an invoice can hash it and learn whether a rival financed it, and when — a competitive-intelligence feed.

OnePledge closes both. Poland's KSeF gives every invoice one canonical number; a tag authority turns it into a keyed tag (HMAC under its secret), so the set cannot be searched by guessing. The borrower proves in zero knowledge that a valid, unexpired attestation exists and its tag has never been pledged.

A rival handed the tag learns one fact: already pledged. **This is why it works with two lenders — no consortium has to form first.**

## Challenges I ran into

**We shipped a soundness bug and fixed it on the live contract.** `proveBorrowingBase` compared the four pool items' note commitments rather than their tags. Declining frees a tag but leaves the note, and the decliner keeps its opening — so one invoice pledged, declined and pledged again to the same lender became two notes for one receivable. A test proved **20,300,000 grosz against a book worth 16,200,000**. Our own adversarial review found it. Only that circuit changed, so only its verifier key did, and the maintenance authority replaced it in place rather than abandoning the address. The attack was then re-run against the live registry and refused. Published in full as F70.

**Anonymous approvals force a Merkle path, not a Set.** A 2-of-3 registrar is easy; making an approval unlinkable to a member is not. Every ledger key a Compact circuit touches must be disclosed, so `Set.member()` would publish which registrar vouches for which lender. Membership is a Merkle path into an epoch-bound tree, so a rotation retires the old committee from an append-only tree.

**midnight-js can only sign 1-of-1.** It hardcodes one signature at index 0, so once a 2-of-3 authority is installed it can no longer authorise anything. The multi-signature assembler had to ship in the same change, or the upgrade path would have been bricked.

**Reading the Ministry's own KSeF spec, we found one invoice has two legal spellings** — the same characters with or without an inner dash, kept for KSeF 1.0 compatibility; their OpenAPI contract and their own SDK disagree. We had been rejecting the second outright. Both now resolve to one tag — exactly the gap this project exists to close.

## Technologies I used

- **Midnight** — Compact 0.31.1 (the version Preprod runs), midnight-js, proof server, Blockfrost indexer.
- **TypeScript** throughout: witnesses, attester, CLI, web app.
- **ZK design** — in-circuit Jubjub Schnorr, HMAC keyed tags, domain-separated role keys, a `Set` for tags, `HistoricMerkleTree` for notes and registrars.
- **Web** — React, Vite, compiled circuits in-browser over WebAssembly, a strict CSP.
- **Testing** — 272 tests, a privacy allowlist over every published value, and CI that runs the browser suite, a real proof, and a devnet deploy-and-run.

## How we built it

Nine circuits: `approveAdmit`, `executeAdmit`, `approveRotate`, `executeRotate`, `pledge`, `release`, `acceptPledge`, `declinePledge`, `proveBorrowingBase`.

Wave 2 answered the three things Wave 1 got wrong. **The lender decides** — accept, or decline and free the receivable to be financed elsewhere, which the registry allows. **Two of three registrars must agree** to admit a lender, and the chain records that two agreed, not which two. **The invoice stopped travelling by email**: the opening is encrypted to the lender and found by trial decryption, with nothing on the ledger saying who a delivery is for.

And a lender can prove its own book: `proveBorrowingBase` proves four receivables pledged to it are together worth at least a public floor. The chain learns the floor. Not one amount, not which invoices, not whose book.

Live on Preprod: registry v4 `ce3030dd…0c8e71` at block 2,992,668, where `verify:onchain` passes 24 checks, including that each verifier key equals the committed file.

## What we learned

- **Attack your own build, and publish what you find.** F70 was ours, found by us, fixed on the live contract and written up in full. It is the strongest evidence here.
- **Privacy constrains the data structure, not just the circuit.** "Prove membership without naming the member" rules out a Set.
- **An honest limit is worth more than a claim.** Every seat on both committees is deployer-held, and we say so.

## What's next for OnePledge

**Wave 3:** threshold tags, so no single party can compute or sign one; registrar and upgrade seats in genuinely different hands; a decision deadline; the KSeF client actually talking to the test environment; and external review of Wave 2's circuits.

**Today's limits, plainly.** One trusted tag authority — a stolen key forges attestations. All six committee seats, registrar and upgrade, are deployer-held: the mechanism is distributed, the custody is not. A draw cannot require that pooled notes were accepted or unreleased, because both live in `Set`s and proving it would publish the decision nullifier. The pool is fixed at four. There is no decision deadline. Demo invoices use synthetic KSeF numbers, and the KSeF client has never called the live test environment. Review of this wave's circuits was internal.

This project is built on the Midnight Network.
