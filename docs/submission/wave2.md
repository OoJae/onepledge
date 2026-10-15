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

*2,830 characters. Cap 3,000.*

Wave 1 shipped the registry: one pledge per receivable, proven in zero knowledge, with no lender seeing
another's book. Wave 2 shipped the three things a real lender asks about next.

**A lender can now prove its own book.** A factor that finances receivables is itself financed, and showing
its funder the book behind a drawdown means handing over the client list, the invoices and the amounts.
`proveBorrowingBase(round, floor)` proves instead that four receivables pledged to this lender are together
worth at least a public floor. Published: the floor and an unlinkable draw id. Not published: any amount,
which receivables, which lender. Authorisation is structural — the circuit recomputes each note commitment
from the prover's own secret, so only the lender of record for all four can prove it. This is also the answer
to "doesn't this need every lender to join first?". It does not: the registry is useful to the first two
lenders on it, and a borrowing-base proof is useful to a lender with no counterparties at all.

**The registrar is now a 2-of-3 committee.** `rotateRegistrar` is gone. Two approvals admit a lender, a member
cannot approve twice, an outsider cannot approve, and a rotation needs two approvals and voids every pending
proposal. Approvals are unlinkable to a member, because membership is a Merkle path into an epoch-bound tree:
the obvious alternative, a `Set` the circuit calls `member()` on, can only be checked on a disclosed value, so
it would publish the approver's key on every admission — a public log of which registrar vouches for which
lender. All three seats are deployer-held in this demo: it distributes the mechanism, not the custody.

**The note opening now reaches the lender encrypted, on chain**, filed under the note commitment and found
by trial decryption, with nothing saying who a delivery is for. The amount is attested by the tag authority
and bound into the note commitment, and still never published — a borrowing-base proof is only as honest as
the amounts it sums.

Nine circuits with proving keys. 272 tests (189 contract, 83 attester), including an allowlist over every
value in each circuit's public transcript. CI runs three jobs: the unit and browser suites, a real `pledge`
proof against a proof server, and a local-devnet deploy-and-run of the whole scenario. A wallet-connected
desk submits a real pledge from the browser.

Promised for Wave 2 and not delivered: the 2-of-3 **upgrade** committee (the registrar committee landed; the
Midnight maintenance key is still 1-of-1); a KSeF adapter that has actually called KSeF (a read-only client
exists but has only ever run against fixtures, so demo invoices stay synthetic); a racing-transaction test;
and interviews with factors. Limitations are listed in full below.

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
- The Midnight maintenance key, which can replace verifier keys, is still 1-of-1 and deployer-held. It is a
  different thing from the registrar committee.
- Wave 2's new circuits have not had an adversarial review of their own. The published review is Wave 1's; it
  records which of its findings Wave 2 closed and which it did not. External review is planned for Wave 3.
- There is still no racing-transaction test, and no test of the CLI's own code paths.

## What's next (Wave 3)

Verifiable threshold tags, so no single party can compute or sign a tag; registrar seats in three different
pairs of hands and a maintenance committee; a decision deadline so an undecided pledge cannot hold a
receivable indefinitely; pledge assignment between lenders, so a release can hand a receivable on; the KSeF
client actually talking to the test environment, with correction mapping; a racing-transaction test; a
reusable uniqueness module for registries with guessable IDs; and an external review covering Wave 2's
circuits.
