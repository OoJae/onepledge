// SPDX-License-Identifier: Apache-2.0
import { MARK_RING, NUMERAL_ONE, markPalettes } from './mark.ts';

export function Mark({ size = 32, palette = 'wax', title }: { size?: number; palette?: keyof typeof markPalettes; title?: string }) {
  const c = markPalettes[palette];
  const simple = size < 28;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} className="mark">
      {title && <title>{title}</title>}
      <circle cx="32" cy="32" r="31" fill={c.disc} />
      {c.edge && <circle cx="32" cy="32" r="30.25" fill="none" stroke={c.edge} strokeWidth="1.5" />}
      {!simple && (
        <g fill="none" stroke={c.ring} strokeWidth="0.55" strokeOpacity="0.85">
          {MARK_RING.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      )}
      {!simple && <circle cx="32" cy="32" r="21" fill="none" stroke={c.ring} strokeWidth="0.8" />}
      <path d={NUMERAL_ONE} fill={c.numeral} />
    </svg>
  );
}

/** "One" roman, "Pledge" italic: the promise word leans. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`}>
      One<em>Pledge</em>
    </span>
  );
}
