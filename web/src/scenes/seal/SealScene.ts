// SPDX-License-Identifier: Apache-2.0
// The Seal: a steel notary die presses a wax impression onto an invoice, refuses the duplicate,
// and the invoice's opaque tag rises into the public set. Rendered on demand from poseAt(progress).
import {
  NeutralToneMapping,
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LatheGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SLOT_X, SLOT_Y, SLOT_Z, poseAt } from './pose.ts';
import { TAG_LABELS, engravingTexture, invoiceTexture, shadowTexture, tagTexture } from './textures.ts';

export interface SealSceneOptions {
  quality: 'high' | 'low';
}

const SHEET_W = 1.4;
const SHEET_H = 1.98;
const SEAL_SCALE = 0.36;

// Lathe profile of the die and handle (radius, height), die face at y = 0.
const PROFILE: [number, number][] = [
  [0, 0],
  [0.95, 0],
  [1, 0.03],
  [1, 0.22],
  [0.96, 0.26],
  [0.55, 0.34],
  [0.42, 0.52],
  [0.4, 0.95],
  [0.46, 1.25],
  [0.62, 1.55],
  [0.66, 1.75],
  [0.58, 1.98],
  [0.35, 2.12],
  [0, 2.16],
];

export class SealScene {
  readonly ready: Promise<void>;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.1, 60);
  private seal = new Group();
  private sheetA = new Group();
  private sheetB = new Group();
  private impression!: Mesh;
  private tag!: Mesh;
  private shadow!: Mesh;
  private slots = new Group();
  private slotTarget!: LineSegments;
  private progress = 0;
  private frame = 0;
  private visible = true;
  private disposed = false;
  private size = new Vector2();
  private textures: Texture[] = [];
  private observer: ResizeObserver;
  private intersection: IntersectionObserver;
  private portrait = false;

  constructor(
    private host: HTMLElement,
    private canvas: HTMLCanvasElement,
    private options: SealSceneOptions,
  ) {
    const dprCap = window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: dpr < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.setClearColor(0x000000, 0);

    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04);
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.5;
    room.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      (m.material as Material | undefined)?.dispose?.();
    });
    pmrem.dispose();
    this.textures.push(env.texture);

    this.build();

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.request();
    });
    this.intersection.observe(host);
    canvas.addEventListener('webglcontextlost', this.onContextLost);

    this.resize();
    this.apply();
    this.ready = this.renderer.compileAsync(this.scene, this.camera).then(() => {
      if (!this.disposed) this.render();
    });
  }

  private tex<T extends Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  private build() {
    const high = this.options.quality === 'high';
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const engraving = this.tex(engravingTexture(high ? 1024 : 512, aniso));

    const key = new DirectionalLight(new Color('#ffe7c7'), 2.4);
    key.position.set(-3, 6, 4);
    const rim = new DirectionalLight(new Color('#a9b8ff'), 1.3);
    rim.position.set(4, 2.5, -4);
    const fill = new AmbientLight(new Color('#ffffff'), 0.12);
    this.scene.add(key, rim, fill);

    // Die and handle.
    const segments = high ? 128 : 64;
    const steel = new MeshStandardMaterial({ color: new Color('#2b2e35'), metalness: 1, roughness: 0.34 });
    const ebony = new MeshStandardMaterial({ color: new Color('#15110d'), metalness: 0.1, roughness: 0.5 });
    const dieProfile = PROFILE.slice(0, 6).map(([r, y]) => new Vector2(r, y));
    const handleProfile = PROFILE.slice(5).map(([r, y]) => new Vector2(r, y));
    const die = new Mesh(new LatheGeometry(dieProfile, segments), steel);
    const handle = new Mesh(new LatheGeometry(handleProfile, segments), ebony);
    const face = new Mesh(
      new CircleGeometry(0.95, segments),
      new MeshStandardMaterial({
        color: new Color('#3a3d44'),
        metalness: 1,
        roughness: 0.28,
        bumpMap: engraving,
        bumpScale: 2.2,
        roughnessMap: engraving,
      }),
    );
    face.rotation.x = Math.PI / 2; // face points down (-y)
    face.position.y = -0.001;
    const sealBody = new Group();
    sealBody.add(die, handle, face);
    sealBody.scale.setScalar(SEAL_SCALE);
    this.seal.add(sealBody);
    this.scene.add(this.seal);

    // Soft shadow that tightens as the seal descends.
    this.shadow = new Mesh(
      new PlaneGeometry(1.1, 1.1),
      new MeshStandardMaterial({ map: this.tex(shadowTexture()), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.6 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.scene.add(this.shadow);

    // Invoice sheets.
    const sheet = (label: string) => {
      const mat = new MeshStandardMaterial({ map: this.tex(invoiceTexture(label, aniso)), roughness: 0.92, metalness: 0 });
      const edge = new MeshStandardMaterial({ color: new Color('#d9d1bf'), roughness: 0.95 });
      const mesh = new Mesh(new BoxGeometry(SHEET_W, 0.006, SHEET_H), [edge, edge, mat, edge, edge, edge]);
      mesh.position.y = 0.003;
      return mesh;
    };
    this.sheetA.add(sheet('LENDER A'));
    this.sheetA.rotation.y = -0.06;
    this.sheetB.add(sheet('LENDER B'));
    this.scene.add(this.sheetA, this.sheetB);

    // Wax impression, a child of sheet A.
    const waxColor = new Color('#B8321C');
    const waxSide = high
      ? new MeshPhysicalMaterial({ color: waxColor, roughness: 0.46, clearcoat: 0.3, clearcoatRoughness: 0.45 })
      : new MeshStandardMaterial({ color: waxColor, roughness: 0.38 });
    const waxTop = high
      ? new MeshPhysicalMaterial({ color: waxColor, roughness: 0.5, bumpMap: engraving, bumpScale: -1.6, clearcoat: 0.3, clearcoatRoughness: 0.5 })
      : new MeshStandardMaterial({ color: waxColor, roughness: 0.42, bumpMap: engraving, bumpScale: -1.4 });
    const waxGeo = new CylinderGeometry(0.37, 0.4, 0.04, high ? 96 : 48, 1);
    // Irregular rim: a deterministic wobble on the outer vertices.
    const pos = waxGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r > 0.33) {
        const a = Math.atan2(z, x);
        const k = 1 + 0.035 * Math.sin(a * 7) + 0.02 * Math.sin(a * 13 + 1.3);
        pos.setX(i, x * k);
        pos.setZ(i, z * k);
      }
    }
    waxGeo.computeVertexNormals();
    this.impression = new Mesh(waxGeo, [waxSide, waxTop, waxSide]);
    this.impression.position.set(0.05, 0.024, 0.18);
    this.sheetA.add(this.impression);

    // Public tag set: six slots, two already holding real registry v2 tags.
    const slotGeo = new PlaneGeometry(0.46, 0.29);
    const edges = new EdgesGeometry(slotGeo);
    SLOT_X.forEach((x, i) => {
      const filled = i === 1 || i === 4;
      const plate = new Mesh(
        slotGeo,
        filled
          ? new MeshStandardMaterial({ map: this.tex(tagTexture(TAG_LABELS[i === 1 ? 0 : 1], aniso)), roughness: 0.6, transparent: true })
          : new MeshStandardMaterial({ color: new Color('#1A1E27'), roughness: 0.9, transparent: true, opacity: 0.85 }),
      );
      const outline = new LineSegments(edges, new LineBasicMaterial({ color: new Color(i === 3 ? '#E0452B' : '#5A5F6B'), transparent: true }));
      if (i === 3) this.slotTarget = outline;
      const slot = new Group();
      slot.add(plate, outline);
      slot.position.set(x, SLOT_Y, SLOT_Z);
      this.slots.add(slot);
    });
    this.scene.add(this.slots);

    this.tag = new Mesh(
      new BoxGeometry(0.46, 0.29, 0.02),
      new MeshStandardMaterial({ map: this.tex(tagTexture('new tag', aniso, true)), roughness: 0.55, metalness: 0.1 }),
    );
    this.scene.add(this.tag);
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.host.dispatchEvent(new CustomEvent('seal-context-lost', { bubbles: true }));
  };

  setProgress(p: number) {
    if (Math.abs(p - this.progress) < 1e-4) return;
    this.progress = p;
    this.request();
  }

  private request() {
    if (this.frame || this.disposed || !this.visible) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.apply();
      this.render();
    });
  }

  private apply() {
    const pose = poseAt(this.progress);
    const { seal, sheetA, sheetB, tag, slots, camera } = pose;
    this.seal.position.set(seal.x, seal.y, seal.z);
    this.seal.rotation.set(seal.rx, seal.ry, 0);
    this.seal.scale.set(1, seal.squash, 1);

    this.shadow.position.x = seal.x;
    this.shadow.position.z = seal.z;
    const spread = 0.55 + seal.y * 0.6;
    this.shadow.scale.setScalar(spread);
    (this.shadow.material as MeshStandardMaterial).opacity = 0.65 * pose.shadow;

    this.sheetA.position.x = sheetA.x;
    this.sheetB.visible = sheetB.visible;
    this.sheetB.position.set(sheetB.x, 0, 0.1);
    this.sheetB.rotation.y = sheetB.ry;

    this.impression.visible = pose.impression > 0.001;
    this.impression.scale.set(pose.impression, 1, pose.impression);

    this.tag.visible = tag.visible;
    this.tag.position.set(tag.x, tag.y, tag.z);
    this.tag.rotation.set(tag.rx, 0, 0);
    this.tag.scale.setScalar(Math.max(0.001, tag.scale));

    this.slots.visible = slots.opacity > 0.001;
    this.slots.traverse((o) => {
      const mat = (o as Mesh).material as MeshStandardMaterial | LineBasicMaterial | undefined;
      if (mat && 'opacity' in mat) mat.opacity = slots.opacity * (o === this.slotTarget ? 0.4 + 0.6 * slots.glow : 0.9);
    });

    const zoom = this.portrait ? 1.35 : 1;
    this.camera.position.set(camera.x, camera.y * (this.portrait ? 1.1 : 1), camera.z * zoom);
    this.camera.lookAt(camera.tx, camera.ty, camera.tz);
  }

  private render() {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.getSize(this.size);
    if (this.size.x === Math.round(width) && this.size.y === Math.round(height)) return;
    this.renderer.setSize(width, height, false);
    this.portrait = height > width;
    this.camera.aspect = width / height;
    this.camera.fov = this.portrait ? 42 : 30;
    if (this.portrait) this.camera.setViewOffset(width, height, 0, height * 0.16, width, height);
    else this.camera.setViewOffset(width, height, -width * 0.17, 0, width, height);
    this.camera.updateProjectionMatrix();
    this.apply();
    this.render();
  }

  dispose() {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.intersection.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      mats.forEach((m) => m.dispose());
    });
    this.textures.forEach((t) => t.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
