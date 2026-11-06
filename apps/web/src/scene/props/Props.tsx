/**
 * Street furniture and environmental detail: street lights with light pools,
 * trees, benches, planters, bus shelters, rooftop billboards, highway barriers,
 * rooftop parked cars and steam vents.
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { PropInstance } from '@morphis/shared';
import { useSim } from '../../state/simStore';
import { env } from '../env';
import { adTexture } from './textures';

const Y = new THREE.Vector3(0, 1, 0);
const q = new THREE.Quaternion();

function place(
  ref: React.RefObject<THREE.InstancedMesh | null>,
  items: PropInstance[],
  fn: (p: PropInstance) => { x: number; y: number; z: number; r: number; sx: number; sy: number; sz: number },
  color?: (p: PropInstance, i: number) => THREE.Color,
): void {
  const m = ref.current;
  if (!m) return;
  items.forEach((p, i) => {
    const t = fn(p);
    q.setFromAxisAngle(Y, t.r);
    m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.sx, t.sy, t.sz)));
    if (color) m.setColorAt(i, color(p, i));
  });
  m.count = items.length;
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere();
}

const poolTexture = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
})();

export function Props() {
  const world = useSim((s) => s.world)!;
  const p = world.props;
  const lights = p.streetLights;
  const streetLights = useMemo(() => lights.filter((l) => l.k !== 1), [lights]);
  const highwayLights = useMemo(() => lights.filter((l) => l.k === 1), [lights]);

  const poleRef = useRef<THREE.InstancedMesh>(null);
  const armRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<THREE.InstancedMesh>(null);
  const hwPoleRef = useRef<THREE.InstancedMesh>(null);
  const hwHeadRef = useRef<THREE.InstancedMesh>(null);
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const crownRef = useRef<THREE.InstancedMesh>(null);
  const benchRef = useRef<THREE.InstancedMesh>(null);
  const planterRef = useRef<THREE.InstancedMesh>(null);
  const shelterRef = useRef<THREE.InstancedMesh>(null);
  const shelterSignRef = useRef<THREE.InstancedMesh>(null);
  const boardFrameRef = useRef<THREE.InstancedMesh>(null);
  const barrierRef = useRef<THREE.InstancedMesh>(null);
  const carRef = useRef<THREE.InstancedMesh>(null);

  const geo = useMemo(
    () => ({
      pole: new THREE.CylinderGeometry(0.06, 0.09, 4.6, 6).translate(0, 2.3, 0),
      arm: new THREE.BoxGeometry(0.08, 0.08, 1.4).translate(0, 4.55, 0.65),
      head: new THREE.BoxGeometry(0.32, 0.1, 0.55).translate(0, 4.48, 1.25),
      pool: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      hwPole: new THREE.CylinderGeometry(0.08, 0.1, 6.5, 6).translate(0, 3.25, 0),
      hwHead: new THREE.BoxGeometry(2.6, 0.1, 0.3).translate(0, 6.45, 0),
      trunk: new THREE.CylinderGeometry(0.1, 0.16, 1.6, 5).translate(0, 0.8, 0),
      crown: new THREE.IcosahedronGeometry(1, 0).translate(0, 2.3, 0),
      bench: new THREE.BoxGeometry(1.6, 0.45, 0.5).translate(0, 0.22, 0),
      planter: new THREE.BoxGeometry(1.4, 0.6, 1.4).translate(0, 0.3, 0),
      shelter: new THREE.BoxGeometry(3.2, 0.12, 1.3).translate(0, 2.4, 0),
      shelterSign: new THREE.BoxGeometry(3.0, 0.5, 0.08).translate(0, 1.6, -0.6),
      boardFrame: new THREE.BoxGeometry(1, 1, 0.25).translate(0, 0.5, 0),
      board: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0.14),
      barrier: new THREE.BoxGeometry(1, 0.8, 0.45).translate(0, 0.4, 0),
      car: new THREE.BoxGeometry(2.1, 0.7, 1.0).translate(0, 0.35, 0),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      metal: new THREE.MeshStandardMaterial({ color: '#2b3038', metalness: 0.7, roughness: 0.4 }),
      lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.2, 1.6), toneMapped: false }),
      hwLamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.6, 0.9), toneMapped: false }),
      pool: new THREE.MeshBasicMaterial({ map: poolTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color('#ffcf94'), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      trunk: new THREE.MeshStandardMaterial({ color: '#3b2b22', roughness: 1 }),
      crown: new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
      bench: new THREE.MeshStandardMaterial({ color: '#4b4039', roughness: 0.8 }),
      planter: new THREE.MeshStandardMaterial({ color: '#2c3a33', roughness: 0.9 }),
      shelter: new THREE.MeshStandardMaterial({ color: '#2a3340', metalness: 0.5, roughness: 0.4 }),
      shelterSign: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.0), toneMapped: false }),
      boardFrame: new THREE.MeshStandardMaterial({ color: '#15171c', metalness: 0.6, roughness: 0.5 }),
      barrier: new THREE.MeshStandardMaterial({ color: '#5a5e66', roughness: 0.9 }),
      car: new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.5 }),
    }),
    [],
  );

  useLayoutEffect(() => {
    const flat = (l: PropInstance) => ({ x: l.x, y: 0, z: l.z, r: l.r, sx: 1, sy: 1, sz: 1 });
    place(poleRef, streetLights, flat);
    place(armRef, streetLights, flat);
    place(headRef, streetLights, flat);
    place(poolRef, streetLights, (l) => ({ x: l.x + Math.sin(l.r) * 1.25, y: 0.16, z: l.z + Math.cos(l.r) * 1.25, r: l.r, sx: 5, sy: 1, sz: 5 }));
    place(hwPoleRef, highwayLights, flat);
    place(hwHeadRef, highwayLights, (l) => ({ x: l.x, y: 0, z: l.z, r: l.r + Math.PI / 2, sx: 1, sy: 1, sz: 1 }));
    const trees = p.trees;
    place(trunkRef, trees, (t) => ({ x: t.x, y: 0.1, z: t.z, r: t.r, sx: t.s ?? 1, sy: t.s ?? 1, sz: t.s ?? 1 }));
    const palette = [new THREE.Color('#2b6b48'), new THREE.Color('#3a7d4f'), new THREE.Color('#8a3a7a'), new THREE.Color('#25615e')];
    place(
      crownRef,
      trees,
      (t) => ({ x: t.x, y: 0.1, z: t.z, r: t.r, sx: (t.s ?? 1) * 1.1, sy: t.s ?? 1, sz: (t.s ?? 1) * 1.1 }),
      (t, i) => (t.k === 2 && i % 3 === 0 ? palette[2] : palette[(i + (t.k ?? 0)) % 2 === 0 ? 0 : i % 5 === 0 ? 3 : 1]),
    );
    place(benchRef, p.benches, (b) => ({ x: b.x, y: 0.12, z: b.z, r: b.r, sx: 1, sy: 1, sz: 1 }));
    place(planterRef, p.planters, (b) => ({ x: b.x, y: 0.05, z: b.z, r: b.r, sx: 1, sy: 1, sz: 1 }));
    place(shelterRef, p.busStops, (b) => ({ x: b.x, y: 0.12, z: b.z, r: b.r, sx: 1, sy: 1, sz: 1 }));
    place(shelterSignRef, p.busStops, (b) => ({ x: b.x, y: 0.12, z: b.z, r: b.r, sx: 1, sy: 1, sz: 1 }));
    place(boardFrameRef, p.billboards, (b) => ({ x: b.x, y: b.s ?? 10, z: b.z, r: b.r, sx: 7, sy: 3.2, sz: 1 }));
    place(barrierRef, p.barriers, (b) => ({ x: b.x, y: 0, z: b.z, r: b.r + Math.PI / 2, sx: b.s ?? 5, sy: 1, sz: 1 }));
    const carColors = ['#cbd5e1', '#1e293b', '#7f1d1d', '#1e3a8a', '#e2e8f0', '#0f766e'].map((c) => new THREE.Color(c));
    place(carRef, p.parkedCars, (c) => ({ x: c.x, y: c.s ?? 0, z: c.z, r: c.r + Math.PI / 2, sx: 1, sy: 1, sz: 1 }), (c) => carColors[(c.k ?? 0) % carColors.length]);
  }, [streetLights, highwayLights, p]);

  useFrame(() => {
    const n = env.uNight.value;
    const on = n > 0.35 ? 1 : 0.06;
    mats.lamp.color.setRGB(2.6 * on + 0.2, 2.2 * on + 0.2, 1.6 * on + 0.2);
    mats.hwLamp.color.setRGB(2.4 * on + 0.2, 1.6 * on + 0.15, 0.9 * on + 0.1);
    mats.pool.opacity = Math.max(0, n - 0.3) * (0.55 + env.uWet.value * 0.6);
    mats.pool.visible = n > 0.32;
    boardBrightness.value = 0.6 + n * 1.4;
    mats.shelterSign.color.setRGB(0.3 + n * 0.5, 0.8 + n * 1.2, 1.0 + n * 1.4);
  });

  const n = (a: unknown[]) => Math.max(1, a.length);
  return (
    <group name="props">
      <instancedMesh ref={poleRef} args={[geo.pole, mats.metal, n(streetLights)]} frustumCulled={false} />
      <instancedMesh ref={armRef} args={[geo.arm, mats.metal, n(streetLights)]} frustumCulled={false} />
      <instancedMesh ref={headRef} args={[geo.head, mats.lamp, n(streetLights)]} frustumCulled={false} />
      <instancedMesh ref={poolRef} args={[geo.pool, mats.pool, n(streetLights)]} frustumCulled={false} renderOrder={2} />
      <instancedMesh ref={hwPoleRef} args={[geo.hwPole, mats.metal, n(highwayLights)]} frustumCulled={false} />
      <instancedMesh ref={hwHeadRef} args={[geo.hwHead, mats.hwLamp, n(highwayLights)]} frustumCulled={false} />
      <instancedMesh ref={trunkRef} args={[geo.trunk, mats.trunk, n(p.trees)]} castShadow frustumCulled={false} />
      <instancedMesh ref={crownRef} args={[geo.crown, mats.crown, n(p.trees)]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={benchRef} args={[geo.bench, mats.bench, n(p.benches)]} frustumCulled={false} />
      <instancedMesh ref={planterRef} args={[geo.planter, mats.planter, n(p.planters)]} frustumCulled={false} />
      <instancedMesh ref={shelterRef} args={[geo.shelter, mats.shelter, n(p.busStops)]} castShadow frustumCulled={false} />
      <instancedMesh ref={shelterSignRef} args={[geo.shelterSign, mats.shelterSign, n(p.busStops)]} frustumCulled={false} />
      <instancedMesh ref={boardFrameRef} args={[geo.boardFrame, mats.boardFrame, n(p.billboards)]} frustumCulled={false} />
      {p.billboards.map((b, i) => (
        <Billboard key={i} b={b} geometry={geo.board} />
      ))}
      <instancedMesh ref={barrierRef} args={[geo.barrier, mats.barrier, n(p.barriers)]} frustumCulled={false} />
      <instancedMesh ref={carRef} args={[geo.car, mats.car, n(p.parkedCars)]} castShadow frustumCulled={false} />
      <Steam />
    </group>
  );
}

const boardBrightness = { value: 1 };

function Billboard({ b, geometry }: { b: PropInstance; geometry: THREE.BufferGeometry }) {
  const mat = useMemo(() => {
    const base = adTexture();
    const t = base.clone();
    const k = (b.k ?? 0) % 8;
    t.repeat.set(0.25, 0.5);
    t.offset.set((k % 4) * 0.25, k < 4 ? 0.5 : 0);
    t.needsUpdate = true;
    return new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
  }, [b.k]);
  useFrame(() => mat.color.setScalar(boardBrightness.value * (0.92 + 0.08 * Math.sin(env.uTime.value * 7 + b.x))));
  return <mesh geometry={geometry} material={mat} position={[b.x, (b.s ?? 10) + 0.15, b.z]} rotation-y={b.r} scale={[6.6, 2.9, 1]} />;
}

/** Steam rising from street vents (soft additive sprites). */
function Steam() {
  const world = useSim((s) => s.world)!;
  const vents = world.props.vents;
  const PER = 6;
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(vents.length * PER * 3);
    const seed = new Float32Array(vents.length * PER);
    vents.forEach((v, i) => {
      for (let k = 0; k < PER; k++) {
        const j = i * PER + k;
        pos[j * 3] = v.x;
        pos[j * 3 + 1] = 0.2;
        pos[j * 3 + 2] = v.z;
        seed[j] = k / PER + i * 0.37;
      }
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, [vents]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: env.uTime, uNight: env.uNight },
        vertexShader: /* glsl */ `
          attribute float aSeed; uniform float uTime; varying float vLife;
          void main() {
            float life = fract(uTime * 0.18 + aSeed);
            vLife = life;
            vec3 p = position + vec3(sin(aSeed * 31.0 + life * 3.0) * 0.6 * life, life * 5.0, cos(aSeed * 17.0) * 0.5 * life);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = (90.0 + life * 260.0) / -mv.z;
          }`,
        fragmentShader: /* glsl */ `
          varying float vLife; uniform float uNight;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = (1.0 - smoothstep(0.1, 0.5, d)) * (1.0 - vLife) * 0.22;
            gl_FragColor = vec4(mix(vec3(0.75), vec3(0.65, 0.6, 0.8), uNight), a);
          }`,
      }),
    [],
  );
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} />;
}
