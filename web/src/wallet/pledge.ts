// SPDX-License-Identifier: Apache-2.0
// Sends a real pledge to the deployed registry from a connected wallet.
//
// A borrower cannot sign its own attestation, so the tag authority signs a batch offline and they
// ship as /demo-attestations.json. Each is single-use: pledging burns its tag, and the registry
// refuses it forever after. See cli/src/mint-demo-attestations.ts.
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { Registry, type Attestation, type OnePledgePrivateState } from '@onepledge/contract';
import type { Connection } from './connector.ts';
import { buildProviders, deskContract } from './providers.ts';

export type DemoInvoice = {
  readonly ksefNumber: string;
  readonly amountGrosz: string;
  readonly currency: string;
  readonly dueDate: string;
};

export type DemoAttestation = {
  readonly fields: DemoInvoice;
  readonly attestation: Attestation;
};

export type DemoBundle = {
  readonly note: string;
  readonly registryVersion: string;
  readonly contractAddress: string;
  readonly borrowerSecret: Uint8Array;
  readonly lenders: readonly { readonly label: string; readonly key: Uint8Array }[];
  readonly attestations: readonly DemoAttestation[];
};

const bytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

/** The bundle is JSON, so byte strings and bigints arrive as text and have to be rebuilt. */
export const loadBundle = async (): Promise<DemoBundle> => {
  const res = await fetch('/demo-attestations.json', { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`No demo attestations available (${res.status}).`);
  const raw = (await res.json()) as {
    note: string;
    registryVersion: string;
    contractAddress: string;
    borrowerSecret: string;
    lenders: { label: string; key: string }[];
    attestations: {
      fields: DemoInvoice;
      salt: string;
      attestation: {
        tag: string;
        invoiceCommit: string;
        acceptanceDay: number;
        expiresAt: string;
        borrower: string;
        signature: { announcement: { x: string; y: string }; response: string };
      };
    }[];
  };
  return {
    note: raw.note,
    registryVersion: raw.registryVersion,
    contractAddress: raw.contractAddress,
    borrowerSecret: bytes(raw.borrowerSecret),
    lenders: raw.lenders.map((l) => ({ label: l.label, key: bytes(l.key) })),
    attestations: raw.attestations.map((a) => ({
      fields: a.fields,
      attestation: {
        tag: bytes(a.attestation.tag),
        invoiceCommit: bytes(a.attestation.invoiceCommit),
        acceptanceDay: BigInt(a.attestation.acceptanceDay),
        expiresAt: BigInt(a.attestation.expiresAt),
        borrower: bytes(a.attestation.borrower),
        signature: {
          announcement: {
            x: BigInt(a.attestation.signature.announcement.x),
            y: BigInt(a.attestation.signature.announcement.y),
          },
          response: BigInt(a.attestation.signature.response),
        },
      } as Attestation,
    })),
  };
};

export type PledgeResult = {
  readonly txHash: string;
  readonly blockHeight: number;
  readonly note: string;
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Runs the real circuit: the wallet balances and signs, the prover builds the proof, and the
 * registry refuses the tag if it has been pledged before. A fresh note salt each time means two
 * pledges of different invoices are unlinkable on chain.
 */
export const sendPledge = async (
  connection: Connection,
  bundle: DemoBundle,
  chosen: DemoAttestation,
  lenderKey: Uint8Array,
): Promise<PledgeResult> => {
  const providers = await buildProviders(connection);
  const noteSalt = crypto.getRandomValues(new Uint8Array(32));

  const initialPrivateState: OnePledgePrivateState = {
    secretKey: bundle.borrowerSecret,
    attestation: chosen.attestation,
    pledgeLender: lenderKey,
    noteSalt,
  };

  providers.privateStateProvider.setContractAddress(bundle.contractAddress);
  await providers.privateStateProvider.set('borrower', initialPrivateState);

  // Same shape the CLI uses (cli/src/demo.ts): the generated contract type is not expressible here.
  const contract = (await findDeployedContract(providers, {
    contractAddress: bundle.contractAddress,
    compiledContract: deskContract(),
    privateStateId: 'borrower' as const,
    initialPrivateState,
  } as never)) as unknown as {
    callTx: Record<string, (...args: unknown[]) => Promise<{ public: { txHash: string; blockHeight: number } }>>;
  };

  const tx = await contract.callTx.pledge(lenderKey);
  return {
    txHash: tx.public.txHash,
    blockHeight: tx.public.blockHeight,
    note: hex(Registry.pureCircuits.noteCommitment(chosen.attestation.tag, lenderKey, chosen.attestation.invoiceCommit, noteSalt)),
  };
};
