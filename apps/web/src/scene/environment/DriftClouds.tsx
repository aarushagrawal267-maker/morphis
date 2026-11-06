/** Soft clouds drifting past the island at different heights (sprites, cheap). */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { env } from '../env';

function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 9; i++) {
    const x = 34 + Math.random() * 60;
    const y = 50 + Math.random() * 28;
    const r = 18 + Math.random() * 26;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const COUNT = 26;

export function DriftClouds() {
  const group = useRef<THREE.Group>(null);
  const tex = useMemo(() => cloudTexture(), []);
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5, fog: true }), [tex]);
  const clouds = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => {
        const a = (i / COUNT) * Math.PI * 2 + Math.random() * 0.3;
        return { a, r: 190 + Math.random() * 240, y: -45 + Math.random() * 80, s: 40 + Math.random() * 70, speed: 0.004 + Math.random() * 0.006 };
      }),
    [],
  );
  const day = useMemo(() => new THREE.Color('#ffffff'), []);
  const night = useMemo(() => new THREE.Color('#5a6aa8'), []);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    mat.color.copy(day).lerp(night, env.uNight.value);
    mat.opacity = 0.42 - env.uNight.value * 0.12 + env.uRain.value * 0.2;
    g.children.forEach((s, i) => {
      const c = clouds[i];
      c.a += c.speed * dt;
      s.position.set(Math.cos(c.a) * c.r, c.y, Math.sin(c.a) * c.r);
    });
  });
  return (
    <group ref={group} name="drift-clouds">
      {clouds.map((c, i) => (
        <sprite key={i} material={mat} scale={[c.s, c.s * 0.45, 1]} />
      ))}
    </group>
  );
}
