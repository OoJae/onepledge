// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from 'react';
import { KsefNumberError, parseKsefNumber, receivableTag } from '@onepledge/attester';
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { NaiveRegistry, reformat, type NaiveInvoice } from '../naive.ts';
import { Walkthrough, hex, short } from '../engine.ts';

const baseInvoice: NaiveInvoice = {
  invoiceNo: 'FV/2026/09/0412',
  supplier: 'PL5265877635',
  amount: '125000.00',
  dueDate: '2026-11-30',
};

export function Attack() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Why not just publish a hash of each financed invoice?</p>
        <h1 tabIndex={-1}>A public hash registry fails twice.</h1>
        <p className="lede">
          The obvious design stores <span className="mono">sha256(invoice number, supplier, amount, due date)</span> on
          a public chain and rejects repeats. It is easy to bypass, and it tells anyone who holds an invoice whether it
          was financed and when.
        </p>
      </section>
      <Bypass />
      <Snooping />
    </>
  );
}

function Bypass() {
  const [naive] = useState(() => new NaiveRegistry());
  const [run] = useState(() => new Walkthrough());
  const [naiveResult, setNaiveResult] = useState<string[]>([]);
  const [onePledgeResult, setOnePledgeResult] = useState<string[]>([]);

  const attackNaive = () => {
    const first = naive.pledge(baseInvoice, '2026-09-12');
    const variant = reformat(baseInvoice);
    const second = naive.pledge(variant, '2026-09-13');
    setNaiveResult([
      `Bank A stores ${JSON.stringify(baseInvoice.invoiceNo)}, ${baseInvoice.supplier}, ${baseInvoice.amount}: ${first ? 'accepted' : 'rejected'}`,
      `Bank B stores ${JSON.stringify(variant.invoiceNo)}, ${variant.supplier}, ${variant.amount}: ${second ? 'ACCEPTED, a second pledge of the same invoice' : 'rejected'}`,
    ]);
  };

  const attackOnePledge = () => {
    const lines: string[] = [];
    const a = run.pledgeTo('A');
    lines.push(`Lender A pledges ${run.invoice.ksefNumber}: ${a.ok ? 'accepted' : `rejected (${a.detail})`}`);
    const mangled = run.invoice.ksefNumber.toLowerCase().replaceAll('-', '');
    try {
      parseKsefNumber(mangled);
      lines.push('Reformatted number accepted by the tag authority (unexpected)');
    } catch (e) {
      lines.push(`Reformatted number ${mangled}: refused by the tag authority (${(e as KsefNumberError).message})`);
    }
    const b = run.pledgeTo('B');
    lines.push(`Re-attested, exact number, Lender B: ${b.ok ? 'ACCEPTED (unexpected)' : `rejected by the circuit (${b.detail})`}`);
    setOnePledgeResult(lines);
  };

  return (
    <section className="columns two">
      <article className="card column">
        <h2>Attack 1 · Write it differently</h2>
        <p className="role">Naive hash registry</p>
        <p className="muted small">
          Every bank's system writes invoice numbers, tax IDs and amounts its own way. A different spelling is a
          different hash, so the registry sees a brand-new invoice.
        </p>
        <button className="danger" onClick={attackNaive} disabled={naiveResult.length > 0}>Pledge it twice</button>
        <ul className="seen">{naiveResult.map((l) => <li key={l}>{l}</li>)}</ul>
      </article>
      <article className="card column">
        <h2>Same attack on OnePledge</h2>
        <p className="role">Real circuits, in your browser</p>
        <p className="muted small">
          The identifier is the KSeF number the state e-invoicing system assigned. The tag authority accepts exactly
          one spelling and tags that. Any re-attestation of the same invoice yields the same tag.
        </p>
        <button onClick={attackOnePledge} disabled={onePledgeResult.length > 0}>Try it</button>
        <ul className="seen">{onePledgeResult.map((l) => <li key={l}>{l}</li>)}</ul>
      </article>
    </section>
  );
}

