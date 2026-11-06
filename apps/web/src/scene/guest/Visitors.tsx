/**
 * Hosted towns: share this visitor's position, and draw everyone else who is
 * walking the streets right now (with smooth movement and waving).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { simClient } from '../../sim/client';
import { guestPose, useGuest } from '../../state/guestStore';
import { visitors } from '../../state/presence';
import { useUI } from '../../state/uiStore';
import { characterGeometry, citizenMaterial } from '../citizens/Citizens';

const MAX = 64;

export function PresenceSender() {
  const last = useRef(0);
  const was = useRef(false);
  useFrame(() => {
    const t = simClient.transport;
    if (!t?.presence) return;
    const g = useGuest.getState();
    const now = performance.now();
    if (!g.active) {
      if (was.current) t.presence(null);
      was.current = false;
      return;
    }
    if (now - last.current < 180) return;
    last.current = now;
    was.current = true;
    const inside = useUI.getState().interior?.buildingId ?? null;
    t.presence({
      name: g.name,
      x: Math.round(guestPose.x * 100) / 100,
      y: Math.round(guestPose.y * 100) / 100,
      z: Math.round(guestPose.z * 100) / 100,
      yaw: Math.round(guestPose.yaw * 1000) / 1000,
      moving: guestPose.speed > 0,
      waving: guestPose.waveUntil > now,
      inside,
      look: { coat: g.look.coat, trousers: g.look.trousers, hair: g.look.hair, skin: g.look.skin, build: g.look.build, height: g.look.height },
    });
  });
  return null;
}

export function OtherVisitors() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const g = characterGeometry();
    for (const a of ['aTop', 'aBottom', 'aSkin', 'aHair']) g.setAttribute(a, new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3));
    g.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2));
    g.setAttribute('aWave', new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1));
    return g;
  }, []);
  const mat = useMemo(() => citizenMaterial(), []);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const c = useMemo(() => new THREE.Color(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    let k = 0;
    const set = (name: string, i: number, hex: string) => {
      c.set(hex).convertSRGBToLinear();
      (geo.getAttribute(name) as THREE.InstancedBufferAttribute).setXYZ(i, c.r, c.g, c.b);
    };
    for (const v of visitors.values()) {
      if (k >= MAX || v.inside) continue;
      const f = Math.min(1, dt * 8);
      v.rx += (v.x - v.rx) * f;
      v.rz += (v.z - v.rz) * f;
      v.ry += (v.y - v.ry) * f;
      let d = v.yaw - v.ryaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      v.ryaw += d * f;
      q.setFromAxisAngle(up, v.ryaw);
      m4.compose(new THREE.Vector3(v.rx, v.ry + 0.12, v.rz), q, new THREE.Vector3(v.look.build, v.look.height, v.look.build));
      m.setMatrixAt(k, m4);
      set('aTop', k, v.look.coat);
      set('aBottom', k, v.look.trousers);
      set('aSkin', k, v.look.skin);
      set('aHair', k, v.look.hair);
      (geo.getAttribute('aAnim') as THREE.InstancedBufferAttribute).setXY(k, k * 1.7, v.moving ? 1 : 0);
      (geo.getAttribute('aWave') as THREE.InstancedBufferAttribute).setX(k, v.waving ? 1 : 0);
      k++;
    }
    m.count = k;
    m.instanceMatrix.needsUpdate = true;
    for (const a of ['aTop', 'aBottom', 'aSkin', 'aHair', 'aAnim', 'aWave']) (geo.getAttribute(a) as THREE.InstancedBufferAttribute).needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geo, mat, MAX]} castShadow frustumCulled={false} />;
}
