# OnePledge · Wave 1 demo video

Target length: about 2:00. 14 short lines, about 300 spoken words at a calm pace. Record each line as its own take; the edit adds the pauses between lines.

| # | On screen | Narration |
|---|---|---|
| 1 | Title: "One invoice. Two lenders. Both paid out." | One invoice. Pledged to two lenders. Both pay out, and one of them is left holding nothing. It's one of the oldest frauds in trade finance. |
| 2 | Two lenders' books, walled off | Lenders could catch it by comparing books, but no lender will show a rival its clients. |
| 3 | Web app, Attack 1: two spellings accepted | And the obvious blockchain fix, publishing a hash of each invoice, fails twice: write the invoice number differently and it's a new hash. |
| 4 | Web app, Attack 2: lookups succeed | And anyone holding an invoice can look up whether and when it was financed. |
| 5 | OnePledge on Midnight | OnePledge is a registry on Midnight. |
| 6 | KSeF number → keyed tag → signed attestation | In Poland, each invoice issued through the national e-invoicing system, KSeF, gets one official number. A tag authority turns that number into a keyed tag, and signs it for this registry. |
| 7 | Web walkthrough: what the proof checks | The borrower proves, in zero knowledge, that the signature is valid, the lender is admitted, and the tag is new. |
| 8 | Web walkthrough: second pledge rejected | Try the same invoice at a second lender, and the proof can't be built. |
| 9 | Web walkthrough: three columns | Lender A sees the invoice. Lender B learns one fact: it's already pledged. Everyone else sees an opaque tag. |
| 10 | Preprod run log with transaction hashes, explorer | This isn't a mock-up. Here it runs on Midnight Preprod: real proofs, real transactions, and a double pledge refused before it ever reaches the chain. |
| 11 | Live page on the hosted site | The live page reads the contract straight from the public indexer, no wallet needed. |
| 12 | Test output, security review | A hundred and seventy-six tests: malicious provers, forged signatures, and privacy checks on every value a circuit publishes. Our own security review found a critical bug in version one. Version two fixes it, and a test now flips every byte. |
| 13 | Trust model | Today a single tag authority is trusted; Wave 3 makes it a threshold committee. |
| 14 | Closing card: hosted URL, repository, contract | OnePledge: one pledge per invoice, without any lender seeing another's book. |

## Recording tips

- Record in a quiet room, phone or laptop mic 20–30 cm away, one take per line.
- Save the takes as `line-01.m4a` … `line-14.m4a` in `docs/video/voice/` (git-ignored). Any common audio format works.
- Leave about half a second of silence before and after each line; the edit trims it.
- Say "KSeF" as "K-sef" and "Preprod" as "pre-prod". Keep your natural pace; the footage is timed to your voice.
