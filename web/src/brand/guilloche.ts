// SPDX-License-Identifier: Apache-2.0
// Guilloché: the engraved, interlaced line work of banknotes, share certificates and notarial seals.
// Deterministic path generators shared by the seal texture, the mark, the brand page and the asset scripts.

const f = (n: number) => (Math.round(n * 100) / 100).toString();

function closedPath(points: [number, number][]): string {
  return `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
}

/**
 * A woven ring: `strands` sine waves around a circle, each phase-shifted, so they cross into a braid.
 * cx, cy centre; radius mid-line; amplitude of the wave; lobes per turn.
 */
export function ring(cx: number, cy: number, radius: number, amplitude: number, lobes: number, strands: number, steps = 720): string[] {
  return Array.from({ length: strands }, (_, s) => {
    const phase = (s / strands) * Math.PI * 2;
    const pts: [number, number][] = [];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const r = radius + amplitude * Math.sin(lobes * t + phase);
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return closedPath(pts);
  });
}

/** A rosette: hypotrochoid curves rotated around the centre, the classic engine-turned flower. */
export function rosette(cx: number, cy: number, outer: number, petals: number, copies: number, steps = 900): string[] {
  const R = outer;
  const r = outer / petals;
  const d = outer * 0.62;
  return Array.from({ length: copies }, (_, c) => {
    const rot = (c / copies) * ((Math.PI * 2) / petals);
    const pts: [number, number][] = [];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
      const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
      const k = 1 / (R - r + d);
      const xs = x * k * outer * 0.98;
      const ys = y * k * outer * 0.98;
      pts.push([cx + xs * Math.cos(rot) - ys * Math.sin(rot), cy + xs * Math.sin(rot) + ys * Math.cos(rot)]);
    }
    return closedPath(pts);
  });
}
