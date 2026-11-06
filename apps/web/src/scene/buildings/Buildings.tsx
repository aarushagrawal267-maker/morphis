/**
 * All buildings rendered as a handful of instanced meshes:
 * box / cylinder / hex tiers (procedural facades), rooftop equipment,
 * antennas with blinking beacons, neon strips and construction sites.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { BuildingDef, StaticWorld } from '@morphis/shared';
import { localToWorld } from '@morphis/sim';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { FACADE_INDEX, PALETTE, env } from '../env';
import { createBuildingMaterial, createNeonMaterial, type ShapeKind } from './buildingMaterial';

interface TierInstance {
  building: number;
  shape: ShapeKind;
  matrix: THREE.Matrix4;
  color: THREE.Color;
  build: [number, number, number, number];
}

interface Detail {
  matrix: THREE.Matrix4;
  color?: THREE.Color;
}

const STOREFRONT = new Set(['shop', 'cafe', 'restaurant', 'entertainment']);
const tmpQ = new THREE.Quaternion();
const yAxis = new THREE.Vector3(0, 1, 0);

function makeMatrix(x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
  tmpQ.setFromAxisAngle(yAxis, rot);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), tmpQ, new THREE.Vector3(sx, sy, sz));
}

function seedOf(b: BuildingDef): number {
  return ((b.index * 2654435761) % 1000) / 1000;
}

export function buildLayout(world: StaticWorld, constructionIds: Set<string>) {
  const tiers: TierInstance[] = [];
  const hvac: Detail[] = [];
  const tanks: Detail[] = [];
  const antennas: Detail[] = [];
  const beacons: Detail[] = [];
  const spires: Detail[] = [];
  const pads: Detail[] = [];
  const gardens: Detail[] = [];
  const neon: Detail[] = [];
  const scaffold: Detail[] = [];
  const cranes: Detail[] = [];

  for (const b of world.buildings) {
    if (!b.tiers.length) continue;
    const underConstruction = constructionIds.has(b.id);
    const seed = seedOf(b);
    let topY = 0;
    let top = b.tiers[0];
    for (const t of b.tiers) {
      const ty = t.y0 + t.h;
      if (ty > topY) {
        topY = ty;
        top = t;
      }
    }
    if (underConstruction) {
      const t = b.tiers[0];
      const p = localToWorld(b.position.x, b.position.z, b.rotation, t.ox, t.oz);
      const h = Math.max(4, b.height * 0.42);
      tiers.push({ building: b.index, shape: 'box', matrix: makeMatrix(p.x, 0, p.z, b.rotation, t.w * 0.9, h, t.d * 0.9), color: PALETTE[3], build: [seed, 0.1, 3, 0] });
      scaffold.push({ matrix: makeMatrix(p.x, 0, p.z, b.rotation, t.w * 0.96, h + 3, t.d * 0.96) });
      // tower crane: mast + jib
      const mast = localToWorld(b.position.x, b.position.z, b.rotation, t.w * 0.35, -t.d * 0.3);
      cranes.push({ matrix: makeMatrix(mast.x, 0, mast.z, b.rotation, 0.7, h + 16, 0.7) });
      const jib = localToWorld(b.position.x, b.position.z, b.rotation, t.w * 0.35 - 6, -t.d * 0.3);
      cranes.push({ matrix: makeMatrix(jib.x, h + 15.4, jib.z, b.rotation, 18, 0.6, 0.6) });
      continue;
    }
    for (const t of b.tiers) {
      const p = localToWorld(b.position.x, b.position.z, b.rotation, t.ox, t.oz);
      const facade = FACADE_INDEX[t.facade] ?? 1;
      const storefront = STOREFRONT.has(b.type) && t.y0 === 0 ? 10 : 0;
      const color = t.facade === 'none' ? new THREE.Color('#3a3f48') : PALETTE[b.palette % PALETTE.length];
      tiers.push({
        building: b.index,
        shape: t.shape,
        matrix: makeMatrix(p.x, t.y0, p.z, b.rotation, t.w, t.h, t.shape === 'box' ? t.d : t.w),
        color,
        build: [seed, b.windowDensity, facade + storefront, 0],
      });
    }
    // rooftop equipment on the top tier
    const tp = localToWorld(b.position.x, b.position.z, b.rotation, top.ox, top.oz);
    const rr = (n: number): number => ((Math.sin(b.index * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    if (top.shape === 'box') {
      if (b.rooftop === 'hvac' || b.rooftop === 'dish') {
        const n = 1 + Math.floor(rr(1) * 3);
        for (let i = 0; i < n; i++) {
          const lx = (rr(i + 2) - 0.5) * top.w * 0.6;
          const lz = (rr(i + 5) - 0.5) * top.d * 0.6;
          const w = localToWorld(tp.x, tp.z, b.rotation, lx, lz);
          const s = 1.2 + rr(i + 9) * 1.6;
          hvac.push({ matrix: makeMatrix(w.x, topY, w.z, b.rotation, s, 0.8 + rr(i + 3), s * 0.8) });
        }
      }
      if (b.rooftop === 'tanks') {
        const n = 1 + Math.floor(rr(4) * 2);
        for (let i = 0; i < n; i++) {
          const w = localToWorld(tp.x, tp.z, b.rotation, (i - 0.5) * 2.4, top.d * 0.18);
          tanks.push({ matrix: makeMatrix(w.x, topY, w.z, 0, 1.6, 2.4, 1.6) });
        }
      }
      if (b.rooftop === 'garden') gardens.push({ matrix: makeMatrix(tp.x, topY, tp.z, b.rotation, top.w * 0.8, 0.35, top.d * 0.8) });
      if (b.rooftop === 'helipad') pads.push({ matrix: makeMatrix(tp.x, topY, tp.z, 0, Math.min(top.w, top.d) * 0.7, 0.25, Math.min(top.w, top.d) * 0.7) });
      if (b.rooftop === 'crown') neon.push({ matrix: makeMatrix(tp.x, topY - 0.6, tp.z, b.rotation, top.w + 0.25, 0.25, top.d + 0.25), color: new THREE.Color(b.neon?.color ?? '#94a3b8') });
    }
    if (b.rooftop === 'spire' || b.rooftop === 'antenna' || b.antennas > 0) {
      const n = Math.max(1, b.antennas);
      for (let i = 0; i < n; i++) {
        const lx = n > 1 ? (i - (n - 1) / 2) * (top.w * 0.25) : 0;
        const w = localToWorld(tp.x, tp.z, b.rotation, lx, 0);
        const hh = b.rooftop === 'spire' ? Math.max(6, b.height * 0.12) : 4 + rr(i + 11) * 6;
        (b.rooftop === 'spire' ? spires : antennas).push({ matrix: makeMatrix(w.x, topY, w.z, 0, 1, hh, 1) });
        beacons.push({ matrix: makeMatrix(w.x, topY + hh, w.z, 0, 1, 1, 1) });
      }
    }
    // rooftop accent lights on tall towers (common in the skyline)
    if (!b.neon && b.height > 26 && top.shape === 'box' && rr(21) < 0.55) {
      const accents = ['#22d3ee', '#e879f9', '#a855f7', '#38bdf8', '#f472b6', '#fbbf24'];
      neon.push({ matrix: makeMatrix(tp.x, topY - 0.5, tp.z, b.rotation, top.w + 0.15, 0.3, top.d + 0.15), color: new THREE.Color(accents[Math.floor(rr(22) * accents.length)]) });
    }
    // neon accents
    if (b.neon && top.shape === 'box') {
      const c = new THREE.Color(b.neon.color);
      if (b.neon.style === 'edge') {
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          for (const t of b.tiers) {
            if (t.shape !== 'box') continue;
            const w = localToWorld(b.position.x, b.position.z, b.rotation, t.ox + (sx * t.w) / 2, t.oz + (sz * t.d) / 2);
            neon.push({ matrix: makeMatrix(w.x, t.y0 + 0.4, w.z, b.rotation, 0.18, t.h - 0.6, 0.18), color: c });
          }
        }
      } else if (b.neon.style === 'crown') {
        neon.push({ matrix: makeMatrix(tp.x, topY - 1.2, tp.z, b.rotation, top.w + 0.2, 0.35, top.d + 0.2), color: c });
      } else {
        const base = b.tiers[0];
        const bp = localToWorld(b.position.x, b.position.z, b.rotation, base.ox, base.oz + base.d / 2 + 0.05);
        const yb = Math.min(base.h - 0.6, 3.1);
        neon.push({ matrix: makeMatrix(bp.x, yb, bp.z, b.rotation, base.w * 0.92, 0.22, 0.12), color: c });
        if (base.h > 10) neon.push({ matrix: makeMatrix(bp.x, base.h * 0.62, bp.z, b.rotation, base.w * 0.92, 0.16, 0.12), color: c });
      }
    }
  }
  return { tiers, hvac, tanks, antennas, beacons, spires, pads, gardens, neon, scaffold, cranes };
}

function useInstanced(ref: React.RefObject<THREE.InstancedMesh | null>, items: Detail[], defaultColor?: THREE.Color) {
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    items.forEach((it, i) => {
      m.setMatrixAt(i, it.matrix);
      if (it.color || defaultColor) m.setColorAt(i, it.color ?? defaultColor!);
    });
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [ref, items, defaultColor]);
}

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1).translate(0, 0.5, 0);
const unitHex = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1).translate(0, 0.5, 0);
const unitCone = new THREE.ConeGeometry(0.5, 1, 8).translate(0, 0.5, 0);
const thinCyl = new THREE.CylinderGeometry(0.08, 0.12, 1, 6).translate(0, 0.5, 0);
const beaconGeo = new THREE.SphereGeometry(0.28, 8, 6);

export function TierMesh({ shape, items, onPick }: { shape: ShapeKind; items: TierInstance[]; onPick: (e: ThreeEvent<MouseEvent>, building: number) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => createBuildingMaterial(shape), [shape]);
  const geo = useMemo(() => {
    const g = (shape === 'box' ? unitBox : shape === 'cylinder' ? unitCyl : unitHex).clone();
    g.setAttribute('aBuild', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, items.length) * 4), 4));
    return g;
  }, [shape, items.length]);
  const occupancy = useSim((s) => s.state?.occupancy);
  const world = useSim((s) => s.world);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const attr = geo.getAttribute('aBuild') as THREE.InstancedBufferAttribute;
    items.forEach((it, i) => {
      m.setMatrixAt(i, it.matrix);
      m.setColorAt(i, it.color);
      attr.setXYZW(i, ...it.build);
    });
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    attr.needsUpdate = true;
    m.computeBoundingSphere();
    m.userData.owner = items.map((t) => t.building);
  }, [items, geo]);

  // windows react to how many citizens are actually inside
  useLayoutEffect(() => {
    if (!occupancy || !world) return;
    const attr = geo.getAttribute('aBuild') as THREE.InstancedBufferAttribute;
    items.forEach((it, i) => {
      const b = world.buildings[it.building];
      const occ = occupancy[it.building] ?? 0;
      attr.setW(i, Math.min(0.35, (occ / Math.max(4, b.capacity)) * 0.8));
    });
    attr.needsUpdate = true;
  }, [occupancy, items, geo, world]);

  return (
    <instancedMesh
      ref={ref}
      args={[geo, mat, Math.max(1, items.length)]}
      castShadow
      receiveShadow
      frustumCulled={false}
      onClick={(e) => {
        if (e.instanceId === undefined) return;
        onPick(e, items[e.instanceId].building);
      }}
      onPointerOver={(e) => {
        if (e.instanceId === undefined) return;
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
        const b = useSim.getState().world?.buildings[items[e.instanceId].building];
        if (b) useUI.getState().setHovered({ kind: 'building', id: b.id });
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
        useUI.getState().setHovered(null);
      }}
    />
  );
}

export function Buildings() {
  const world = useSim((s) => s.world)!;
  const buildingDyn = useSim((s) => s.buildingDyn);
  const constructionKey = useMemo(
    () =>
      world.buildings
        .filter((b) => b.construction && (buildingDyn[b.id]?.status ?? 'CONSTRUCTION') === 'CONSTRUCTION')
        .map((b) => b.id)
        .join(','),
    [world, buildingDyn],
  );
  const layout = useMemo(() => buildLayout(world, new Set(constructionKey.split(',').filter(Boolean))), [world, constructionKey]);
  const byShape = useMemo(
    () => ({
      box: layout.tiers.filter((t) => t.shape === 'box'),
      cylinder: layout.tiers.filter((t) => t.shape === 'cylinder'),
      hex: layout.tiers.filter((t) => t.shape === 'hex'),
    }),
    [layout],
  );

  const onPick = (e: ThreeEvent<MouseEvent>, index: number) => {
    if (e.delta > 6) return; // was a drag
    e.stopPropagation();
    const b = world.buildings[index];
    useUI.getState().select({ kind: 'building', id: b.id });
  };

  const hvacRef = useRef<THREE.InstancedMesh>(null);
  const tankRef = useRef<THREE.InstancedMesh>(null);
  const antRef = useRef<THREE.InstancedMesh>(null);
  const beaconRef = useRef<THREE.InstancedMesh>(null);
  const spireRef = useRef<THREE.InstancedMesh>(null);
  const padRef = useRef<THREE.InstancedMesh>(null);
  const gardenRef = useRef<THREE.InstancedMesh>(null);
  const neonRef = useRef<THREE.InstancedMesh>(null);
  const scaffoldRef = useRef<THREE.InstancedMesh>(null);
  const craneRef = useRef<THREE.InstancedMesh>(null);
  useInstanced(hvacRef, layout.hvac);
  useInstanced(tankRef, layout.tanks);
  useInstanced(antRef, layout.antennas);
  useInstanced(beaconRef, layout.beacons);
  useInstanced(spireRef, layout.spires);
  useInstanced(padRef, layout.pads);
  useInstanced(gardenRef, layout.gardens);
  useInstanced(neonRef, layout.neon);
  useInstanced(scaffoldRef, layout.scaffold);
  useInstanced(craneRef, layout.cranes);

  const neonMat = useMemo(() => createNeonMaterial(), []);
  const beaconMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.25, 0.3), toneMapped: false }), []);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3d434d', roughness: 0.6, metalness: 0.6 }), []);
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.8, metalness: 0.3 }), []);
  const garden = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1f4d33', roughness: 0.95 }), []);
  const pad = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1b1f27', emissive: new THREE.Color('#22d3ee'), emissiveIntensity: 0.25, roughness: 0.7 }), []);
  const scaffoldMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c08a2a', wireframe: true, roughness: 0.6 }), []);
  const craneMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e0a526', roughness: 0.5, metalness: 0.4 }), []);

  useFrame(() => {
    // blink beacons
    beaconMat.color.setRGB(3 * (Math.sin(env.uTime.value * 3) > 0.2 ? 1 : 0.15), 0.25, 0.3);
  });

  return (
    <group name="buildings">
      <TierMesh shape="box" items={byShape.box} onPick={onPick} />
      {byShape.cylinder.length > 0 && <TierMesh shape="cylinder" items={byShape.cylinder} onPick={onPick} />}
      {byShape.hex.length > 0 && <TierMesh shape="hex" items={byShape.hex} onPick={onPick} />}
      <instancedMesh ref={hvacRef} args={[unitBox, metal, Math.max(1, layout.hvac.length)]} castShadow frustumCulled={false} />
      <instancedMesh ref={tankRef} args={[unitCyl, dark, Math.max(1, layout.tanks.length)]} castShadow frustumCulled={false} />
      <instancedMesh ref={antRef} args={[thinCyl, metal, Math.max(1, layout.antennas.length)]} frustumCulled={false} />
      <instancedMesh ref={spireRef} args={[unitCone, metal, Math.max(1, layout.spires.length)]} castShadow frustumCulled={false} />
      <instancedMesh ref={beaconRef} args={[beaconGeo, beaconMat, Math.max(1, layout.beacons.length)]} frustumCulled={false} />
      <instancedMesh ref={padRef} args={[unitCyl, pad, Math.max(1, layout.pads.length)]} frustumCulled={false} />
      <instancedMesh ref={gardenRef} args={[unitBox, garden, Math.max(1, layout.gardens.length)]} frustumCulled={false} />
      <instancedMesh ref={neonRef} args={[unitBox, neonMat, Math.max(1, layout.neon.length)]} frustumCulled={false} />
      <instancedMesh ref={scaffoldRef} args={[unitBox, scaffoldMat, Math.max(1, layout.scaffold.length)]} frustumCulled={false} />
      <instancedMesh ref={craneRef} args={[unitBox, craneMat, Math.max(1, layout.cranes.length)]} castShadow frustumCulled={false} />
    </group>
  );
}
