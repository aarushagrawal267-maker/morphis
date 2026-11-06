/**
 * Night-time warmth at street level:
 * - light spilling onto the pavement in front of shops, cafés and restaurants
 *   that are open right now (from the simulation's building state),
 * - glowing doorways on every building you can walk into,
 * - strings of bulbs hung across the smaller streets.
 * Everything fades in with the night.
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { localToWorld } from '@morphis/sim';
import { useSim } from '../../state/simStore';
import { env } from '../env';

const SHOPS = new Set(['shop', 'cafe', 'restaurant', 'entertainment']);
const BULB_COLORS = ['#ffd27a', '#ffb3d9', '#9be7ff', '#fff1c1', '#c7b3ff'].map((c) => new THREE.Color(c));

export function StreetGlow() {
  const world = useSim((s) => s.world)!;
  const buildingDyn = useSim((s) => s.buildingDyn);
  const spill = useRef<THREE.InstancedMesh>(null);
  const doors = useRef<THREE.InstancedMesh>(null);
  const bulbs = useRef<THREE.InstancedMesh>(null);

  const shops = useMemo(() => world.buildings.filter((b) => SHOPS.has(b.type) && b.tiers.length), [world]);
  const doorList = useMemo(() => world.buildings.filter((b) => b.enterable && b.tiers.length && b.type !== 'hq'), [world]);
  const bulbList = useMemo(() => {
    const out: { x: number; y: number; z: number; c: THREE.Color }[] = [];
    const { nodes, edges } = world.roads;
    for (const e of edges) {
      if (e.cls !== 'street' && e.cls !== 'local') continue;
      const a = nodes[e.a];
      const b = nodes[e.b];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 18) continue;
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      const px = -uz;
      const pz = ux;
      const half = e.width / 2 + e.sidewalk * 0.6;
      let k = 0;
      for (let s = e.setbackA + 5; s < len - e.setbackB - 4; s += 11) {
        // a string across the street, sagging in the middle
        const n = 9;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const off = (t - 0.5) * 2 * half;
          const y = 4.4 - Math.sin(t * Math.PI) * 0.7;
          out.push({ x: a.x + ux * s + px * off, y, z: a.z + uz * s + pz * off, c: BULB_COLORS[(i + k) % BULB_COLORS.length] });
        }
        k++;
      }
    }
    return out;
  }, [world]);

  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const doorGeo = useMemo(() => new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), []);
  const bulbGeo = useMemo(() => new THREE.OctahedronGeometry(0.11, 0), []);
  const spillMat = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 18, 2, 32, 26, 34);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 });
  }, []);
  const doorMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.75, 0.45), toneMapped: false, side: THREE.DoubleSide }), []);
  const bulbMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);

  // pavement spill in front of open shops
  useLayoutEffect(() => {
    const m = spill.current;
    if (!m) return;
    const q = new THREE.Quaternion();
    const warm = new THREE.Color(1.0, 0.72, 0.42);
    shops.forEach((b, i) => {
      const base = b.tiers[0];
      const p = localToWorld(b.position.x, b.position.z, b.rotation, base.ox, base.oz + base.d / 2 + 1.6);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotation);
      m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0.05, p.z), q, new THREE.Vector3(base.w * 1.05, 1, 3.6)));
      const open = (buildingDyn[b.id]?.status ?? 'ACTIVE') === 'ACTIVE';
      m.setColorAt(i, open ? warm : new THREE.Color(0, 0, 0));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [shops, buildingDyn]);

  // doorways on every enterable building (front = local +z)
  useLayoutEffect(() => {
    const m = doors.current;
    if (!m) return;
    const q = new THREE.Quaternion();
    doorList.forEach((b, i) => {
      const base = b.tiers[0];
      const p = localToWorld(b.position.x, b.position.z, b.rotation, base.ox, base.oz + base.d / 2 + 0.03);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotation);
      m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0.02, p.z), q, new THREE.Vector3(1.1, 1.9, 1)));
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [doorList]);

  useLayoutEffect(() => {
    const m = bulbs.current;
    if (!m) return;
    bulbList.forEach((bb, i) => {
      m.setMatrixAt(i, new THREE.Matrix4().makeTranslation(bb.x, bb.y, bb.z));
      m.setColorAt(i, bb.c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [bulbList]);

  useFrame(() => {
    const n = env.uNight.value;
    spillMat.opacity = 0.05 + n * 0.5;
    doorMat.color.setRGB(0.25 + n * 1.0, 0.2 + n * 0.72, 0.15 + n * 0.4);
    const b = 0.35 + n * 1.9;
    bulbMat.color.setRGB(b, b, b);
  });

  return (
    <group name="street-glow">
      <instancedMesh ref={spill} args={[plane, spillMat, Math.max(1, shops.length)]} renderOrder={2} frustumCulled={false} />
      <instancedMesh ref={doors} args={[doorGeo, doorMat, Math.max(1, doorList.length)]} frustumCulled={false} />
      <instancedMesh ref={bulbs} args={[bulbGeo, bulbMat, Math.max(1, bulbList.length)]} frustumCulled={false} />
    </group>
  );
}
