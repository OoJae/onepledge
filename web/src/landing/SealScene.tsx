// SPDX-License-Identifier: Apache-2.0
// The pledge, beat by beat. This static version is what reduced-motion readers get; the 3D stage builds on the same markup.
import { BEATS } from './beats.ts';
import { SealArt } from './SealArt.tsx';

export function SealScene() {
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
