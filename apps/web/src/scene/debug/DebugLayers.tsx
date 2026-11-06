/** Developer overlays: road graph, pedestrian graph, district bounds, building bounds, destinations, vehicle footprints. */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { localToWorld } from '@morphis/sim';
import { simClient } from '../../sim/client';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';

function Lines({ pts, color, y = 0.3 }: { pts: number[]; color: string; y?: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array((pts.length / 2) * 3);
    for (let i = 0; i < pts.length / 2; i++) arr.set([pts[i * 2], y, pts[i * 2 + 1]], i * 3);
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }, [pts, y]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={color} toneMapped={false} depthTest={false} transparent opacity={0.9} />
    </lineSegments>
  );
}

export function DebugLayers() {
  const debug = useUI((s) => s.debug);
  const layers = useUI((s) => s.debugLayers);
  const world = useSim((s) => s.world)!;
  const roads = useMemo(() => world.roads.edges.flatMap((e) => [world.roads.nodes[e.a].x, world.roads.nodes[e.a].z, world.roads.nodes[e.b].x, world.roads.nodes[e.b].z]), [world]);
  const ped = useMemo(() => world.ped.edges.flatMap((e) => [world.ped.nodes[e.a].x, world.ped.nodes[e.a].z, world.ped.nodes[e.b].x, world.ped.nodes[e.b].z]), [world]);
  const districts = useMemo(
    () =>
      world.districts.flatMap((d) => {
        const out: number[] = [];
        for (let i = 0; i < 48; i++) {
          const a0 = (i / 48) * Math.PI * 2;
          const a1 = ((i + 1) / 48) * Math.PI * 2;
          out.push(d.center.x + Math.cos(a0) * d.radius, d.center.z + Math.sin(a0) * d.radius, d.center.x + Math.cos(a1) * d.radius, d.center.z + Math.sin(a1) * d.radius);
        }
        return out;
      }),
    [world],
  );
  const bounds = useMemo(
    () =>
      world.buildings.flatMap((b) => {
        const c = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([x, z]) => localToWorld(b.position.x, b.position.z, b.rotation, (x * b.width) / 2, (z * b.depth) / 2));
        const out: number[] = [];
        for (let i = 0; i < 4; i++) out.push(c[i].x, c[i].z, c[(i + 1) % 4].x, c[(i + 1) % 4].z);
        return out;
      }),
    [world],
  );
  if (!debug) return null;
  return (
    <group name="debug">
      {layers.roads && <Lines pts={roads} color="#f97316" y={0.5} />}
      {layers.roads && <Signals />}
      {layers.ped && <Lines pts={ped} color="#22d3ee" y={0.45} />}
      {layers.districts && <Lines pts={districts} color="#e879f9" y={0.4} />}
      {layers.bounds && <Lines pts={bounds} color="#a3e635" y={0.35} />}
      {layers.destinations && <Destinations />}
      {layers.collision && <Footprints />}
    </group>
  );
}

function Signals() {
  const world = useSim((s) => s.world)!;
  return (
    <>
      {world.roads.nodes
        .filter((n) => n.signal)
        .map((n) => (
          <mesh key={n.id} position={[n.x, 0.6, n.z]}>
            <sphereGeometry args={[0.7, 8, 6]} />
            <meshBasicMaterial color="#f43f5e" toneMapped={false} depthTest={false} />
          </mesh>
        ))}
    </>
  );
}

function Destinations() {
  const ref = useRef<THREE.LineSegments>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 6000), 3));
    return g;
  }, []);
  useFrame(() => {
    const sample = simClient.sampleMotion();
    const sim = useSim.getState();
    if (!sample || !sim.state) return;
    const arr = geo.getAttribute('position') as THREE.BufferAttribute;
    let k = 0;
    sim.state.citizens.forEach((d, i) => {
      if (!sample.cVisible[i] || !d.destinationId || k >= 6000) return;
      const b = sim.buildingsById.get(d.destinationId);
      if (!b) return;
      arr.setXYZ(k * 2, sample.cX[i], 0.6, sample.cZ[i]);
      arr.setXYZ(k * 2 + 1, b.entrance.x, 0.6, b.entrance.z);
      k++;
    });
    geo.setDrawRange(0, k * 2);
    arr.needsUpdate = true;
  });
  return (
    <lineSegments ref={ref} geometry={geo} frustumCulled={false}>
      <lineBasicMaterial color="#fde047" transparent opacity={0.5} toneMapped={false} depthTest={false} />
    </lineSegments>
  );
}

function Footprints() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const m = ref.current;
    const sample = simClient.sampleMotion();
    const sim = useSim.getState();
    if (!m || !sample) return;
    let k = 0;
    sim.vehicles.forEach((v, i) => {
      if (!sample.vVisible[i]) return;
      tmp.position.set(sample.vX[i], 0.5, sample.vZ[i]);
      tmp.rotation.set(0, Math.atan2(sample.vDX[i], sample.vDZ[i]), 0);
      const len = v.kind === 'bus' ? 6.2 : v.kind === 'delivery' ? 3.4 : 2.3;
      tmp.scale.set(1.2, 1, len);
      tmp.updateMatrix();
      m.setMatrixAt(k++, tmp.matrix);
    });
    m.count = k;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#f43f5e', wireframe: true, toneMapped: false }), 300]} frustumCulled={false} />
  );
}
