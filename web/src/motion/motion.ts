// SPDX-License-Identifier: Apache-2.0
// Loaded after first paint: GSAP + ScrollTrigger for the one scrubbed scene, Lenis for smooth scrolling on the landing.

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function loadMotion() {
  const [{ gsap }, { ScrollTrigger }, { default: Lenis }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('lenis')]);
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });
  return { gsap, ScrollTrigger, Lenis };
}

export type Motion = Awaited<ReturnType<typeof loadMotion>>;

/** Smooth scrolling tied to GSAP's ticker so ScrollTrigger and Lenis agree on every frame. */
export function startLenis({ gsap, ScrollTrigger, Lenis }: Motion) {
  const lenis = new Lenis({ lerp: 0.1, smoothWheel: true, autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  const tick = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  return () => {
    gsap.ticker.remove(tick);
    lenis.destroy();
  };
}

/** WebGL2 on a device that can afford it; otherwise the illustrated version is shown. */
export function canRender3d() {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return false;
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (coarse && (navigator.hardwareConcurrency ?? 4) <= 4) return false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
