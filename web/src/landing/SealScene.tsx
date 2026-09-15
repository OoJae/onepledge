// SPDX-License-Identifier: Apache-2.0
// The pledge scene. Reduced motion: four stacked, illustrated beats. Otherwise a sticky stage scrubbed by scroll:
// the illustrated beats cross-fade immediately, and the 3D seal takes over when the device can render it.
import { useEffect, useRef, useState } from 'react';
import { canRender3d, loadMotion, prefersReducedMotion, startLenis } from '../motion/motion.ts';
import { BEATS } from './beats.ts';
import { SealArt } from './SealArt.tsx';

type Mode = 'static' | 'scroll';

const beatAt = (p: number) => BEATS.reduce((active, b, i) => (p >= b.from ? i : active), 0);

export function SealScene() {
  const [mode] = useState<Mode>(() => (prefersReducedMotion() ? 'static' : 'scroll'));
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [beat, setBeat] = useState(0);
  const [ready3d, setReady3d] = useState(false);

  useEffect(() => {
    if (mode !== 'scroll' || !section.current || !stage.current || !canvas.current) return;
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    let scene: { setProgress(p: number): void; dispose(): void; ready: Promise<void> } | null = null;
    let progress = 0;

    const loadScene = async () => {
      if (scene || cancelled || !canRender3d()) return;
      const { SealScene: Scene3d } = await import('../scenes/seal/SealScene.ts');
      if (cancelled || !stage.current || !canvas.current) return;
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      try {
        scene = new Scene3d(stage.current, canvas.current, { quality: coarse ? 'low' : 'high' });
      } catch {
        return;
      }
      scene.setProgress(progress);
      await scene.ready;
      if (!cancelled) setReady3d(true);
    };

    const onLost = () => {
      scene?.dispose();
      scene = null;
      setReady3d(false);
    };
    section.current.addEventListener('seal-context-lost', onLost);
    cleanups.push(() => section.current?.removeEventListener('seal-context-lost', onLost));

    // Desktop: load the scene once the page is idle. Touch devices: only when the scene is about to scroll into view.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (coarse) {
      const io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            io.disconnect();
            void loadScene();
          }
        },
        { rootMargin: '50% 0px' },
      );
      io.observe(section.current);
      cleanups.push(() => io.disconnect());
    } else {
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      const run = () => void loadScene();
      if (idle) idle(run, { timeout: 1500 });
      else setTimeout(run, 600);
    }

    void loadMotion().then((motion) => {
      if (cancelled || !section.current) return;
      const { gsap, ScrollTrigger } = motion;
      cleanups.push(startLenis(motion));
      const proxy = { p: 0 };
      const tween = gsap.to(proxy, {
        p: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: section.current,
          start: 'top top',
          end: 'bottom bottom',
          scrub: true,
        },
        onUpdate: () => {
          progress = proxy.p;
          scene?.setProgress(progress);
          const next = beatAt(progress);
          setBeat((b) => (b === next ? b : next));
        },
      });
      cleanups.push(() => {
        tween.scrollTrigger?.kill();
        tween.kill();
      });
      ScrollTrigger.refresh();
    });

    return () => {
      cancelled = true;
      cleanups.forEach((c) => c());
      scene?.dispose();
      scene = null;
    };
  }, [mode]);

  if (mode === 'static') {
    return (
      <section id="pledge-scene" className="l-scene" data-mode="static" aria-labelledby="scene-title">
        <div className="container">
          <h2 id="scene-title" className="l-scene-title">
            One pledge, <em>beat by beat</em>
          </h2>
          <a className="l-skip" href="#after-scene">
            Skip the pledge scene
          </a>
          <ol className="l-beats">
            {BEATS.map((b) => (
              <li key={b.beat} className="l-beat">
                <figure className="l-beat-art">
                  <SealArt beat={b.beat} />
                </figure>
                <div className="l-beat-copy">
                  <h3 className="l-beat-title">
                    {b.lead} <em>{b.accent}</em>
                  </h3>
                  <p>{b.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    );
  }

  return (
    <section ref={section} id="pledge-scene" className="l-scene l-scene-scroll" data-mode="scroll" data-beat={beat} data-ready={ready3d ? '3d' : 'art'} aria-labelledby="scene-title">
      <div className="l-sticky">
        <div className="l-stage" ref={stage} aria-hidden="true">
          <div className="l-stage-lamp" />
          {BEATS.map((b, i) => (
            <div key={b.beat} className="l-stage-art" data-active={i === beat}>
              <SealArt beat={b.beat} />
            </div>
          ))}
          <canvas ref={canvas} className="l-canvas" />
        </div>
        <div className="container l-captions">
          <h2 id="scene-title" className="l-scene-kicker">
            One pledge, beat by beat
          </h2>
          <a className="l-skip" href="#after-scene">
            Skip the pledge scene
          </a>
          <ol className="l-caption-list">
            {BEATS.map((b, i) => (
              <li key={b.beat} className="l-caption" data-active={i === beat}>
                <h3 className="l-beat-title">
                  {b.lead} <em>{b.accent}</em>
                </h3>
                <p>{b.body}</p>
              </li>
            ))}
          </ol>
          <ol className="l-rail" aria-hidden="true">
            {BEATS.map((b, i) => (
              <li key={b.beat} data-active={i <= beat} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
