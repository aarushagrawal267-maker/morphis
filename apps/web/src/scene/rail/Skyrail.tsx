/**
 * Skyrail: elevated maglev track over the avenues, kerb-side pylons, stations
 * with stair towers, and the trains (positions from the simulation).
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RailLine } from '@morphis/shared';
import { simClient } from '../../sim/client';
import { useSim } from '../../state/simStore';
import { railPoint } from './railGeo';

const CARS = 3;
const CAR_LEN = 3.4;

export function Skyrail() {
  const line = useSim((s) => s.world?.rail);
  if (!line) return null;
  return <SkyrailLine line={line} />;
}

function SkyrailLine({ line }: { line: RailLine }) {
  const H = line.height;
  const n = line.points.length / 2;
  const glow = useMemo(() => new THREE.Color(line.color).multiplyScalar(2.4), [line.color]);

  const { beams, rails, columns, arms, platforms, canopies, towers, bridges } = useMemo(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const beams: THREE.Matrix4[] = [];
    const rails: THREE.Matrix4[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = line.points[i * 2];
      const az = line.points[i * 2 + 1];
      const bx = line.points[j * 2];
      const bz = line.points[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const yaw = Math.atan2(bx - ax, bz - az);
      q.setFromAxisAngle(up, yaw);
      beams.push(m.clone().compose(new THREE.Vector3((ax + bx) / 2, H - 0.35, (az + bz) / 2), q, new THREE.Vector3(1.7, 0.55, len + 0.25)));
      for (const side of [-1, 1]) {
        const ox = Math.cos(yaw) * side * 0.62;
        const oz = -Math.sin(yaw) * side * 0.62;
        rails.push(m.clone().compose(new THREE.Vector3((ax + bx) / 2 + ox, H - 0.02, (az + bz) / 2 + oz), q, new THREE.Vector3(0.09, 0.1, len + 0.25)));
      }
    }
    const columns: THREE.Matrix4[] = [];
    const arms: THREE.Matrix4[] = [];
    for (const p of line.pylons) {
      columns.push(m.clone().compose(new THREE.Vector3(p.x, (H - 0.3) / 2, p.z), new THREE.Quaternion(), new THREE.Vector3(0.55, H - 0.3, 0.55)));
      const len = Math.hypot(p.tx - p.x, p.tz - p.z);
      q.setFromAxisAngle(up, Math.atan2(p.tx - p.x, p.tz - p.z));
      arms.push(m.clone().compose(new THREE.Vector3((p.x + p.tx) / 2, H - 0.75, (p.z + p.tz) / 2), q, new THREE.Vector3(0.45, 0.4, len + 0.3)));
    }
    const platforms: THREE.Matrix4[] = [];
    const canopies: THREE.Matrix4[] = [];
    const towers: THREE.Matrix4[] = [];
    const bridges: THREE.Matrix4[] = [];
    const t = { x: 0, z: 0, dx: 0, dz: 0 };
    for (const st of line.stations) {
      railPoint(line, st.s, t);
      const yaw = Math.atan2(t.dx, t.dz);
      q.setFromAxisAngle(up, yaw);
      for (const side of [-1, 1]) {
        const ox = -t.dz * side * 1.95;
        const oz = t.dx * side * 1.95;
        platforms.push(m.clone().compose(new THREE.Vector3(t.x + ox, H - 0.2, t.z + oz), q, new THREE.Vector3(2.2, 0.3, 13)));
        canopies.push(m.clone().compose(new THREE.Vector3(t.x + ox * 1.1, H + 2.9, t.z + oz * 1.1), q, new THREE.Vector3(2.6, 0.12, 12)));
      }
      towers.push(m.clone().compose(new THREE.Vector3(st.access.x, H / 2, st.access.z), new THREE.Quaternion(), new THREE.Vector3(2.2, H + 0.4, 2.2)));
      // walkway from the stair tower to the nearer platform
      const side = (st.access.x - t.x) * -t.dz + (st.access.z - t.z) * t.dx > 0 ? 1 : -1;
      const px = t.x - t.dz * side * 2.9;
      const pz = t.z + t.dx * side * 2.9;
      const len = Math.hypot(px - st.access.x, pz - st.access.z);
      q.setFromAxisAngle(up, Math.atan2(px - st.access.x, pz - st.access.z));
      bridges.push(m.clone().compose(new THREE.Vector3((px + st.access.x) / 2, H - 0.25, (pz + st.access.z) / 2), q, new THREE.Vector3(1.6, 0.25, len)));
    }
    return { beams, rails, columns, arms, platforms, canopies, towers, bridges };
  }, [line, n, H]);

  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const concrete = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2f3d', roughness: 0.75, metalness: 0.35 }), []);
  const steel = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3b4252', roughness: 0.5, metalness: 0.7 }), []);
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: glow, toneMapped: false }), [glow]);
  const glass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.55, emissive: new THREE.Color(line.color), emissiveIntensity: 0.25 }), [line.color]);

  return (
    <group name="skyrail">
      <Instances geo={box} mat={concrete} list={beams} shadows />
      <Instances geo={box} mat={glowMat} list={rails} />
      <Instances geo={box} mat={steel} list={columns} shadows />
      <Instances geo={box} mat={steel} list={arms} />
      <Instances geo={box} mat={concrete} list={platforms} shadows />
      <Instances geo={box} mat={glass} list={canopies} />
      <Instances geo={box} mat={steel} list={towers} shadows />
      <Instances geo={box} mat={concrete} list={bridges} />
      <Trains line={line} />
    </group>
  );
}

function Instances({ geo, mat, list, shadows }: { geo: THREE.BufferGeometry; mat: THREE.Material; list: THREE.Matrix4[]; shadows?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    list.forEach((x, i) => m.setMatrixAt(i, x));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [list]);
  if (!list.length) return null;
  return <instancedMesh ref={ref} args={[geo, mat, list.length]} castShadow={shadows} receiveShadow={shadows} />;
}

function Trains({ line }: { line: RailLine }) {
  const body = useRef<THREE.InstancedMesh>(null);
  const windows = useRef<THREE.InstancedMesh>(null);
  const max = 4 * CARS;
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const bodyMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.3, metalness: 0.6 }), []);
  const winMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(line.color).multiplyScalar(2), toneMapped: false }), [line.color]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const p = useMemo(() => ({ x: 0, z: 0, dx: 0, dz: 0 }), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const b = body.current;
    const w = windows.current;
    const sample = simClient.sampleMotion();
    if (!b || !w || !sample) return;
    let k = 0;
    for (const s of sample.rail) {
      for (let c = 0; c < CARS && k < max; c++) {
        railPoint(line, s - c * (CAR_LEN + 0.25) - CAR_LEN / 2, p);
        q.setFromAxisAngle(up, Math.atan2(p.dx, p.dz));
        pos.set(p.x, line.height + 0.75, p.z);
        scl.set(1.5, 1.25, CAR_LEN);
        m.compose(pos, q, scl);
        b.setMatrixAt(k, m);
        pos.y = line.height + 0.95;
        scl.set(1.54, 0.32, CAR_LEN * 0.86);
        m.compose(pos, q, scl);
        w.setMatrixAt(k, m);
        k++;
      }
    }
    b.count = k;
    w.count = k;
    b.instanceMatrix.needsUpdate = true;
    w.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={body} args={[geo, bodyMat, max]} castShadow frustumCulled={false} />
      <instancedMesh ref={windows} args={[geo, winMat, max]} frustumCulled={false} />
    </>
  );
}
