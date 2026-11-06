/** Distant skyline beyond the city limits (low detail, fades into the haze). */
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSim } from '../../state/simStore';
import { createBuildingMaterial } from '../buildings/buildingMaterial';
import { PALETTE } from '../env';

export function Skyline() {
  const world = useSim((s) => s.world)!;
  const ref = useRef<THREE.InstancedMesh>(null);
  const blocks = world.skyline;
  const mat = useMemo(() => createBuildingMaterial('box'), []);
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    g.setAttribute('aBuild', new THREE.InstancedBufferAttribute(new Float32Array(blocks.length * 4), 4));
    return g;
  }, [blocks.length]);
  useLayoutEffect(() => {
    const m = ref.current!;
    const attr = geo.getAttribute('aBuild') as THREE.InstancedBufferAttribute;
    const q = new THREE.Quaternion();
    blocks.forEach((b, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(b.x, b.z));
      m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(b.w, b.h, b.d)));
      m.setColorAt(i, PALETTE[i % 3 === 0 ? 1 : 6]);
      attr.setXYZW(i, (i * 0.618) % 1, 0.7, i % 4 === 0 ? 0 : 1, 0.05);
    });
    m.count = blocks.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    attr.needsUpdate = true;
    m.computeBoundingSphere();
  }, [blocks, geo]);
  return <instancedMesh ref={ref} args={[geo, mat, Math.max(1, blocks.length)]} frustumCulled={false} />;
}
