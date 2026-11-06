import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RoadClass } from '@morphis/shared';
import { useSim } from '../../state/simStore';
import { simClient } from '../../sim/client';
import { env } from '../env';
import { buildCarriageways, buildJunctions, buildMarkings, buildSidewalks, roadTextures, tileTexture, type BarInstance } from './roadGeometry';

const CLASSES: RoadClass[] = ['highway', 'avenue', 'street', 'local'];
const unitBox = new THREE.BoxGeometry(1, 1, 1);

function Bars({ items, color, emissive, y }: { items: BarInstance[]; color: string; emissive: number; y: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: emissive, roughness: 0.6 }), [color, emissive]);
  useLayoutEffect(() => {
    const m = ref.current!;
    const q = new THREE.Quaternion();
    const ax = new THREE.Vector3(0, 1, 0);
    items.forEach((b, i) => {
      q.setFromAxisAngle(ax, b.rot);
      m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(b.x, y, b.z), q, new THREE.Vector3(b.len, 0.02, b.width)));
    });
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items, y]);
  useFrame(() => {
    mat.emissiveIntensity = emissive * (0.3 + env.uNight.value * 0.9);
  });
  return <instancedMesh ref={ref} args={[unitBox, mat, Math.max(1, items.length)]} receiveShadow frustumCulled={false} />;
}

export function Roads() {
  const world = useSim((s) => s.world)!;
  const geo = useMemo(() => buildCarriageways(world), [world]);
  const junctions = useMemo(() => buildJunctions(world), [world]);
  const sidewalks = useMemo(() => buildSidewalks(world), [world]);
  const markings = useMemo(() => buildMarkings(world), [world]);

  const mats = useMemo(() => {
    const out = {} as Record<RoadClass, THREE.MeshStandardMaterial>;
    for (const c of CLASSES) {
      const t = roadTextures(c);
      out[c] = new THREE.MeshStandardMaterial({
        map: t.map,
        emissiveMap: t.glow,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 0.05,
        roughness: 0.85,
        metalness: 0.05,
      });
    }
    return out;
  }, []);
  const junctionMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.88, metalness: 0.05 }), []);
  const sidewalkMat = useMemo(() => {
    const t = tileTexture('#3b3f47', 'rgba(15,17,22,0.55)', 3);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, color: '#9aa1ad' });
  }, []);
  const kerbMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5b616c', roughness: 0.7 }), []);

  useFrame(() => {
    const wet = env.uWet.value;
    const night = env.uNight.value;
    for (const c of CLASSES) {
      const m = mats[c];
      m.roughness = 0.85 - wet * 0.62;
      m.metalness = 0.05 + wet * 0.35;
      m.envMapIntensity = 0.35 + wet * 1.6;
      m.emissiveIntensity = 0.02 + night * (c === 'avenue' || c === 'highway' ? 0.55 : 0.25);
    }
    junctionMat.roughness = 0.88 - wet * 0.62;
    junctionMat.metalness = 0.05 + wet * 0.35;
    junctionMat.envMapIntensity = 0.35 + wet * 1.6;
    sidewalkMat.roughness = 0.9 - wet * 0.5;
  });

  return (
    <group name="roads">
      {CLASSES.map((c) => (
        <mesh key={c} geometry={geo[c]} material={mats[c]} receiveShadow />
      ))}
      <mesh geometry={junctions} material={junctionMat} receiveShadow />
      <mesh geometry={sidewalks.top} material={sidewalkMat} receiveShadow />
      <mesh geometry={sidewalks.kerb} material={kerbMat} />
      <Bars items={markings.stripes} color="#d9dde3" emissive={0.15} y={0.045} />
      <Bars items={markings.stopLines} color="#e5e7eb" emissive={0.1} y={0.045} />
      <TrafficLights />
    </group>
  );
}

