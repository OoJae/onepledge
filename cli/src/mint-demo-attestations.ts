// SPDX-License-Identifier: Apache-2.0
// Pre-signs a batch of demo attestations for the deployed registry and writes them where the web
// desk can fetch them.
//
// A borrower cannot sign its own attestation — that is the whole point of a tag authority — so a
// browser pledge needs one from the authority. Rather than put the authority's signing key behind a
// server endpoint, the authority signs a handful offline, exactly as it would hand them to a borrower
// in the real flow, and they ship as a static file. Each is single-use: once its tag is pledged, the
// registry refuses it forever.
//
// Everything here is synthetic and testnet-only. The demo borrower's secret is published alongside
// them on purpose, so anyone opening the site can pledge as that borrower.
//
//   node --import tsx src/mint-demo-attestations.ts [count]
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  type InvoiceFields,
  addressBytes,
  attest,
  invoiceCommitment,
  newSalt,
  parseKsefNumber,
  receivableTag,
  syntheticKsefNumber,
} from '@onepledge/attester';
import { Registry } from '@onepledge/contract';
import { repoRoot, selectNetwork } from './config.js';
import { loadParties, loadTagAuthority } from './providers.js';

const COUNT = Number(process.argv[2] ?? 6);
const OUT = path.join(repoRoot, 'web', 'public', 'demo-attestations.json');

const record = JSON.parse(fs.readFileSync(path.join(repoRoot, 'deployments', 'preprod.json'), 'utf8')) as {
  version: string;
  contractAddress: string;
};
const network = selectNetwork('preprod');
const authority = loadTagAuthority(network);
const parties = loadParties(network);

// Fixed, published, testnet-only. Pledges from the desk are made as this borrower.
const demoBorrower = Buffer.from('6f6e65706c656467652d64656d6f2d626f72726f7765722d76332d2d2d2d2d2d', 'hex');
const borrowerKey = Registry.pureCircuits.borrowerKey(demoBorrower);

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const mint = (index: number) => {
  // Acceptance days must fall inside the registry's window; these sit in September 2026.
  const day = String(10 + (index % 18)).padStart(2, '0');
  const ksefNumber = syntheticKsefNumber('5265877635', `2026-09-${day}`, `D${index.toString(16).toUpperCase().padStart(2, '0')}${randomBytes(4).toString('hex').toUpperCase()}`);
  const parsed = parseKsefNumber(ksefNumber);
  const amountGrosz = String(5_000_000 + index * 1_750_000);
  const fields: InvoiceFields = {
    ksefNumber: parsed.canonical,
    sellerNip: parsed.sellerNip,
    debtorNip: '7010002139',
    amountGrosz,
    currency: 'PLN',
    dueDate: '2026-11-30',
  };
  const salt = newSalt();
  const attestation = attest(authority.sk, {
    registry: addressBytes(record.contractAddress),
    // Long-lived so the published demo keeps working; the registry's own window still bounds it.
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 180 * 86_400),
    tag: receivableTag(authority.tagSecret, parsed.canonical),
    invoiceCommit: invoiceCommitment(fields, salt),
    acceptanceDay: parsed.acceptanceDay,
    borrower: borrowerKey,
  });
  return {
    fields,
    salt: hex(salt),
    attestation: {
      tag: hex(attestation.tag),
      invoiceCommit: hex(attestation.invoiceCommit),
      acceptanceDay: Number(attestation.acceptanceDay),
      expiresAt: attestation.expiresAt.toString(),
      borrower: hex(attestation.borrower),
      signature: {
        announcement: { x: attestation.signature.announcement.x.toString(), y: attestation.signature.announcement.y.toString() },
        response: attestation.signature.response.toString(),
      },
    },
  };
};

const bundle = {
  note: 'Testnet demo only. Synthetic KSeF numbers, and the borrower secret below is published on purpose so anyone can pledge from the desk. Each attestation is single-use: once its tag is pledged the registry refuses it forever.',
  registryVersion: record.version,
  contractAddress: record.contractAddress,
  borrowerSecret: hex(demoBorrower),
  // Public key commitments of the lenders the registrar admitted. Only the commitment is public;
  // the pledge still proves membership against a historic root without naming which lender it is.
  lenders: [
    { label: 'Lender A', key: hex(Registry.pureCircuits.lenderKey(parties.lenderA)) },
    { label: 'Lender B', key: hex(Registry.pureCircuits.lenderKey(parties.lenderB)) },
  ],
  attestations: Array.from({ length: COUNT }, (_, i) => mint(i)),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(bundle, null, 2)}\n`);
console.log(`Wrote ${bundle.attestations.length} attestations for ${record.version} ${record.contractAddress.slice(0, 12)}… to ${path.relative(repoRoot, OUT)}`);
