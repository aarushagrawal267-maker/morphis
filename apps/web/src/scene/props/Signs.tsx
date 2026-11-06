/**
 * Illuminated building signs (named landmarks and storefronts) from a
 * canvas-generated text atlas.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import type { BuildingDef } from '@morphis/shared';
import { localToWorld } from '@morphis/sim';
import { useSim } from '../../state/simStore';
import { env } from '../env';
import { NEON } from './neonColors';
import { signAtlas } from './textures';

interface SignPlacement {
  b: BuildingDef;
  x: number;
  y: number;
  z: number;
  rot: number;
  w: number;
  h: number;
  cell: number;
}

const brightness = { value: 1 };

export function Signs() {
  const world = useSim((s) => s.world)!;
  const { atlas, placements } = useMemo(() => {
    const signed = world.buildings.filter((b) => b.sign && b.tiers.length && b.type !== 'hq');
    const entries = signed.map((b, i) => ({ text: b.sign!, color: b.neon?.color ?? NEON[i % NEON.length] }));
    const atlas = signAtlas(entries);
    const placements: SignPlacement[] = signed.map((b, i) => {
      const base = b.tiers[0];
      const tall = b.height > 26;
      const w = Math.min(base.w * 0.82, tall ? 12 : 7.5);
      const h = w / 4;
      const y = tall ? Math.min(b.height - h - 1.5, base.y0 + base.h - h - 1) : Math.min(base.h - h * 0.5 - 0.3, 3.4);
      const p = localToWorld(b.position.x, b.position.z, b.rotation, base.ox, base.oz + base.d / 2 + 0.08);
      return { b, x: p.x, y: Math.max(1.2, y), z: p.z, rot: b.rotation, w, h, cell: i };
    });
    return { atlas, placements };
  }, [world]);

  useFrame(() => {
    brightness.value = 0.7 + env.uNight.value * 1.6;
  });

  return (
    <group name="signs">
      {placements.map((p) => (
        <Sign key={p.b.id} p={p} atlas={atlas} />
      ))}
    </group>
  );
}

function Sign({ p, atlas }: { p: SignPlacement; atlas: ReturnType<typeof signAtlas> }) {
  const mat = useMemo(() => {
    const t = atlas.texture.clone();
    t.repeat.set(1 / atlas.cols, 1 / atlas.rows);
    t.offset.set((p.cell % atlas.cols) / atlas.cols, 1 - (Math.floor(p.cell / atlas.cols) + 1) / atlas.rows);
    t.needsUpdate = true;
    return new THREE.MeshBasicMaterial({ map: t, toneMapped: false, transparent: true });
  }, [atlas, p.cell]);
  useFrame(() => mat.color.setScalar(brightness.value));
  return (
    <mesh position={[p.x, p.y, p.z]} rotation-y={p.rot} material={mat}>
      <planeGeometry args={[p.w, p.h]} />
    </mesh>
  );
}
