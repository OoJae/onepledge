// SPDX-License-Identifier: Apache-2.0
// The brand, as a page: every asset shown on the ground it was designed for, with the files to download.
import { ring, rosette } from '../brand/guilloche.ts';
import { Mark, Wordmark } from '../brand/Mark.tsx';
import { color, font, size } from '../brand/tokens.ts';
import { SealArt } from '../landing/SealArt.tsx';
import './brand.css';

const RING = ring(120, 120, 88, 16, 14, 7, 720);
const ROSETTE = rosette(120, 120, 84, 12, 8, 900);

const downloads = [
  ['Seal mark · wax', '/brand/mark-wax.svg'],
  ['Seal mark · paper', '/brand/mark-paper.svg'],
  ['Seal mark · ink', '/brand/mark-ink.svg'],
  ['Small mark (16–32 px)', '/brand/mark-small.svg'],
  ['Wordmark', '/brand/wordmark.svg'],
  ['Horizontal lockup', '/brand/lockup-horizontal.svg'],
  ['Stacked lockup', '/brand/lockup-stacked.svg'],
  ['Guilloché pattern', '/brand/guilloche.svg'],
  ['Open Graph image', '/og.png'],
];

export function Brand() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Brand · Notary at midnight</p>
        <h1 tabIndex={-1}>
          A seal, pressed <em>once.</em>
        </h1>
        <p className="lede">
          OnePledge borrows its language from the rituals it replaces: liens, notaries and sealed registers. Midnight ink for
          the ground, ledger paper for the words, and one colour of sealing wax for the moment a pledge is made.
        </p>
      </section>

      <section className="b-block" aria-labelledby="b-mark">
        <h2 id="b-mark">The seal mark</h2>
        <p className="muted b-note">
          A guilloché ring, the engraved line work of banknotes and certificates, around a numeral one. Below 28 px the ring is
          dropped.
        </p>
        <div className="b-marks">
          <figure className="b-tile b-tile-ink">
            <Mark size={132} palette="wax" />
            <figcaption>Wax on ink · primary</figcaption>
          </figure>
          <figure className="b-tile b-tile-ink">
            <Mark size={132} palette="ink" />
            <figcaption>Ink, engraved</figcaption>
          </figure>
          <figure className="b-tile b-tile-paper">
            <Mark size={132} palette="paper" />
            <figcaption>On paper</figcaption>
          </figure>
          <figure className="b-tile b-tile-ink b-small">
            <span>
              <Mark size={32} palette="wax" />
              <Mark size={24} palette="wax" />
              <Mark size={16} palette="wax" />
            </span>
            <figcaption>Small sizes</figcaption>
          </figure>
        </div>
      </section>

      <section className="b-block" aria-labelledby="b-word">
        <h2 id="b-word">Wordmark and lockups</h2>
        <p className="muted b-note">"One" upright, "Pledge" in italic: the promise word leans. Clear space around the lockup equals the height of the mark.</p>
        <div className="b-lockups">
          <div className="b-tile b-tile-ink b-lockup">
            <Mark size={56} />
            <Wordmark className="b-wordmark" />
          </div>
          <div className="b-tile b-tile-paper b-lockup b-lockup-stacked">
            <Mark size={72} palette="ink" />
            <Wordmark className="b-wordmark" />
          </div>
        </div>
      </section>

      <section className="b-block" aria-labelledby="b-color">
        <h2 id="b-color">Colour</h2>
        <p className="muted b-note">Near-monochrome. Wax is the only accent: use it for the seal, the moment of pledge and primary actions, never for decoration.</p>
        <ul className="b-swatches">
          {Object.entries(color).map(([name, c]) => (
            <li key={name}>
              <span className={`b-chip b-chip-${name}`} aria-hidden />
              <span className="b-swatch-name">{name}</span>
              <span className="mono">{c.value}</span>
              <span className="muted small">{c.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="b-block" aria-labelledby="b-type">
        <h2 id="b-type">Type</h2>
        <div className="b-type">
          <div>
            <p className="label">Display · Fraunces</p>
            <p className="b-specimen-display">
              One invoice. <em>One pledge.</em>
            </p>
            <p className="muted small">{font.display.role}. Scale {size.displayXl}.</p>
          </div>
          <div>
            <p className="label">Body · Inter</p>
            <p className="b-specimen-body">Lenders fund the invoice only after a pledge naming them lands on chain.</p>
            <p className="muted small">{font.body.role}.</p>
          </div>
          <div>
            <p className="label">Utility · JetBrains Mono</p>
            <p className="b-specimen-mono">KSeF 5265877635-20260910-0412C0DE5E7A-3F</p>
            <p className="muted small">{font.mono.role}.</p>
          </div>
        </div>
      </section>

      <section className="b-block" aria-labelledby="b-pattern">
        <h2 id="b-pattern">Guilloché</h2>
        <p className="muted b-note">Generated, not drawn: woven rings and hypotrochoid rosettes, the same curves engraved on the 3D seal.</p>
        <div className="b-patterns">
          <figure className="b-tile b-tile-ink">
            <svg viewBox="0 0 240 240" aria-hidden="true" className="b-pattern">
              {RING.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </svg>
            <figcaption>Woven ring</figcaption>
          </figure>
          <figure className="b-tile b-tile-ink">
            <svg viewBox="0 0 240 240" aria-hidden="true" className="b-pattern">
              {ROSETTE.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </svg>
            <figcaption>Rosette</figcaption>
          </figure>
          <figure className="b-tile b-tile-ink b-tile-wide">
            <SealArt beat={1} />
            <figcaption>The pledge, illustrated</figcaption>
          </figure>
        </div>
      </section>

      <section className="b-block" aria-labelledby="b-files">
        <h2 id="b-files">Files</h2>
        <ul className="b-files">
          {downloads.map(([label, href]) => (
            <li key={href}>
              <a href={href} download>
                {label}
              </a>
              <span className="mono muted small">{href}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
