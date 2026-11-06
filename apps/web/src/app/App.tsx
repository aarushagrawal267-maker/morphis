import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect } from 'react';
import * as THREE from 'three';
import { Hud } from '../components/hud/Hud';
import { CityScene } from '../scene/CityScene';
import { simClient } from '../sim/client';
import { chooseTransport } from '../sim/transport';
import { useSim } from '../state/simStore';
import { useUI } from '../state/uiStore';
import { TestHooks } from './TestHooks';

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

  return (
    <div className="app">
      {ready && (
        <Canvas
          className="city-canvas"
          shadows={shadows}
          dpr={dpr}
          camera={{ fov: 40, near: 0.5, far: 2400, position: [170, 205, 235] }}
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
