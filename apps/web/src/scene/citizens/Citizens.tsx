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
import { useUI } from '../../state/uiStore';
import { env } from '../env';
import { hash01, parkSpot, stopSpot } from '../positions';

const K = 0.82; // overall scale: ~1.8 m tall (1 unit = 2 m)

function characterGeometry(): THREE.BufferGeometry {
  const parts: { size: [number, number, number]; pos: [number, number, number]; part: number }[] = [
    { size: [0.36, 0.42, 0.22], pos: [0, 0.66, 0], part: 0 },
    { size: [0.2, 0.22, 0.2], pos: [0, 0.99, 0], part: 1 },
    { size: [0.21, 0.07, 0.21], pos: [0, 1.12, -0.01], part: 6 },
    { size: [0.13, 0.46, 0.14], pos: [-0.09, 0.23, 0], part: 2 },
    { size: [0.13, 0.46, 0.14], pos: [0.09, 0.23, 0], part: 3 },
    { size: [0.09, 0.4, 0.1], pos: [-0.23, 0.65, 0], part: 4 },
    { size: [0.09, 0.4, 0.1], pos: [0.23, 0.65, 0], part: 5 },
  ];
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const g = new THREE.BoxGeometry(...p.size).toNonIndexed();
    g.translate(...p.pos);
    g.scale(K, K, K);
    const n = g.getAttribute('position').count;
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(p.part), 1));
    geos.push(g);
  }
  // merge
  const total = geos.reduce((a, g) => a + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const part = new Float32Array(total);
  let o = 0;
  for (const g of geos) {
    const n = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    part.set(g.getAttribute('aPart').array as Float32Array, o);
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  return out;
}

function citizenMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = env.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        attribute float aPart; attribute vec2 aAnim; attribute vec3 aTop; attribute vec3 aBottom; attribute vec3 aSkin; attribute vec3 aHair;
        varying vec3 vPartColor;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
        float sw = sin(uTime * 8.5 + aAnim.x) * 0.62 * aAnim.y;
        if (aPart > 1.5 && aPart < 3.5) {
          float s = aPart < 2.5 ? sw : -sw; float py = 0.46 * ${K.toFixed(3)};
          transformed.y -= py;
          transformed = vec3(transformed.x, transformed.y * cos(s) - transformed.z * sin(s), transformed.y * sin(s) + transformed.z * cos(s));
          transformed.y += py;
        } else if (aPart > 3.5 && aPart < 5.5) {
          float s = (aPart < 4.5 ? -sw : sw) * 0.75; float py = 0.84 * ${K.toFixed(3)};
          transformed.y -= py;
          transformed = vec3(transformed.x, transformed.y * cos(s) - transformed.z * sin(s), transformed.y * sin(s) + transformed.z * cos(s));
          transformed.y += py;
        }
        // idle sway when standing
        transformed.y += abs(sin(uTime * 8.5 + aAnim.x)) * 0.035 * aAnim.y;
        transformed.x += sin(uTime * 1.3 + aAnim.x) * 0.012 * (1.0 - aAnim.y) * step(0.5, transformed.y);
        vPartColor = aPart < 0.5 ? aTop : (aPart < 1.5 ? aSkin : (aPart < 3.5 ? aBottom : (aPart < 5.5 ? aTop : aHair)));`,
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
    return g;
  }, [profiles, n]);
  const mat = useMemo(() => citizenMaterial(), []);
  const pickGeo = useMemo(() => new THREE.BoxGeometry(1.6, 2.2, 1.6).translate(0, 1.1, 0), []);
  const pickMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }), []);
  const markerGeo = useMemo(() => new THREE.OctahedronGeometry(0.22, 0), []);
  const markerMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const roleColors = useMemo(
    () => profiles.map((p) => (p.role ? new THREE.Color(CORE_ROLES[p.role].color).multiplyScalar(2.2) : new THREE.Color(0.6, 2.0, 2.4))),
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
    const anim = geo.getAttribute('aAnim') as THREE.InstancedBufferAttribute;
    const dyn = sim.state.citizens;
    let k = 0;
    let mk = 0;
    const lateral = 0.55;
    for (let i = 0; i < profiles.length; i++) {
      let x: number;
      let z: number;
      let yaw: number;
      let walking = 0;
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
      const h = profiles[i].appearance.height;
      tmpQ.setFromAxisAngle(up, yaw);
      tmpP.set(x, 0.12, z);
      tmpS.set(profiles[i].appearance.build, h, profiles[i].appearance.build);
      tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(k, tmpM);
      pick.setMatrixAt(k, tmpM);
      anim.setXY(k, hash01(i) * 6.28, walking);
      instanceToCitizen.current[k] = i;
      k++;
      if (profiles[i].core || highlight || selected === profiles[i].id) {
        const s = selected === profiles[i].id ? 2.2 : highlight ? 1.4 : 0.8;
        tmpS.set(s, s * 1.4, s);
        tmpP.set(x, 1.55 + Math.sin(env.uTime.value * 3 + i) * 0.08, z);
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
