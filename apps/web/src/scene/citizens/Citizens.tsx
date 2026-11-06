/**
 * Citizens: a single instanced mesh with a vertex-shader walk cycle.
 * Visible citizens are exactly those outdoors in the simulation (walking,
 * waiting at bus stops, spending time in parks).
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CORE_ROLES } from '@morphis/shared';
import { simClient } from '../../sim/client';
import { useSim } from '../../state/simStore';
import { useGuest } from '../../state/guestStore';
import { useUI } from '../../state/uiStore';
import { env } from '../env';
import { hash01, parkSpot, stopSpot } from '../positions';
import { platformSpot } from '../rail/railGeo';
import { attachWaveListener, waveAmount, waves } from '../waves';

const K = 0.82; // overall scale: ~1.8 m tall (1 unit = 2 m)

/**
 * A stylised person (about 1.8 m): legs, flared coat, torso, neck, round head,
 * hair cap, arms and hands. Each vertex carries a part id used by the shader
 * for colours and the walk / wave animation:
 * 0 torso, 1 head and neck, 2/3 legs, 4/5 sleeves, 6 hair, 7 coat hem, 8/9 hands.
 */
export function characterGeometry(): THREE.BufferGeometry {
  const parts: { g: THREE.BufferGeometry; part: number }[] = [];
  const add = (g: THREE.BufferGeometry, part: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.scale(sx, sy, sz);
    ng.translate(x, y, z);
    parts.push({ g: ng, part });
  };
  // legs with shoes
  for (const [side, part] of [[-1, 2], [1, 3]] as const) {
    add(new THREE.CylinderGeometry(0.058, 0.046, 0.5, 7), part, side * 0.068, 0.27, 0);
    add(new THREE.BoxGeometry(0.085, 0.05, 0.15), part, side * 0.068, 0.025, 0.03);
  }
  // coat hem (flares over the hips), torso, shoulders
  add(new THREE.CylinderGeometry(0.15, 0.2, 0.3, 10), 7, 0, 0.5, 0);
  add(new THREE.CylinderGeometry(0.16, 0.148, 0.34, 10), 0, 0, 0.8, 0, 1, 1, 0.82);
  add(new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0, 0.955, 0, 1.12, 0.42, 0.8);
  // neck and head
  add(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 7), 1, 0, 1.0, 0);
  add(new THREE.IcosahedronGeometry(0.1, 2), 1, 0, 1.115, 0.005, 0.95, 1.08, 1);
  // hair cap (covers the top and back of the head)
  add(new THREE.SphereGeometry(0.108, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), 6, 0, 1.13, -0.008, 1, 1.02, 1.04);
  // hair at the back of the head, down to the nape
  add(new THREE.SphereGeometry(0.104, 10, 6, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.45), 6, 0, 1.11, -0.012, 1.02, 1.05, 1.06);
  // arms (sleeves) and hands
  for (const [side, sleeve, hand] of [[-1, 4, 8], [1, 5, 9]] as const) {
    add(new THREE.CylinderGeometry(0.045, 0.04, 0.4, 7), sleeve, side * 0.2, 0.74, 0);
    add(new THREE.IcosahedronGeometry(0.042, 1), hand, side * 0.2, 0.52, 0.01);
  }
  const total = parts.reduce((a, p) => a + p.g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const part = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    p.g.scale(K, K, K);
    p.g.computeVertexNormals();
    const n = p.g.getAttribute('position').count;
    pos.set(p.g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(p.g.getAttribute('normal').array as Float32Array, o * 3);
    part.fill(p.part, o, o + n);
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  return out;
}

export function citizenMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = env.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        attribute float aPart; attribute vec2 aAnim; attribute float aWave; attribute vec3 aTop; attribute vec3 aBottom; attribute vec3 aSkin; attribute vec3 aHair;
        varying vec3 vPartColor;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
        float sw = sin(uTime * 8.5 + aAnim.x) * 0.55 * aAnim.y;
        bool leg = aPart > 1.5 && aPart < 3.5;
        bool arm = (aPart > 3.5 && aPart < 5.5) || aPart > 7.5;
        bool rightSide = aPart > 4.5 && aPart < 5.5 || aPart > 8.5;
        if (leg) {
          float s = aPart < 2.5 ? sw : -sw; float py = 0.52 * ${K.toFixed(3)};
          transformed.y -= py;
          transformed = vec3(transformed.x, transformed.y * cos(s) - transformed.z * sin(s), transformed.y * sin(s) + transformed.z * cos(s));
          transformed.y += py;
        } else if (arm) {
          float s = (rightSide ? sw : -sw) * 0.8; float py = 0.93 * ${K.toFixed(3)};
          transformed.y -= py;
          transformed = vec3(transformed.x, transformed.y * cos(s) - transformed.z * sin(s), transformed.y * sin(s) + transformed.z * cos(s));
          transformed.y += py;
        }
        // coat hem sways a little while walking
        if (aPart > 6.5 && aPart < 7.5) transformed.z += sin(uTime * 8.5 + aAnim.x + transformed.x * 9.0) * 0.012 * aAnim.y * step(transformed.y, 0.5 * ${K.toFixed(3)});
        // waving: raise the right arm and wave it
        if (arm && rightSide && aWave > 0.01) {
          float wa = aWave * (2.55 + 0.35 * sin(uTime * 11.0));
          vec2 piv = vec2(0.2 * ${K.toFixed(3)}, 0.93 * ${K.toFixed(3)});
          vec2 q = transformed.xy - piv;
          transformed.xy = piv + vec2(q.x * cos(wa) - q.y * sin(wa), q.x * sin(wa) + q.y * cos(wa));
        }
        // gentle bob while walking, breathing sway when standing
        transformed.y += abs(sin(uTime * 8.5 + aAnim.x)) * 0.03 * aAnim.y;
        transformed.x += sin(uTime * 1.3 + aAnim.x) * 0.01 * (1.0 - aAnim.y) * step(0.5, transformed.y);
        vPartColor = aPart < 0.5 ? aTop : (aPart < 1.5 ? aSkin : (aPart < 3.5 ? aBottom : (aPart < 5.5 ? aTop : (aPart < 6.5 ? aHair : (aPart < 7.5 ? aTop * 0.82 : aSkin)))));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPartColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vPartColor;');
  };
  m.customProgramCacheKey = () => 'morphis-citizen';
  return m;
}

