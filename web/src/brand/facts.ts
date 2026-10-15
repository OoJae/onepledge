// SPDX-License-Identifier: Apache-2.0
// Real values shown on marketing surfaces. The KSeF number is synthetic (format-valid, CRC-8 checked).
// DEMO_TAGS are two real keyed tags from an earlier OnePledge deployment on Preprod, used as
// decoration in the artwork: a plausible-looking hex string would do the same job, but a real one
// cannot be mistaken for a stand-in. The live registry's facts are read from the deployment record
// below rather than written here, because prose went stale once already.
import deployment from '../../../deployments/preprod.json';

export const DEMO_KSEF = '5265877635-20260910-0412C0DE5E7A-3F';
export const DEMO_TAGS = ['cdcbbf13534ca1aad382029efc3244fe0344de781c7b7f6319755119da228aa3', 'e75b2cf84441e5c94ceafb78283ddaf74a2db6a4cfb9ab298ec7c17c8aa468ce'];
export const EXPLORER = 'https://preprod.midnightexplorer.com';

export interface ChainEvent {
  label: string;
  circuit: string;
  txHash?: string;
  blockHeight?: number;
  outcome: string;
}

export const registry = {
  version: deployment.version as string,
  address: deployment.contractAddress as string,
  deployTxHash: (deployment as { deployTxHash: string }).deployTxHash,
  deployBlock: deployment.deployBlockHeight as number,
  events: deployment.events as ChainEvent[],
};

export const shortHash = (h: string, head = 8, tail = 6) => `${h.slice(0, head)}…${h.slice(-tail)}`;
