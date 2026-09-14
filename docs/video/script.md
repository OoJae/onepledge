# OnePledge · Wave 1 demo video

Target length: 2:00. About 290 spoken words at a calm pace. Record each beat as a separate take; pauses between beats are cut in editing.

| # | Time | On screen | Narration |
|---|---|---|---|
| 1 | 0:00–0:12 | Black title card: "One invoice. Two lenders. Both paid out." | One invoice. Pledged to two lenders. Both pay out, and one of them is left holding nothing. It's one of the oldest frauds in trade finance. |
| 2 | 0:12–0:32 | Web app, "Why not a hash registry": Attack 1, then Attack 2 | Lenders could catch it by comparing books, but no lender will show a rival its clients. And the obvious blockchain fix, publishing a hash of each invoice, fails twice: write the invoice number differently and it's a new hash. And anyone holding an invoice can look up whether and when it was financed. |
| 3 | 0:32–0:58 | "The story" page: invoice card, then step 1 "Pledge to Lender A" | OnePledge is a registry on Midnight. In Poland, every B2B invoice gets one official number from the national e-invoicing system, KSeF. A tag authority turns that number into a keyed tag and signs it. The borrower proves, in zero knowledge, that the signature is valid, the lender is admitted, and the tag is new. |
| 4 | 0:58–1:18 | Step 2 "Try it again at Lender B": rejected row; pan across the three columns | Try the same invoice at a second lender, and the proof can't be built. Lender A sees the invoice. Lender B learns one fact: it's already pledged. Everyone else sees an opaque tag. |
| 5 | 1:18–1:38 | Terminal running `npm run demo` on Preprod, then the Live registry page and an explorer link | This isn't a mock-up. Here it runs on Midnight Preprod: real proofs, real transactions, and a double pledge rejected before it ever reaches the chain. The live page reads the contract straight from the public indexer, no wallet needed. |
| 6 | 1:38–1:52 | Test output scrolling, then the GitHub Actions green check | Ninety-five tests, including malicious provers, forged signatures and privacy-leak checks that search every public byte for private data. |
| 7 | 1:52–2:00 | Closing card: OnePledge logo, tagline, github.com/OoJae/onepledge | Today a single tag authority is trusted; Wave 3 makes it a threshold committee. OnePledge: one pledge per invoice, without any lender seeing another's book. |

## Recording tips

- Record in a quiet room, phone or laptop mic 20–30 cm away, one take per row.
- Save each take as `beat-1.m4a` … `beat-7.m4a` in `docs/video/voice/` (git-ignored); the edit aligns footage to your timing.
- If a line runs long, keep your natural pace; the edit stretches the footage, not your voice.
