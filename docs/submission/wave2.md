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
- Demo video: {{VIDEO_URL}}
- Registry on Midnight Preprod: the deployment table in the README carries the contract address, every
  transaction and every block, generated from `deployments/preprod.json` rather than typed by hand —
  https://github.com/OoJae/onepledge/tree/wave-2#live-on-midnight-preprod
- Security review (Wave 1 findings, and what Wave 2 did with each):
  https://github.com/OoJae/onepledge/blob/wave-2/docs/security-review.md
- Threat model, including what each of the nine circuits publishes:
  https://github.com/OoJae/onepledge/blob/wave-2/docs/threat-model.md
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

## Stated limitations

*For the "About" field, alongside the Wave 1 text. 3,888 characters. Cap 6,000.*

Nothing here is hidden in a footnote; each item is also in the README and the threat model.

**Demo limitations — true of this deployment, not of the design.**

- All three registrar seats are deployer-held. The 2-of-3 rule is enforced on chain and tested; the keys are
  not in three different pairs of hands. The anonymity set for an approval is three.
- The demo lenders' party secrets are minted into the demo bundle the browser fetches, on purpose, so a
  visitor can act as a lender and watch the inbox decrypt. On a real deployment that would let anyone read
  every delivery addressed to those lenders and decide on their pledges.
- Demo invoices use synthetic KSeF-format numbers. The read-only KSeF 2.0 client that landed this wave has
  never called the live test environment — only its anonymous challenge endpoint could run as written, and
  metadata lookup needs a token this repo cannot sign — so its shapes are checked against hand-authored
  fixtures and its behaviour against a real KSeF is unverified. It is not wired into the attestation flow.
- The CLI demo runs every party from one machine, so its timing and network metadata link parties a real
  deployment would not.

**Design limitations — true of OnePledge as it stands.**

- A single tag authority is trusted to tag each invoice once, attest the right amount, and keep its keys safe.
  A stolen signing key forges attestations and inflates borrowing bases. Wave 3 replaces it with threshold
  tags.
- The authority attests that an invoice exists, not that it is honest. OnePledge stops double financing, not
  fabricated invoices.
- There is no decision deadline. The named lender decides whether a pledge stands, but nothing forces it to,
  so an undecided pledge holds the receivable until the lender acts.
- A borrowing-base draw cannot require that the pooled notes were accepted, or that they were not declined or
  released. All three live in `Set`s, and a `Set` can only be checked on a disclosed value, so proving
  anything about them would publish the decision or release nullifier — tying the draw back to the accepts
  behind it and letting an observer group one lender's book. This is a documented limitation of the privacy
  trade, taken deliberately: a funder relying on a draw relies on the lender not counting receivables it
  refused or has already been paid for.
- The pool is fixed at four. A depth-16 Merkle path plus a note recompute costs about 4.9 MB of prover key per
  receivable, and `proveBorrowingBase` is already 19.5 MB of a 93 MB bundle. Larger books run a draw per round
  over a rolling four. Raising the number is a recompile, not a redesign, but it is paid for in key size and
  proving time.
- A delivery is an opaque byte string the circuit cannot constrain, so a borrower can post garbage. The lender
  then decrypts nothing and declines, which is what the void path is for.
- An accepted tag is permanent. A released pledge does not free the receivable; only a declined one does.
- Lenders cannot be retired: the admitted-lender tree is append-only (1,024 entries; notes 65,536). A duplicate
  admission is refused.
- The registrar tree holds 16 leaves and each committee spends three, so the committee can be rotated four
  times and the fifth rotation fails. Raising the depth is a recompile and a new deployment.
- Every membership proof discloses the historic root it used, and a stale root narrows timing.
- The Midnight maintenance authority, which can replace verifier keys, is now 2-of-3 on chain, but all three
  keys are deployer-held and sit in one file. It is a different thing from the registrar committee, and the
  same caveat applies to both: the mechanism is distributed, the custody is not.
- Wave 2's new circuits were reviewed adversarially, which is how F70 was found and fixed, but not by the
  same 88-finding sweep Wave 1 got and not by anyone outside the project. External review is Wave 3.
- There is still no racing-transaction test, and no test of the CLI's own code paths.

## What's next (Wave 3)

Verifiable threshold tags, so no single party can compute or sign a tag; registrar seats in three different
pairs of hands and a maintenance committee; a decision deadline so an undecided pledge cannot hold a
receivable indefinitely; pledge assignment between lenders, so a release can hand a receivable on; the KSeF
client actually talking to the test environment, with correction mapping; a racing-transaction test; a
reusable uniqueness module for registries with guessable IDs; and an external review covering Wave 2's
circuits.
