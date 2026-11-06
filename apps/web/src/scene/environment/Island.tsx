/**
 * The floating island and its surroundings: the town's ground surface, the
 * cliff edge with railings and lanterns, the rock underside with glowing
 * crystal veins, the sky-lift gates at the expressway ends, the drifting
 * islets, and the sea of clouds far below.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { dropIn } from '../../components/hud/GuestHud';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { IslandShape, SkylineBlock, StaticWorld } from '@morphis/shared';
import { useSim } from '../../state/simStore';
import { GLSL_HASH, env } from '../env';

function hash(n: number): number {
  const x = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return x - Math.floor(x);
}

function outlinePts(island: IslandShape, step = 1): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < island.outline.length; i += 2 * step) pts.push(new THREE.Vector2(island.outline[i], island.outline[i + 1]));
  return pts;
}

// ------------------------------------------------------------------ ground surface

/** Clicking the town from above drops the visitor in at that spot. */
export function onGroundClick(e: ThreeEvent<MouseEvent>): void {
  if (e.delta > 6 || e.button !== 0) return; // a drag, or not the main button
  if (dropIn(e.point.x, e.point.z)) e.stopPropagation();
}

export function IslandGround({ world, lotMat }: { world: StaticWorld; lotMat: THREE.Material }) {
  const island = world.island!;
  const { top, edge } = useMemo(() => {
    const pts = outlinePts(island);
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.y)));
    const top = new THREE.ShapeGeometry(shape, 1);
    top.rotateX(-Math.PI / 2);
    // a grassy border just inside the edge
    const inner = pts.map((p) => p.clone().multiplyScalar(1 - 6 / Math.max(1, p.length())));
    const edgeShape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.y)));
    edgeShape.holes.push(new THREE.Path(inner.map((p) => new THREE.Vector2(p.x, -p.y)).reverse()));
    const edge = new THREE.ShapeGeometry(edgeShape, 1);
    edge.rotateX(-Math.PI / 2);
    return { top, edge };
  }, [island]);
  const grass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1f3b2c', roughness: 1 }), []);
  return (
    <group name="island-ground">
      <mesh geometry={top} material={lotMat} position-y={-0.01} receiveShadow onClick={onGroundClick} />
      <mesh geometry={edge} material={grass} position-y={0.005} receiveShadow onClick={onGroundClick} />
    </group>
  );
}

// ------------------------------------------------------------------ underside

