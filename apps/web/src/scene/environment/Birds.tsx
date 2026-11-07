/** Small flocks of birds circling the island by day (instanced, cheap). Hidden at night and in storms. */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { env } from '../env';

const FLOCKS = 4;
const PER = 7;

export function Birds() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    // A flat "V": two thin wings meeting at the body.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -1, 0.25, -0.35, -0.9, 0.2, 0, 0, 0, 0, 1, 0.25, -0.35, 0.9, 0.2, 0], 3));
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#2a2f3a', side: THREE.DoubleSide, transparent: true }), []);
  const flocks = useMemo(
    () => Array.from({ length: FLOCKS }, (_, f) => ({ a: (f / FLOCKS) * Math.PI * 2, r: 90 + f * 35, y: 38 + f * 9, speed: 0.05 + f * 0.012, dir: f % 2 ? -1 : 1 })),
    [],
  );
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }, dt) => {
    const m = mesh.current;
    if (!m) return;
    const show = 1 - Math.max(env.uNight.value * 0.8, env.uRain.value);
    mat.opacity = Math.max(0, Math.min(1, show * 1.4 - 0.2));
    m.visible = mat.opacity > 0.02;
    if (!m.visible) return;
    const t = clock.elapsedTime;
    let i = 0;
    for (const f of flocks) {
      f.a += f.speed * f.dir * dt;
      for (let b = 0; b < PER; b++) {
        const row = Math.ceil(b / 2);
        const side = b === 0 ? 0 : b % 2 ? 1 : -1;
        const a = f.a - f.dir * row * 0.025;
        const r = f.r + side * row * 1.6;
        tmp.position.set(Math.cos(a) * r, f.y + Math.sin(t * 0.7 + b) * 0.6, Math.sin(a) * r);
        tmp.rotation.set(0, -a + (f.dir > 0 ? Math.PI : 0), 0);
        const flap = 0.35 + Math.abs(Math.sin(t * 6 + b * 1.3 + f.a)) * 0.9;
        tmp.scale.set(3.2, flap * 2.6, 3.2);
        tmp.updateMatrix();
        m.setMatrixAt(i++, tmp.matrix);
      }
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geo, mat, FLOCKS * PER]} frustumCulled={false} name="birds" />;
}