/** Signal heads coloured from the live signal phases of the simulation. */
function TrafficLights() {
  const world = useSim((s) => s.world)!;
  const data = useMemo(() => {
    const signalNodes = world.roads.nodes.filter((n) => n.signal).map((n) => n.id);
    const sigIndex = new Map(signalNodes.map((id, i) => [id, i]));
    const heads: { x: number; z: number; rot: number; sig: number; group: number }[] = [];
    for (const n of world.roads.nodes) {
      if (!n.signal) continue;
      for (const eid of n.edges) {
        const e = world.roads.edges[eid];
        const other = world.roads.nodes[e.a === n.id ? e.b : e.a];
        const l = Math.hypot(other.x - n.x, other.z - n.z) || 1;
        const dx = (other.x - n.x) / l;
        const dz = (other.z - n.z) / l;
        const sb = (e.a === n.id ? e.setbackA : e.setbackB) + 0.4;
        const off = e.width / 2 + 0.45;
        // right-hand kerb of traffic approaching the node: -perp(d)
        const x = n.x + dx * sb + dz * off;
        const z = n.z + dz * sb - dx * off;
        heads.push({ x, z, rot: Math.atan2(dx, dz), sig: sigIndex.get(n.id)!, group: e.a === n.id ? e.groupA : e.groupB });
      }
    }
    return { heads };
  }, [world]);

  const poleRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const lampRef = useRef<THREE.InstancedMesh>(null);
  const poleGeo = useMemo(() => new THREE.CylinderGeometry(0.07, 0.09, 3.4, 6).translate(0, 1.7, 0), []);
  const headGeo = useMemo(() => new THREE.BoxGeometry(0.34, 1.0, 0.3).translate(0, 3.0, 0), []);
  const lampGeo = useMemo(() => new THREE.SphereGeometry(0.15, 8, 6), []);
  const poleMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2e35', metalness: 0.6, roughness: 0.5 }), []);
  const lampMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const colors = useMemo(
    () => ({ red: new THREE.Color(4, 0.2, 0.15), yellow: new THREE.Color(4, 2.4, 0.2), green: new THREE.Color(0.2, 4, 1.2) }),
    [],
  );
  const lampY = { red: 3.3, yellow: 3.0, green: 2.7 } as const;

  useLayoutEffect(() => {
    const q = new THREE.Quaternion();
    const ax = new THREE.Vector3(0, 1, 0);
    data.heads.forEach((h, i) => {
      q.setFromAxisAngle(ax, h.rot);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(h.x, 0, h.z), q, new THREE.Vector3(1, 1, 1));
      poleRef.current!.setMatrixAt(i, m);
      headRef.current!.setMatrixAt(i, m);
    });
    for (const r of [poleRef, headRef]) {
      r.current!.count = data.heads.length;
      r.current!.instanceMatrix.needsUpdate = true;
      r.current!.computeBoundingSphere();
    }
  }, [data]);

  const tmpM = useMemo(() => new THREE.Matrix4(), []);
  const lastKey = useRef('');
  useFrame(() => {
    const lamp = lampRef.current;
    const sample = simClient.sampleMotion();
    if (!lamp || !sample) return;
    const sig = sample.signals;
    const key = sig.join('');
    if (key === lastKey.current) return;
    lastKey.current = key;
    data.heads.forEach((h, i) => {
      const ph = sig[h.sig] ?? 2;
      const g = h.group === 0 ? 0 : 3;
      const state = ph === g ? 'green' : ph === g + 1 ? 'yellow' : 'red';
      // lamp faces the approaching traffic (towards +d from the pole)
      const fx = Math.sin(h.rot) * 0.18;
      const fz = Math.cos(h.rot) * 0.18;
      tmpM.makeTranslation(h.x + fx, lampY[state], h.z + fz);
      lamp.setMatrixAt(i, tmpM);
      lamp.setColorAt(i, colors[state]);
    });
    lamp.count = data.heads.length;
    lamp.instanceMatrix.needsUpdate = true;
    if (lamp.instanceColor) lamp.instanceColor.needsUpdate = true;
  });

  return (
    <group name="traffic-lights">
      <instancedMesh ref={poleRef} args={[poleGeo, poleMat, Math.max(1, data.heads.length)]} frustumCulled={false} />
      <instancedMesh ref={headRef} args={[headGeo, poleMat, Math.max(1, data.heads.length)]} frustumCulled={false} />
      <instancedMesh ref={lampRef} args={[lampGeo, lampMat, Math.max(1, data.heads.length)]} frustumCulled={false} />
    </group>
  );
}
