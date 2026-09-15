// SPDX-License-Identifier: Apache-2.0
// Real values shown on marketing surfaces. The KSeF number is synthetic (format-valid, CRC-8 checked);
// the tags and transactions are registry v2 on Midnight Preprod.
import deployment from '../../../deployments/preprod.json';

export const DEMO_KSEF = '5265877635-20260910-0412C0DE5E7A-3F';
export const V2_TAGS = ['cdcbbf13534ca1aad382029efc3244fe0344de781c7b7f6319755119da228aa3', 'e75b2cf84441e5c94ceafb78283ddaf74a2db6a4cfb9ab298ec7c17c8aa468ce'];
export const EXPLORER = 'https://preprod.midnightexplorer.com';

export interface ChainEvent {
  label: string;
  circuit: string;
  txHash?: string;
  blockHeight?: number;
  outcome: string;
}

export const registry = {
  address: deployment.contractAddress as string,
  deployTxHash: (deployment as { deployTxHash: string }).deployTxHash,
  deployBlock: deployment.deployBlockHeight as number,
  events: deployment.events as ChainEvent[],
};

export const shortHash = (h: string, head = 8, tail = 6) => `${h.slice(0, head)}…${h.slice(-tail)}`;