export function IslandRock({ island }: { island: IslandShape }) {
  const { geo, crystals } = useMemo(() => {
    const ring = outlinePts(island, 2);
    const n = ring.length;
    const depth = island.depth;
    const levels: { y: number; s: number }[] = [
      { y: 0, s: 1 },
      { y: -1.2, s: 1.004 },
      { y: -3.2, s: 0.985 },
    ];
    const L = 12;
    for (let j = 1; j <= L; j++) {
      const t = j / L;
      levels.push({ y: -3.2 - Math.pow(t, 1.15) * depth, s: Math.pow(1 - t, 0.75) * 0.97 + 0.02 });
    }
    const pos: number[] = [];
    const col: number[] = [];
    const strata = [new THREE.Color('#3b2d2a'), new THREE.Color('#2b2440'), new THREE.Color('#352c4d'), new THREE.Color('#241f36'), new THREE.Color('#3a3157')];
    const dirt = new THREE.Color('#4a3527');
    const grassC = new THREE.Color('#25472f');
    const vtx = (li: number, i: number): THREE.Vector3 => {
      const lv = levels[li];
      const p = ring[i % n];
      const jitter = li < 2 ? 0 : (hash(i * 13.1 + li * 7.7) - 0.5) * 5 * Math.min(1, li / 4);
      const sc = lv.s * (1 + (li > 2 ? (hash(i * 3.3 + li) - 0.5) * 0.12 : 0));
      return new THREE.Vector3(p.x * sc + jitter, lv.y + (li > 2 ? (hash(i + li * 5.1) - 0.5) * 4 : 0), p.y * sc - jitter * 0.5);
    };
    const apex = new THREE.Vector3(0, -depth - 22, 0);
    const colorFor = (li: number, i: number): THREE.Color => {
      if (li === 0) return grassC;
      if (li <= 2) return dirt;
      return strata[(li + Math.floor(hash(i * 0.37) * 2)) % strata.length];
    };
    for (let li = 0; li < levels.length; li++) {
      for (let i = 0; i < n; i++) {
        const a = vtx(li, i);
        const b = vtx(li, i + 1);
        const c = li + 1 < levels.length ? vtx(li + 1, i) : apex;
        const d = li + 1 < levels.length ? vtx(li + 1, i + 1) : apex;
        const cc = colorFor(li, i);
        // two triangles per quad, facing outward (outline is counter-clockwise in x/z)
        pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
        pos.push(b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
        for (let k = 0; k < 6; k++) col.push(cc.r, cc.g, cc.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    // glowing crystal clusters on the underside
    const crystals: { p: THREE.Vector3; s: number; r: number; c: number }[] = [];
    for (let k = 0; k < 150; k++) {
      const li = 3 + Math.floor(hash(k * 1.7) * (levels.length - 5));
      const i = Math.floor(hash(k * 9.1) * n);
      const p = vtx(li, i).multiplyScalar(1.01);
      crystals.push({ p, s: 1.2 + hash(k * 4.4) * 3.4, r: hash(k) * 6.28, c: k % 3 });
    }
    return { geo: g, crystals };
  }, [island]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.05, flatShading: true, side: THREE.DoubleSide, emissive: new THREE.Color('#1b1236'), emissiveIntensity: 0.9 }), []);
  const crystalRef = useRef<THREE.InstancedMesh>(null);
  const crystalGeo = useMemo(() => new THREE.OctahedronGeometry(1, 0).scale(0.5, 1.6, 0.5), []);
  const crystalMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  useLayoutEffect(() => {
    const m = crystalRef.current;
    if (!m) return;
    const colors = [new THREE.Color(0.4, 2.2, 2.4), new THREE.Color(1.6, 0.7, 2.6), new THREE.Color(2.4, 1.6, 0.5)];
    crystals.forEach((c, i) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI + (hash(i) - 0.5) * 0.8, c.r, (hash(i + 2) - 0.5) * 0.8));
      m.setMatrixAt(i, new THREE.Matrix4().compose(c.p, q, new THREE.Vector3(c.s, c.s, c.s)));
      m.setColorAt(i, colors[c.c]);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [crystals]);
  return (
    <group name="island-rock">
      <mesh geometry={geo} material={mat} receiveShadow />
      <instancedMesh ref={crystalRef} args={[crystalGeo, crystalMat, crystals.length]} />
    </group>
  );
}

// ------------------------------------------------------------------ edge railing and lanterns

export function IslandEdge({ island }: { island: IslandShape }) {
  const posts = useRef<THREE.InstancedMesh>(null);
  const rails = useRef<THREE.InstancedMesh>(null);
  const lamps = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(() => {
    const pts = outlinePts(island);
    const out: { x: number; z: number; nx: number; nz: number; lamp: boolean }[] = [];
    let acc = 0;
    let k = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const l = a.distanceTo(b);
      acc += l;
      if (acc < 5) continue;
      acc = 0;
      const inward = a.clone().normalize().multiplyScalar(-1.2);
      const x = a.x + inward.x;
      const z = a.y + inward.y;
      if (island.lifts.some((lf) => Math.hypot(lf.x - x, lf.z - z) < 10)) continue;
      out.push({ x, z, nx: b.x - a.x, nz: b.y - a.y, lamp: k++ % 3 === 0 });
    }
    return out;
  }, [island]);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b3040', roughness: 0.6, metalness: 0.6 }), []);
  const lampMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.7, 0.7), toneMapped: false }), []);
  useLayoutEffect(() => {
    const p = posts.current;
    const r = rails.current;
    const l = lamps.current;
    if (!p || !r || !l) return;
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let li = 0;
    data.forEach((d, i) => {
      p.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(d.x, 0.5, d.z), q.identity(), new THREE.Vector3(0.14, 1, 0.14)));
      const nxt = data[(i + 1) % data.length];
      const len = Math.hypot(nxt.x - d.x, nxt.z - d.z);
      if (len < 9) {
        q.setFromAxisAngle(up, Math.atan2(nxt.x - d.x, nxt.z - d.z));
        r.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3((d.x + nxt.x) / 2, 0.92, (d.z + nxt.z) / 2), q, new THREE.Vector3(0.08, 0.08, len)));
      } else r.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      if (d.lamp) l.setMatrixAt(li++, new THREE.Matrix4().compose(new THREE.Vector3(d.x, 1.15, d.z), q.identity(), new THREE.Vector3(0.26, 0.32, 0.26)));
    });
    l.count = li;
    for (const m of [p, r, l]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [data]);
  return (
    <group name="island-edge">
      <instancedMesh ref={posts} args={[box, metal, data.length]} />
      <instancedMesh ref={rails} args={[box, metal, data.length]} />
      <instancedMesh ref={lamps} args={[box, lampMat, data.length]} />
    </group>
  );
}