export function Citizens() {
  const profiles = useSim((s) => s.citizens);
  attachWaveListener();
  const n = Math.max(1, profiles.length);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const pickRef = useRef<THREE.InstancedMesh>(null);
  const markerRef = useRef<THREE.InstancedMesh>(null);
  const instanceToCitizen = useRef(new Int32Array(n));

  const geo = useMemo(() => {
    const g = characterGeometry();
    const col = (attr: string, f: (i: number) => string) => {
      const arr = new Float32Array(n * 3);
      const c = new THREE.Color();
      for (let i = 0; i < profiles.length; i++) {
        c.set(f(i)).convertSRGBToLinear();
        arr.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute(attr, new THREE.InstancedBufferAttribute(arr, 3));
    };
    col('aTop', (i) => profiles[i].appearance.top);
    col('aBottom', (i) => profiles[i].appearance.bottom);
    col('aSkin', (i) => profiles[i].appearance.skin);
    col('aHair', (i) => profiles[i].appearance.hair);
    g.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('aWave', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    return g;
  }, [profiles, n]);
  const mat = useMemo(() => citizenMaterial(), []);
  const pickGeo = useMemo(() => new THREE.BoxGeometry(1.6, 2.2, 1.6).translate(0, 1.1, 0), []);
  const pickMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }), []);
  const markerGeo = useMemo(() => new THREE.OctahedronGeometry(0.22, 0), []);
  const markerMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const roleColors = useMemo(
    () =>
      profiles.map((p) =>
        p.role ? new THREE.Color(CORE_ROLES[p.role].color).multiplyScalar(2.2) : p.agent ? new THREE.Color(2.6, 1.7, 0.35) : new THREE.Color(0.6, 2.0, 2.4),
      ),
    [profiles],
  );

  const tmpM = useMemo(() => new THREE.Matrix4(), []);
  const tmpQ = useMemo(() => new THREE.Quaternion(), []);
  const tmpP = useMemo(() => new THREE.Vector3(), []);
  const tmpS = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(() => {
    const mesh = meshRef.current;
    const pick = pickRef.current;
    const marker = markerRef.current;
    const sample = simClient.sampleMotion();
    const sim = useSim.getState();
    if (!mesh || !pick || !marker || !sample || !sim.state) return;
    const ui = useUI.getState();
    const highlight = ui.highlight === 'pedestrians';
    const selected = ui.selection?.kind === 'citizen' ? ui.selection.id : null;
    const walkingGuest = useGuest.getState().active;
    const anim = geo.getAttribute('aAnim') as THREE.InstancedBufferAttribute;
    const waveAttr = geo.getAttribute('aWave') as THREE.InstancedBufferAttribute;
    const now = performance.now();
    const rail = sim.world?.rail;
    const dyn = sim.state.citizens;
    let k = 0;
    let mk = 0;
    const lateral = 0.55;
    for (let i = 0; i < profiles.length; i++) {
      let x: number;
      let z: number;
      let yaw: number;
      let walking = 0;
      let y = 0.12;
      if (sample.cVisible[i]) {
        // keep walkers on their side of the sidewalk
        const off = (hash01(i) - 0.5) * lateral;
        x = sample.cX[i] - sample.cDZ[i] * off;
        z = sample.cZ[i] + sample.cDX[i] * off;
        yaw = Math.atan2(sample.cDX[i], sample.cDZ[i]);
        walking = 1;
      } else {
        const d = dyn[i];
        if (!d) continue;
        const loc = d.location;
        if (loc.kind === 'stop') {
          const p = stopSpot(loc.id, i);
          if (!p) continue;
          x = p.x;
          z = p.z;
          yaw = hash01(i + 9) * 6.28;
        } else if (loc.kind === 'rail' && rail && loc.id.startsWith('rail_st')) {
          const p = platformSpot(rail, loc.id, i);
          if (!p) continue;
          x = p.x;
          z = p.z;
          y = p.y;
          yaw = hash01(i + 9) * 6.28;
        } else if (loc.kind === 'building') {
          const b = sim.buildingsById.get(loc.id);
          if (!b || (b.type !== 'park' && b.type !== 'plaza')) continue;
          const p = parkSpot(b, i, sample.time);
          x = p.x;
          z = p.z;
          yaw = p.dir;
          walking = hash01(i + 5) > 0.6 ? 0.35 : 0;
        } else continue;
      }
      const wv = waves.size ? waveAmount(i, now) : 0;
      if (wv > 0) {
        const w = waves.get(i)!;
        yaw = Math.atan2(w.x - x, w.z - z);
        walking = 0;
      }
      const h = profiles[i].appearance.height;
      tmpQ.setFromAxisAngle(up, yaw);
      tmpP.set(x, y, z);
      tmpS.set(profiles[i].appearance.build, h, profiles[i].appearance.build);
      tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(k, tmpM);
      pick.setMatrixAt(k, tmpM);
      anim.setXY(k, hash01(i) * 6.28, walking);
      waveAttr.setX(k, wv);
      instanceToCitizen.current[k] = i;
      k++;
      if (((profiles[i].core || profiles[i].agent) && !walkingGuest) || highlight || selected === profiles[i].id) {
        const s = selected === profiles[i].id ? (walkingGuest ? 0.9 : 2.2) : highlight ? 1.4 : 0.8;
        tmpS.set(s, s * 1.4, s);
        tmpP.set(x, y + 1.45 + Math.sin(env.uTime.value * 3 + i) * 0.08, z);
        tmpQ.setFromAxisAngle(up, env.uTime.value * 2);
        tmpM.compose(tmpP, tmpQ, tmpS);
        marker.setMatrixAt(mk, tmpM);
        marker.setColorAt(mk, selected === profiles[i].id ? new THREE.Color(3, 2.6, 0.4) : roleColors[i]);
        mk++;
      }
    }
    mesh.count = k;
    pick.count = k;
    marker.count = mk;
    mesh.instanceMatrix.needsUpdate = true;
    pick.instanceMatrix.needsUpdate = true;
    marker.instanceMatrix.needsUpdate = true;
    if (marker.instanceColor) marker.instanceColor.needsUpdate = true;
    anim.needsUpdate = true;
    waveAttr.needsUpdate = true;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || e.instanceId === undefined) return;
    e.stopPropagation();
    const idx = instanceToCitizen.current[e.instanceId];
    const p = profiles[idx];
    if (p) useUI.getState().select({ kind: 'citizen', id: p.id });
  };

  return (
    <group name="citizens">
      <instancedMesh ref={meshRef} args={[geo, mat, n]} castShadow frustumCulled={false} />
      <instancedMesh
        ref={pickRef}
        args={[pickGeo, pickMat, n]}
        frustumCulled={false}
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => (document.body.style.cursor = '')}
      />
      <instancedMesh ref={markerRef} args={[markerGeo, markerMat, n]} frustumCulled={false} />
    </group>
  );
}
