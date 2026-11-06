/**
 * Agent ventures being fitted out: scaffolding and a progress band around the
 * unit's facade, sized to the building, rising with the real fit-out progress.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useSim } from '../../state/simStore';

export function VentureSites() {
  const ventures = useSim((s) => s.ventures);
  const buildings = useSim((s) => s.buildingsById);
  const sites = useMemo(
    () =>
      ventures
        .filter((v) => v.status === 'FITTING_OUT')
        .map((v) => ({ v, b: buildings.get(v.buildingId) }))
        .filter((x): x is { v: (typeof ventures)[number]; b: NonNullable<ReturnType<typeof buildings.get>> } => !!x.b),
    [ventures, buildings],
  );
  const pole = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.6, metalness: 0.4 }), []);
  const band = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#f59e0b').multiplyScalar(2), toneMapped: false }), []);
  return (
    <group name="venture-sites">
      {sites.map(({ v, b }) => {
        const h = Math.min(b.height, 9);
        const w = b.width + 0.8;
        const d = b.depth + 0.8;
        const done = Math.max(0.05, v.progress / Math.max(1, v.work));
        return (
          <group key={v.id} position={[b.position.x, 0, b.position.z]} rotation={[0, b.rotation, 0]}>
            {[-1, 1].flatMap((sx) =>
              [-1, 1].map((sz) => (
                <mesh key={`${sx}${sz}`} position={[(sx * w) / 2, h / 2, (sz * d) / 2]} material={pole}>
                  <boxGeometry args={[0.18, h, 0.18]} />
                </mesh>
              )),
            )}
            {[0.33, 0.66, 1].map((f) => (
              <mesh key={f} position={[0, h * f, d / 2]} material={pole}>
                <boxGeometry args={[w, 0.12, 0.12]} />
              </mesh>
            ))}
            <mesh position={[0, h * done, d / 2 + 0.12]} material={band}>
              <boxGeometry args={[w, 0.16, 0.06]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