// ------------------------------------------------------------------ sky lifts

export function SkyLifts({ island }: { island: IslandShape }) {
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.2, 2.6), toneMapped: false }), []);
  const fieldMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#22d3ee'), transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    [],
  );
  const stone = useMemo(() => new THREE.MeshStandardMaterial({ color: '#33384a', roughness: 0.7, metalness: 0.3 }), []);
  useFrame(() => {
    fieldMat.opacity = 0.12 + Math.sin(env.uTime.value * 2.2) * 0.05;
  });
  return (
    <group name="sky-lifts">
      {island.lifts.map((l, i) => {
        const yaw = Math.atan2(l.x, l.z); // outward
        return (
          <group key={i} position={[l.x, 0, l.z]} rotation-y={yaw}>
            {/* landing deck beyond the edge */}
            <mesh material={stone} position={[0, -0.6, 4]} receiveShadow>
              <boxGeometry args={[16, 1.2, 12]} />
            </mesh>
            {[-6.5, 6.5].map((x) => (
              <mesh key={x} material={stone} position={[x, 4, 2]} castShadow>
                <boxGeometry args={[1.4, 8, 1.4]} />
              </mesh>
            ))}
            <mesh material={stone} position={[0, 8.4, 2]}>
              <boxGeometry args={[15, 1, 1.6]} />
            </mesh>
            <mesh material={ringMat} position={[0, 4.2, 2]}>
              <torusGeometry args={[5.4, 0.16, 8, 48]} />
            </mesh>
            <mesh material={fieldMat} position={[0, 4.2, 2]}>
              <circleGeometry args={[5.3, 40]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ------------------------------------------------------------------ islets

export function Islets({ islets }: { islets: SkylineBlock[] }) {
  const tops = useRef<THREE.InstancedMesh>(null);
  const rocks = useRef<THREE.InstancedMesh>(null);
  const trees = useRef<THREE.InstancedMesh>(null);
  const topGeo = useMemo(() => new THREE.CylinderGeometry(1, 0.94, 0.5, 9).translate(0, -0.25, 0), []);
  const rockGeo = useMemo(() => new THREE.ConeGeometry(0.94, 1, 9, 2).rotateX(Math.PI).translate(0, -0.5, 0), []);
  const treeGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const grass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#244a33', roughness: 1, flatShading: true }), []);
  const rock = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2d2742', roughness: 1, flatShading: true }), []);
  const leaf = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2f6b4a', roughness: 0.9, flatShading: true }), []);
  const treeCount = islets.length * 3;
  useLayoutEffect(() => {
    const t = tops.current;
    const r = rocks.current;
    const tr = trees.current;
    if (!t || !r || !tr) return;
    const q = new THREE.Quaternion();
    let k = 0;
    islets.forEach((s, i) => {
      const y = s.y ?? 0;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i) * 6.28);
      t.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, y, s.z), q, new THREE.Vector3(s.w / 2, 1, s.d / 2)));
      r.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, y - 0.5, s.z), q, new THREE.Vector3(s.w / 2, s.h, s.d / 2)));
      const nTrees = 1 + Math.floor(hash(i + 0.5) * 3);
      for (let j = 0; j < 3; j++) {
        if (j >= nTrees) {
          tr.setMatrixAt(k++, new THREE.Matrix4().makeScale(0, 0, 0));
          continue;
        }
        const a = hash(i * 3 + j) * 6.28;
        const rr = hash(i * 7 + j) * Math.min(s.w, s.d) * 0.3;
        const sz = 1.2 + hash(i + j * 11) * Math.min(3, s.w * 0.12);
        tr.setMatrixAt(k++, new THREE.Matrix4().compose(new THREE.Vector3(s.x + Math.cos(a) * rr, y + sz * 0.9, s.z + Math.sin(a) * rr), q, new THREE.Vector3(sz, sz * 1.15, sz)));
      }
    });
    for (const m of [t, r, tr]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [islets]);
  return (
    <group name="islets">
      <instancedMesh ref={tops} args={[topGeo, grass, islets.length]} />
      <instancedMesh ref={rocks} args={[rockGeo, rock, islets.length]} />
      <instancedMesh ref={trees} args={[treeGeo, leaf, treeCount]} />
    </group>
  );
}