function Snooping() {
  const population = useMemo(() => {
    const registry = new NaiveRegistry();
    const invoices: NaiveInvoice[] = Array.from({ length: 40 }, (_, i) => ({
      invoiceNo: `FV/2026/09/${String(400 + i).padStart(4, '0')}`,
      supplier: 'PL5265877635',
      amount: i === 12 ? '125000.00' : `${(40 + ((i * 37) % 90)) * 1000}.00`,
      dueDate: '2026-11-30',
    }));
    invoices.forEach((inv, i) => {
      if (i % 3 === 0) registry.pledge(inv, `2026-09-${String(1 + (i % 12)).padStart(2, '0')}`);
    });
    return { registry, invoices };
  }, []);
  const [findings, setFindings] = useState<string[]>([]);
  const [onePledge, setOnePledge] = useState<string[]>([]);

  const snoopNaive = () => {
    const hits = population.invoices
      .map((inv) => ({ inv, hit: population.registry.lookup(inv) }))
      .filter((x) => x.hit)
      .map((x) => `${x.inv.invoiceNo} (${x.inv.amount} PLN) financed on ${x.hit!.pledgedOn}`);
    setFindings([`Checked ${population.invoices.length} invoices seen in the debtor's payables: ${hits.length} matches`, ...hits.slice(0, 6), hits.length > 6 ? '…' : ''].filter(Boolean));
  };

  const snoopOnePledge = () => {
    // A real registry: pledge one invoice, then attack its public tag set.
    const run = new Walkthrough();
    const pledged = run.pledgeTo('A');
    const tags = run.sim.ledger().tags;
    const knownNumber = run.invoice.ksefNumber;
    const GUESSES = 1000;
    let matches = 0;
    for (let i = 0; i < GUESSES; i++) {
      if (tags.member(receivableTag(randomBytes(32), knownNumber))) matches += 1;
    }
    const naive = tags.member(sha256(utf8ToBytes(knownNumber)));
    setOnePledge([
      `Registry holds ${tags.size()} pledged tag (${pledged.ok ? 'pledge accepted' : pledged.detail})`,
      `Attacker knows the invoice number ${knownNumber}`,
      `Plain hash of the number found in the tag set: ${naive ? 'yes' : 'no'}`,
      `Tags computed under ${GUESSES.toLocaleString()} guessed keys found in the tag set: ${matches}`,
      `A lender the borrower handed the real tag looks it up: ${tags.member(run.attestation.tag) ? 'pledged' : 'not pledged'}. Tag-holders can watch a tag; people who only know invoice numbers cannot.`,
    ]);
  };

  return (
    <section className="columns two">
      <article className="card column">
        <h2>Attack 2 · Watch a competitor's clients</h2>
        <p className="role">Naive hash registry</p>
        <p className="muted small">
          A debtor's finance team, or any lender that saw invoices during underwriting, hashes them and checks the
          public registry. It learns which suppliers factor which invoices, and when.
        </p>
        <button className="danger" onClick={snoopNaive} disabled={findings.length > 0}>Check {population.invoices.length} invoices</button>
        <ul className="seen">{findings.map((l) => <li key={l}>{l}</li>)}</ul>
        <p className="muted small mono">{population.registry.hashes().slice(0, 2).map((h) => short(h)).join(' · ')} …</p>
      </article>
      <article className="card column">
        <h2>Same attack on OnePledge</h2>
        <p className="role">Keyed tags</p>
        <p className="muted small">
          Tags are HMAC-SHA256 under the tag authority's secret. This runs the real registry in your browser: pledge an
          invoice, then try to find it in the public tag set knowing only its number.
        </p>
        <button onClick={snoopOnePledge} disabled={onePledge.length > 0}>Try it</button>
        <ul className="seen">{onePledge.map((l) => <li key={l}>{l}</li>)}</ul>
        <p className="muted small">
          Limits, stated plainly: the tag authority computes tags, so it can see whether its invoices were pledged; and
          anyone a borrower hands a tag can keep checking it. Wave 3 splits the authority into a threshold committee.
        </p>
      </article>
    </section>
  );
}

