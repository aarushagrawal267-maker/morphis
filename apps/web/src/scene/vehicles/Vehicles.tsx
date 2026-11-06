/**
 * Vehicles: one instanced mesh per vehicle kind. Head/tail lights are part of
 * the geometry (vertex attribute aLight) and light up at night; brake lights
 * brighten when the simulated vehicle is stopped.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { VehicleKind } from '@morphis/shared';
import { simClient } from '../../sim/client';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { env } from '../env';

type Part = { size: [number, number, number]; pos: [number, number, number]; light: number };

const SHAPES: Record<'car' | 'taxi' | 'bus' | 'delivery', Part[]> = {
  car: [
    { size: [1.0, 0.42, 2.3], pos: [0, 0.38, 0], light: 0 },
    { size: [0.88, 0.36, 1.2], pos: [0, 0.76, -0.1], light: 3 },
    { size: [0.22, 0.1, 0.04], pos: [-0.32, 0.45, 1.16], light: 1 },
    { size: [0.22, 0.1, 0.04], pos: [0.32, 0.45, 1.16], light: 1 },
    { size: [0.26, 0.08, 0.04], pos: [-0.33, 0.48, -1.16], light: 2 },
    { size: [0.26, 0.08, 0.04], pos: [0.33, 0.48, -1.16], light: 2 },
    { size: [1.04, 0.24, 0.44], pos: [0, 0.12, 0.7], light: 5 },
    { size: [1.04, 0.24, 0.44], pos: [0, 0.12, -0.7], light: 5 },
  ],
  taxi: [],
  bus: [
    { size: [1.25, 1.35, 6.2], pos: [0, 0.95, 0], light: 0 },
    { size: [1.27, 0.5, 5.6], pos: [0, 1.22, 0.1], light: 3 },
    { size: [1.27, 0.08, 6.0], pos: [0, 0.62, 0], light: 4 },
    { size: [0.28, 0.12, 0.04], pos: [-0.4, 0.55, 3.1], light: 1 },
    { size: [0.28, 0.12, 0.04], pos: [0.4, 0.55, 3.1], light: 1 },
    { size: [0.3, 0.12, 0.04], pos: [-0.42, 0.6, -3.1], light: 2 },
    { size: [0.3, 0.12, 0.04], pos: [0.42, 0.6, -3.1], light: 2 },
    { size: [1.3, 0.3, 0.5], pos: [0, 0.15, 2.2], light: 5 },
    { size: [1.3, 0.3, 0.5], pos: [0, 0.15, -2.2], light: 5 },
  ],
  delivery: [
    { size: [1.1, 1.2, 2.4], pos: [0, 0.82, -0.45], light: 0 },
    { size: [1.05, 0.8, 1.0], pos: [0, 0.6, 1.2], light: 0 },
    { size: [0.98, 0.34, 0.5], pos: [0, 0.86, 1.48], light: 3 },
    { size: [0.24, 0.1, 0.04], pos: [-0.36, 0.45, 1.71], light: 1 },
    { size: [0.24, 0.1, 0.04], pos: [0.36, 0.45, 1.71], light: 1 },
    { size: [0.24, 0.1, 0.04], pos: [-0.4, 0.5, -1.66], light: 2 },
    { size: [0.24, 0.1, 0.04], pos: [0.4, 0.5, -1.66], light: 2 },
    { size: [1.14, 0.26, 0.46], pos: [0, 0.13, 0.9], light: 5 },
    { size: [1.14, 0.26, 0.46], pos: [0, 0.13, -0.9], light: 5 },
  ],
};
SHAPES.taxi = [...SHAPES.car, { size: [0.5, 0.16, 0.24], pos: [0, 1.02, -0.1], light: 4 }];

function vehicleGeometry(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const light: number[] = [];
  for (const p of parts) {
    const g = new THREE.BoxGeometry(...p.size).toNonIndexed();
    g.translate(...p.pos);
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
    for (let i = 0; i < g.getAttribute('position').count; i++) light.push(p.light);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('aLight', new THREE.Float32BufferAttribute(light, 1));
  return out;
}

function vehicleMaterial(kind: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.55 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = env.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLight;\nattribute float aBrake;\nvarying float vLight;\nvarying float vBrake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = aLight;\nvBrake = aBrake;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vLight;\nvarying float vBrake;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vLight > 2.5 && vLight < 3.5) diffuseColor.rgb = vec3(0.04, 0.06, 0.09);
        if (vLight > 4.5) diffuseColor.rgb = vec3(0.03);
        if (vLight > 3.5 && vLight < 4.5) diffuseColor.rgb = ${kind === 'bus' ? 'vec3(0.1, 0.8, 1.0)' : 'vec3(1.0, 0.85, 0.3)'};`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (vLight > 2.5 && vLight < 3.5) roughnessFactor = 0.08;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float head = step(0.5, vLight) * step(vLight, 1.5);
        float tail = step(1.5, vLight) * step(vLight, 2.5);
        float sign = step(3.5, vLight) * step(vLight, 4.5);
        totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * head * (0.4 + 4.5 * uNight);
        totalEmissiveRadiance += vec3(1.0, 0.06, 0.04) * tail * (0.5 + 2.5 * uNight + 2.5 * vBrake);
        totalEmissiveRadiance += diffuseColor.rgb * sign * (0.4 + 2.0 * uNight);
        totalEmissiveRadiance += vec3(0.6, 0.75, 1.0) * step(2.5, vLight) * step(vLight, 3.5) * 0.25 * uNight;`,
      );
  };
  m.customProgramCacheKey = () => `morphis-vehicle-${kind}`;
  return m;
}

const KINDS: ('car' | 'taxi' | 'bus' | 'delivery')[] = ['car', 'taxi', 'bus', 'delivery'];
const shapeOf = (k: VehicleKind): 'car' | 'taxi' | 'bus' | 'delivery' => (k === 'visitor' ? 'car' : k);

export function Vehicles() {
  const infos = useSim((s) => s.vehicles);
  const max = 260;
  const refs = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const beamRef = useRef<THREE.InstancedMesh>(null);
  const map = useRef<Record<string, Int32Array>>({ car: new Int32Array(max), taxi: new Int32Array(max), bus: new Int32Array(max), delivery: new Int32Array(max) });

  const geos = useMemo(() => {
    const out: Record<string, THREE.BufferGeometry> = {};
    for (const k of KINDS) {
      const g = vehicleGeometry(SHAPES[k]);
      g.setAttribute('aBrake', new THREE.InstancedBufferAttribute(new Float32Array(max), 1));
      out[k] = g;
    }
    return out;
  }, []);
  const mats = useMemo(() => Object.fromEntries(KINDS.map((k) => [k, vehicleMaterial(k)])), []);
  const beamGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    return g;
  }, []);
  const beamMat = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 128, 0, 0);
    grad.addColorStop(0, 'rgba(255,240,210,0.9)');
    grad.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(22, 128);
    g.lineTo(42, 128);
    g.lineTo(64, 0);
    g.lineTo(0, 0);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.5 });
  }, []);
  const colors = useMemo(() => infos.map((v) => new THREE.Color(v.color)), [infos]);

  const tmpM = useMemo(() => new THREE.Matrix4(), []);
  const tmpQ = useMemo(() => new THREE.Quaternion(), []);
  const tmpP = useMemo(() => new THREE.Vector3(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const beamScale = useMemo(() => new THREE.Vector3(2.6, 1, 7), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(() => {
    const sample = simClient.sampleMotion();
    if (!sample) return;
    const counts: Record<string, number> = { car: 0, taxi: 0, bus: 0, delivery: 0 };
    const highlight = useUI.getState().highlight === 'transport';
    const night = env.uNight.value;
    let beams = 0;
    const beam = beamRef.current;
    for (let i = 0; i < infos.length; i++) {
      if (!sample.vVisible[i]) continue;
      const shape = shapeOf(infos[i].kind);
      const mesh = refs.current[shape];
      if (!mesh) continue;
      const k = counts[shape]++;
      if (k >= max) continue;
      const yaw = Math.atan2(sample.vDX[i], sample.vDZ[i]);
      tmpQ.setFromAxisAngle(up, yaw);
      tmpP.set(sample.vX[i], 0.04, sample.vZ[i]);
      tmpM.compose(tmpP, tmpQ, one);
      mesh.setMatrixAt(k, tmpM);
      mesh.setColorAt(k, highlight ? colors[i].clone().lerp(new THREE.Color('#facc15'), 0.5) : colors[i]);
      (geos[shape].getAttribute('aBrake') as THREE.InstancedBufferAttribute).setX(k, sample.vSpeed[i] < 0.3 ? 1 : 0);
      map.current[shape][k] = i;
      if (beam && night > 0.4 && beams < max) {
        const fwd = shape === 'bus' ? 3.2 : 1.2;
        tmpP.set(sample.vX[i] + sample.vDX[i] * fwd, 0.08, sample.vZ[i] + sample.vDZ[i] * fwd);
        tmpM.compose(tmpP, tmpQ, beamScale);
        beam.setMatrixAt(beams++, tmpM);
      }
    }
    for (const kk of KINDS) {
      const mesh = refs.current[kk];
      if (!mesh) continue;
      mesh.count = Math.min(max, counts[kk]);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      (geos[kk].getAttribute('aBrake') as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
    if (beam) {
      beam.count = beams;
      beam.instanceMatrix.needsUpdate = true;
      beamMat.opacity = Math.max(0, night - 0.4) * (0.35 + env.uWet.value * 0.4);
    }
  });

  const onClick = (kind: string) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || e.instanceId === undefined) return;
    e.stopPropagation();
    const idx = map.current[kind][e.instanceId];
    const v = infos[idx];
    if (v) useUI.getState().select({ kind: 'vehicle', id: v.id });
  };

  return (
    <group name="vehicles">
      {KINDS.map((k) => (
        <instancedMesh
          key={k}
          ref={(m) => {
            refs.current[k] = m;
          }}
          args={[geos[k], mats[k], max]}
          castShadow
          frustumCulled={false}
          onClick={onClick(k)}
        />
      ))}
      <instancedMesh ref={beamRef} args={[beamGeo, beamMat, max]} frustumCulled={false} renderOrder={3} />
    </group>
  );
}