// ------------------------------------------------------------------ sea of clouds

const cloudVert = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const cloudFrag = /* glsl */ `
uniform float uTime; uniform float uNight; uniform vec3 uLow; uniform vec3 uHigh; uniform vec3 uGlow;
varying vec3 vWorld;
#include <fog_pars_fragment>
${GLSL_HASH}
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = mHash12(i), b = mHash12(i + vec2(1.0, 0.0)), c = mHash12(i + vec2(0.0, 1.0)), d = mHash12(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec2 p = vWorld.xz * 0.006 + vec2(uTime * 0.004, uTime * 0.0025);
  float n = fbm(p);
  float m = fbm(p * 2.7 - vec2(uTime * 0.006, 0.0));
  float d = smoothstep(0.3, 0.85, n * 0.75 + m * 0.35);
  vec3 col = mix(uLow, uHigh, d);
  // the island's glow on the clouds directly below it
  float r = length(vWorld.xz);
  col += uGlow * exp(-r * 0.006) * 0.35 * uNight;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

export function CloudSea() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsLib.fog,
          uTime: env.uTime,
          uNight: env.uNight,
          uLow: { value: new THREE.Color('#0b1430') },
          uHigh: { value: new THREE.Color('#3a4a7a') },
          uGlow: { value: new THREE.Color('#7c3aed') },
        },
        vertexShader: cloudVert,
        fragmentShader: cloudFrag,
        fog: true,
      }),
    [],
  );
  const night = useMemo(() => ({ low: new THREE.Color('#0a1230'), high: new THREE.Color('#34467a') }), []);
  const day = useMemo(() => ({ low: new THREE.Color('#9fb3d4'), high: new THREE.Color('#f4f6fb') }), []);
  useFrame(() => {
    const n = env.uNight.value;
    (mat.uniforms.uLow.value as THREE.Color).copy(day.low).lerp(night.low, n);
    (mat.uniforms.uHigh.value as THREE.Color).copy(day.high).lerp(night.high, n);
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-170} material={mat}>
      <planeGeometry args={[5000, 5000, 1, 1]} />
    </mesh>
  );
}

/** Everything around the town, when the world is an island. */
export function IslandWorld() {
  const world = useSim((s) => s.world)!;
  if (!world.island) return null;
  return (
    <>
      <IslandRock island={world.island} />
      <IslandEdge island={world.island} />
      <SkyLifts island={world.island} />
      <Islets islets={world.skyline} />
      <CloudSea />
    </>
  );
}
