import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect } from 'react';
import * as THREE from 'three';
import { Hud } from '../components/hud/Hud';
import { CityScene } from '../scene/CityScene';
import { simClient } from '../sim/client';
import { chooseTransport } from '../sim/transport';
import { useSim } from '../state/simStore';
import { useUI } from '../state/uiStore';
import { followCitizen } from '../components/panels/actions';
import { useGuest } from '../state/guestStore';
import { TestHooks } from './TestHooks';
import { setGoalListener } from '../state/journalStore';
import { sound } from '../audio/engine';

setGoalListener((g) => {
  sound.ding();
  useUI.getState().notify(`Goal done · ${g.label}`);
});

/** "#citizen=<slug or id>" opens that citizen's card and follows them. */
function openHashLink(): void {
  const m = /citizen=([\w-]+)/.exec(location.hash);
  if (!m) return;
  const sim = useSim.getState();
  const p = sim.agentsBySlug.get(m[1]) ?? sim.citizensById.get(m[1]);
  if (!p) return;
  useGuest.getState().dismissWelcome();
  followCitizen(p.id);
}

export function App() {
  const ready = useSim((s) => s.ready);
  const dpr = useUI((s) => s.quality.pixelRatio);
  const shadows = useUI((s) => s.quality.shadows);

  useEffect(() => {
    let cancelled = false;
    void chooseTransport().then((t) => {
      if (!cancelled) simClient.connect(t);
    });
    return () => {
      cancelled = true;
      simClient.transport?.close();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(openHashLink, 400);
    window.addEventListener('hashchange', openHashLink);
    return () => {
      clearTimeout(t);
      window.removeEventListener('hashchange', openHashLink);
    };
  }, [ready]);

  return (
    <div className="app">
      {ready && (
        <Canvas
          className="city-canvas"
          shadows={shadows}
          dpr={dpr}
          camera={{ fov: 40, near: 0.5, far: 2400, position: [330, 200, 430] }}
          gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NoToneMapping;
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
          onPointerMissed={(e) => {
            if (e.type === 'click') useUI.getState().select(null);
          }}
        >
          <Suspense fallback={null}>
            <CityScene />
            <TestHooks />
          </Suspense>
        </Canvas>
      )}
      <Hud />
      {!ready && <Loading />}
    </div>
  );
}

function Loading() {
  const connection = useSim((s) => s.connection);
  return (
    <div className="loading" data-testid="loading">
      <div className="loading__logo">MORPHIS</div>
      <div className="loading__bar">
        <span />
      </div>
      <div className="loading__text">{connection === 'error' ? 'Simulation failed to start' : 'Generating city · simulating citizens…'}</div>
    </div>
  );
}
