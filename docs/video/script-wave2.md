# OnePledge · Wave 2 demo video

Target length: about 2:00. Sixteen short lines, roughly 310 spoken words at a calm pace.
Record each line as its own take; the edit adds the pauses. Same voice and pace as Wave 1.

This is a *what changed* video, not a re-explanation. Lines 1–3 are the only recap, and line 3 is
there because the rest of the video is the answer to it.

Two rules the footage has to obey, because the project's whole claim rests on them:

- **Never show a KSeF invoice number in the same frame as a transaction hash.** That is the link the
  registry exists to prevent, and a judge who notices it is right to.
- **Name no other project.** The consortium objection is answered on its merits in line 8.

| # | On screen | Narration |
|---|---|---|
| 1 | Landing page, the seal pressing into wax | OnePledge is a registry on Midnight that refuses to let the same invoice be financed twice, without any lender seeing another's book. |
| 2 | Wave 1 security review, the limitations table | In Wave One we shipped it, and published what was still wrong with it. |
| 3 | Three rows highlighted in turn | Three things. The lender never agreed to the pledge. One key admitted every lender. And the invoice itself still travelled by email. |
| 4 | Walkthrough, step three, two buttons | Now the lender decides. |
| 5 | Decline pressed; the tag set empties | Refuse, and the receivable is released. The public set stops claiming it is encumbered. |
| 6 | The freed invoice pledged to Lender B | The borrower takes it elsewhere, and the registry accepts the same invoice it refused a moment earlier. |
| 7 | Lender B card: "never learns who refused" | Lender B finances it, and never learns who turned it down, or why. |
| 8 | Two-lender slide | This is why it works with two lenders. No consortium has to form first, because the only thing either one learns is a single fact about a single invoice: already pledged. |
| 9 | Inbox page: deliveries scanned, four opened | The invoice no longer travels by email. The borrower encrypts it to the lender, and the lender finds its own by trying to open every delivery. Nothing on the ledger says who any of them is for. |
| 10 | Committee act: seat one approves, admit refused | One registrar used to admit every lender. Now two of three must agree, and one approval alone is refused. |
| 11 | The ledger panel: two approvals, no name | What the chain records is that two of three agreed. Not which two. A membership proof, not a signature list — because a registry that logs who vouches for whom is the thing we are trying not to build. |
| 12 | Borrowing-base act: four receivables, one floor | A factor that finances receivables is financed in turn, and its bank wants to see the book. That means handing over the client list. |
| 13 | Draw succeeds; then a higher floor is refused | So it proves instead: four receivables pledged to me, together worth at least this much. The chain learns the floor. Not one amount, not which invoices, not whose book. Claim more than you hold and the proof will not build. |
| 14 | Desk page, wallet connected, preflight green | All of it runs from a real Midnight wallet, against a contract on Preprod: nine circuits, every verifier key checked against this repository. |
| 15 | Test output; the KSeF specification diff | Over two hundred tests, including a privacy allowlist on every value each circuit publishes. And reading the Ministry's own specification this wave, we found that one invoice has two legal spellings — exactly the gap this project exists to close. Both now resolve to one tag. |
| 16 | Closing card: hosted URL, repository, contract address | Still one tag authority. Still three committee keys in one pair of hands, and we say so. OnePledge. One pledge per invoice — and now the lender has a say, and a reason of its own to be here. |

## Notes for the edit

- Line 3's three rows and lines 4–13 are a promise-and-payoff pair: 3 states the three failings, and
  4–9 answer the first, 10–11 the second, 9 the third. Keep that order.
- Lines 12–13 are the one place the video earns the "Product" score: it is the only part that gives a
  lender a reason to join for its own sake rather than for the registry's.
- Line 16 states the remaining trust assumptions out loud. Do not cut it for time. Cut line 7 first,
  then line 6.
- Every number spoken must be checkable from the repository on the day of the cut. If the test count
  or the circuit count has moved, change the narration, not the footage.
