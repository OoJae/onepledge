// SPDX-License-Identifier: Apache-2.0
// Canvas textures generated at runtime: the engraved guilloché face, invoice sheets, the tag plate and a soft shadow.
import { CanvasTexture, NoColorSpace, SRGBColorSpace, type Texture } from 'three';
import { ring, rosette } from '../../brand/guilloche.ts';
import { NUMERAL_ONE } from '../../brand/mark.ts';
import { DEMO_KSEF, V2_TAGS } from '../../brand/facts.ts';

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const finish = (tex: Texture, color: boolean, anisotropy: number) => {
  tex.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
};

/** Grayscale height map of the seal face: white is raised. Also used, softened, for the wax impression. */
export function engravingTexture(size: number, anisotropy: number) {
  const c = canvas(size, size);
  const g = c.getContext('2d')!;
  const s = size / 240;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.save();
  g.scale(s, s);
  g.strokeStyle = '#fff';
  g.lineWidth = 0.55;
  for (const d of ring(120, 120, 104, 3.4, 30, 5, 900)) g.stroke(new Path2D(d));
  g.lineWidth = 0.45;
  for (const d of rosette(120, 120, 78, 11, 7, 900)) g.stroke(new Path2D(d));
  g.lineWidth = 1.6;
  g.beginPath();
  g.arc(120, 120, 114, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 1.1;
  g.beginPath();
  g.arc(120, 120, 88, 0, Math.PI * 2);
  g.stroke();
  // The numeral sits on a flat boss so it reads clearly above the rosette.
  g.fillStyle = '#000';
  g.beginPath();
  g.arc(120, 120, 46, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.translate(120 - 32 * 1.35, 120 - 32 * 1.35);
  g.scale(1.35, 1.35);
  g.fill(new Path2D(NUMERAL_ONE));
  g.restore();
  return finish(new CanvasTexture(c), false, anisotropy);
}

/** Invoice sheet, 1 : 1.414. The KSeF number is synthetic and labelled so. */
export function invoiceTexture(lender: string, anisotropy: number) {
  const W = 1024;
  const H = 1448;
  const c = canvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = '#EDE6D6';
  g.fillRect(0, 0, W, H);
  // Paper tooth.
  for (let i = 0; i < 2600; i++) {
    const x = (i * 7919) % W;
    const y = (i * 104729) % H;
    g.fillStyle = i % 2 ? 'rgba(11,13,18,0.035)' : 'rgba(255,255,255,0.05)';
    g.fillRect(x, y, 2, 2);
  }
  const ink = '#0B0D12';
  const mono = "'JetBrains Mono Variable', ui-monospace, monospace";
  g.fillStyle = ink;
  g.font = `600 52px ${mono}`;
  g.fillText('FAKTURA', 80, 150);
  g.font = `500 26px ${mono}`;
  g.globalAlpha = 0.55;
  g.textAlign = 'right';
  g.fillText(lender, W - 80, 150);
  g.textAlign = 'left';
  g.globalAlpha = 1;
  g.fillRect(80, 186, W - 160, 3);
  g.font = `500 24px ${mono}`;
  g.globalAlpha = 0.6;
  g.fillText('NUMER KSeF', 80, 250);
  g.globalAlpha = 1;
  g.font = `600 30px ${mono}`;
  g.fillText(DEMO_KSEF, 80, 292);
  g.globalAlpha = 0.12;
  for (let i = 0; i < 9; i++) g.fillRect(80, 380 + i * 64, i % 3 === 2 ? 480 : 760, 16);
  g.globalAlpha = 0.6;
  g.font = `500 24px ${mono}`;
  g.fillText('DO ZAPŁATY', 80, H - 250);
  g.globalAlpha = 1;
  g.font = `600 72px ${mono}`;
  g.fillText('125 000 zł', 80, H - 170);
  g.globalAlpha = 0.45;
  g.font = `500 20px ${mono}`;
  g.fillText('synthetic KSeF-format number', 80, H - 90);
  g.globalAlpha = 1;
  return finish(new CanvasTexture(c), true, anisotropy);
}

/** The opaque tag plate and the two tags already in the public set. */
export function tagTexture(label: string, anisotropy: number, lit = false) {
  const c = canvas(512, 320);
  const g = c.getContext('2d')!;
  g.fillStyle = '#1A1E27';
  g.fillRect(0, 0, 512, 320);
  g.strokeStyle = lit ? '#E0452B' : '#2A2F3A';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 502, 310);
  const mono = "'JetBrains Mono Variable', ui-monospace, monospace";
  g.fillStyle = '#A9A396';
  g.font = `500 30px ${mono}`;
  g.fillText('TAG', 40, 80);
  g.fillStyle = '#EDE6D6';
  g.font = `600 44px ${mono}`;
  g.fillText(label, 40, 190);
  return finish(new CanvasTexture(c), true, anisotropy);
}

export const TAG_LABELS = [V2_TAGS[0].slice(0, 12) + '…', V2_TAGS[1].slice(0, 12) + '…'];

export function shadowTexture() {
  const c = canvas(256, 256);
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return finish(new CanvasTexture(c), true, 1);
}
