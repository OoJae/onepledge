// SPDX-License-Identifier: Apache-2.0
// The four beats of the pledge scene: shared by the static figures, the 3D choreography and the poster renders.
import type { Beat } from './SealArt.tsx';

export interface BeatDef {
  beat: Beat;
  /** Scroll progress where the beat becomes active in the 3D scene. */
  from: number;
  lead: string;
  accent: string;
  tail: string;
  body: string;
}

export const BEATS: BeatDef[] = [
  {
    beat: 0,
    from: 0,
    lead: 'One invoice.',
    accent: 'One KSeF number.',
    tail: '',
    body: "The invoice carries the one number Poland's e-invoicing system assigned it. The tag authority turns that number into a keyed tag.",
  },
  {
    beat: 1,
    from: 0.14,
    lead: 'Pledged once,',
    accent: 'to Lender A.',
    tail: '',
    body: 'The borrower proves the pledge in zero knowledge, and Midnight records it. The invoice and the lender stay private.',
  },
  {
    beat: 2,
    from: 0.42,
    lead: 'The same invoice at Lender B is',
    accent: 'refused.',
    tail: '',
    body: "The borrower's circuit fails before any proof is made: the tag is already in the public set.",
  },
  {
    beat: 3,
    from: 0.72,
    lead: 'The ledger keeps only',
    accent: 'an opaque tag.',
    tail: '',
    body: 'No invoice, amount or lender appears on chain, and no lender sees another’s book.',
  },
];
