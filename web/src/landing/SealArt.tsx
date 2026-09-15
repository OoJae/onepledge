// SPDX-License-Identifier: Apache-2.0
// Static illustration of each beat of the pledge. It is the reduced-motion version of the 3D scene
// and the artwork shown until the scene is ready.
import { rosette, ring } from '../brand/guilloche.ts';
import { NUMERAL_ONE } from '../brand/mark.ts';
import { DEMO_KSEF, V2_TAGS } from '../brand/facts.ts';

export type Beat = 0 | 1 | 2 | 3;

const ROSETTE = rosette(0, 0, 92, 11, 6, 700);
const FACE_RING = ring(0, 0, 100, 3.2, 30, 4, 600);
const WAX_RING = ring(0, 0, 44, 1.6, 18, 3, 360);

function Sheet({ x, y, rot, label }: { x: number; y: number; rot: number; label: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x="-130" y="-165" width="260" height="330" rx="4" fill="#EDE6D6" />
      <rect x="-130" y="-165" width="260" height="330" rx="4" fill="none" stroke="#0B0D12" strokeOpacity="0.08" />
      <text x="-108" y="-128" fontSize="13" fontWeight="600" letterSpacing="2" fill="#0B0D12">
        FAKTURA
      </text>
      <text x="108" y="-128" textAnchor="end" fontSize="9" fill="#0B0D12" fillOpacity="0.55">
        {label}
      </text>
      <text x="-108" y="-100" fontSize="8.6" fill="#0B0D12">
        KSeF {DEMO_KSEF}
      </text>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x="-108" y={-72 + i * 20} width={i % 2 ? 150 : 200} height="5" rx="2.5" fill="#0B0D12" fillOpacity="0.12" />
      ))}
      <text x="108" y="120" textAnchor="end" fontSize="15" fontWeight="600" fill="#0B0D12">
        125 000 zł
      </text>
    </g>
  );
}

function Die({ x, y, scale = 1, opacity = 1 }: { x: number; y: number; scale?: number; opacity?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
      <circle r="112" fill="#12151C" stroke="#2A2F3A" strokeWidth="2" />
      <circle r="104" fill="none" stroke="#EDE6D6" strokeOpacity="0.18" />
      <g fill="none" stroke="#EDE6D6" strokeOpacity="0.34" strokeWidth="0.7">
        {FACE_RING.map((d, i) => (
          <path key={`r${i}`} d={d} />
        ))}
      </g>
      <g fill="none" stroke="#EDE6D6" strokeOpacity="0.2" strokeWidth="0.55">
        {ROSETTE.map((d, i) => (
          <path key={`s${i}`} d={d} />
        ))}
      </g>
      <path d={NUMERAL_ONE} transform="translate(-58 -58) scale(1.8)" fill="#EDE6D6" fillOpacity="0.9" />
    </g>
  );
}

function Impression({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="52" fill="#E0452B" />
      <circle r="52" fill="none" stroke="#0B0D12" strokeOpacity="0.25" strokeWidth="3" />
      <g fill="none" stroke="#0B0D12" strokeOpacity="0.45" strokeWidth="0.6">
        {WAX_RING.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <path d={NUMERAL_ONE} transform="translate(-32 -32)" fill="#0B0D12" fillOpacity="0.85" />
    </g>
  );
}

export function SealArt({ beat, className = '' }: { beat: Beat; className?: string }) {
  return (
    <svg viewBox="0 0 640 640" className={`seal-art ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`lamp-${beat}`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#EDE6D6" stopOpacity="0.09" />
          <stop offset="1" stopColor="#EDE6D6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="640" height="640" fill={`url(#lamp-${beat})`} />
      {beat === 2 && (
        <g opacity="0.92">
          <Sheet x={420} y={400} rot={7} label="LENDER B" />
          <g transform="translate(420 400) rotate(7)">
            <rect x="-78" y="-22" width="156" height="44" rx="4" fill="#12151C" />
            <text textAnchor="middle" y="7" fontSize="17" fontWeight="600" letterSpacing="3" fill="#EDE6D6">
              REFUSED
            </text>
          </g>
        </g>
      )}
      <Sheet x={beat === 2 ? 245 : 300} y={400} rot={-5} label="LENDER A" />
      {beat >= 1 && <Impression x={beat === 2 ? 250 : 305} y={455} />}
      {beat === 0 && <Die x={320} y={190} />}
      {beat === 1 && <Die x={330} y={150} scale={0.82} opacity={0.95} />}
      {beat === 3 && (
        <g transform="translate(320 110)">
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const x = -255 + i * 88;
            const filled = i === 1 || i === 3;
            return (
              <g key={i} transform={`translate(${x} 0)`}>
                <rect width="74" height="46" rx="4" fill={filled ? '#1A1E27' : 'none'} stroke={i === 3 ? '#E0452B' : '#2A2F3A'} strokeWidth={i === 3 ? 2 : 1.2} />
                {filled && (
                  <text x="37" y="28" textAnchor="middle" fontSize="10" fill="#EDE6D6">
                    {V2_TAGS[i === 1 ? 0 : 1].slice(0, 7)}…
                  </text>
                )}
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}
