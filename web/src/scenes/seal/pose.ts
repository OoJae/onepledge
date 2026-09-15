// SPDX-License-Identifier: Apache-2.0
// The pledge choreography as a pure function of scroll progress p ∈ [0, 1].
// The same p always gives the same frame, so scrubbing, reversing and poster renders agree.

type Key = [number, number];

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Piecewise track through keys [p, value], eased between neighbours and held outside the range. */
function track(keys: Key[]) {
  return (p: number) => {
    if (p <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [p1, v1] = keys[i];
      if (p <= p1) {
        const [p0, v0] = keys[i - 1];
        const t = p1 === p0 ? 1 : smooth((p - p0) / (p1 - p0));
        return v0 + (v1 - v0) * t;
      }
    }
    return keys[keys.length - 1][1];
  };
}

const sealX = track([[0, 0], [0.14, 0], [0.26, 0.05], [0.42, 0.05], [0.5, 1.1], [0.64, 1.1], [0.78, -3.6]]);
const sealY = track([[0, 0.92], [0.14, 0.9], [0.26, 0.8], [0.325, 0.045], [0.35, 0.036], [0.375, 0.045], [0.42, 0.8], [0.5, 0.8], [0.565, 0.3], [0.585, 0.26], [0.625, 0.75], [0.78, 3.2]]);
const sealZ = track([[0, 0.55], [0.14, 0.5], [0.26, 0.18], [0.42, 0.18], [0.5, 0.1], [0.78, -0.6]]);
const sealRx = track([[0, -1.15], [0.14, -1.0], [0.26, 0], [0.38, 0], [0.42, -0.2], [0.5, 0], [0.64, 0], [0.78, -0.7]]);
const sealRy = track([[0, -0.7], [0.14, 0.35], [0.26, 0.5], [0.78, 1.3]]);
const sealSquash = track([[0.325, 1], [0.35, 0.965], [0.375, 1]]);

const sheetAX = track([[0.42, 0], [0.5, -0.32], [0.72, -0.32], [0.82, 0]]);
const sheetBX = track([[0.42, 3.6], [0.5, 1.1], [0.63, 1.1], [0.72, 4.2]]);
const sheetBRy = track([[0.42, 0.3], [0.5, 0.05], [0.63, 0.05], [0.72, 0.55]]);
const impression = track([[0.335, 0], [0.345, 1]]);

const SLOT_Y = 1.18;
const SLOT_Z = -0.85;
export const SLOT_X = [-1.2, -0.72, -0.24, 0.24, 0.72, 1.2];
const TARGET_SLOT = 3;

const tagX = track([[0.74, -0.6], [0.84, 0], [0.92, SLOT_X[TARGET_SLOT]]]);
const tagY = track([[0.74, 0.08], [0.84, 0.95], [0.92, SLOT_Y]]);
const tagZ = track([[0.74, 0.15], [0.84, 0.35], [0.92, SLOT_Z + 0.02]]);
const tagRx = track([[0.74, -Math.PI / 2], [0.84, -0.35], [0.92, 0]]);
const tagScale = track([[0.74, 0], [0.77, 1]]);
const slotGlow = track([[0.88, 0], [0.93, 1]]);
const slotsIn = track([[0.7, 0], [0.8, 1]]);

const camX = track([[0, 0], [0.42, 0], [0.5, 0.42], [0.72, 0.42], [0.84, 0]]);
const camY = track([[0, 1.9], [0.14, 2.0], [0.26, 3.1], [0.42, 3.1], [0.5, 3.55], [0.72, 3.55], [0.84, 2.45], [0.92, 2.25]]);
const camZ = track([[0, 4.1], [0.14, 3.9], [0.26, 2.9], [0.42, 2.9], [0.5, 4.1], [0.72, 4.1], [0.84, 4.5], [0.92, 4.75]]);
const lookX = track([[0, 0], [0.42, 0], [0.5, 0.42], [0.72, 0.42], [0.84, 0]]);
const lookY = track([[0, 0.55], [0.14, 0.5], [0.26, 0.1], [0.42, 0.1], [0.5, 0.2], [0.72, 0.2], [0.84, 0.62], [0.92, 0.7]]);
const lookZ = track([[0, 0], [0.72, 0], [0.84, -0.2], [0.92, -0.3]]);

export interface Pose {
  seal: { x: number; y: number; z: number; rx: number; ry: number; squash: number };
  sheetA: { x: number };
  sheetB: { x: number; ry: number; visible: boolean };
  impression: number;
  tag: { x: number; y: number; z: number; rx: number; scale: number; visible: boolean };
  slots: { opacity: number; glow: number; target: number };
  camera: { x: number; y: number; z: number; tx: number; ty: number; tz: number };
  shadow: number;
}

export function poseAt(raw: number): Pose {
  const p = Math.min(1, Math.max(0, raw));
  // A short recoil shake when the seal meets the duplicate sheet.
  const shakeT = (p - 0.585) / 0.04;
  const shake = shakeT > 0 && shakeT < 1 ? Math.sin(shakeT * Math.PI * 5) * 0.035 * (1 - shakeT) : 0;
  const y = sealY(p);
  return {
    seal: { x: sealX(p) + shake, y, z: sealZ(p), rx: sealRx(p), ry: sealRy(p), squash: sealSquash(p) },
    sheetA: { x: sheetAX(p) },
    sheetB: { x: sheetBX(p), ry: sheetBRy(p), visible: p > 0.41 && p < 0.73 },
    impression: impression(p),
    tag: { x: tagX(p), y: tagY(p), z: tagZ(p), rx: tagRx(p), scale: tagScale(p), visible: p >= 0.74 },
    slots: { opacity: slotsIn(p), glow: slotGlow(p), target: TARGET_SLOT },
    camera: { x: camX(p), y: camY(p), z: camZ(p), tx: lookX(p), ty: lookY(p), tz: lookZ(p) },
    shadow: Math.max(0, 1 - y / 1.4),
  };
}

export { SLOT_Y, SLOT_Z };
