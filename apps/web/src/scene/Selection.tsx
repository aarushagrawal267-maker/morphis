/**
 * Selection & highlight overlays: selected/hovered building outlines with a
 * beam, enterable / clickable building highlight modes, and a ring under the
 * selected citizen or vehicle.
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { BuildingDef } from '@morphis/shared';
import { localToWorld } from '@morphis/sim';
import { useSim } from '../state/simStore';
import { useUI } from '../state/uiStore';
import { env } from './env';
import { citizenPosition, vehiclePosition } from './positions';

function outlineGeometry(b: BuildingDef): THREE.BufferGeometry {
  const pts: number[] = [];
  for (const t of b.tiers.length ? b.tiers : [{ ox: 0, oz: 0, w: b.width, d: b.depth, y0: 0, h: 0.4, shape: 'box' as const }]) {
    const w = t.w / 2 + 0.25;
    const d = (t.shape === 'box' ? t.d : t.w) / 2 + 0.25;
    const c = [
      [-w, -d],
      [w, -d],
      [w, d],
      [-w, d],
    ].map(([x, z]) => localToWorld(b.position.x, b.position.z, b.rotation, t.ox + x, t.oz + z));
    const y0 = t.y0;
    const y1 = t.y0 + t.h + 0.15;
    for (let i = 0; i < 4; i++) {
      const a = c[i];
      const n = c[(i + 1) % 4];
      pts.push(a.x, y0, a.z, n.x, y0, n.z, a.x, y1, a.z, n.x, y1, n.z, a.x, y0, a.z, a.x, y1, a.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function BuildingOutline({ id, color, beam }: { id: string; color: string; beam: boolean }) {
  const b = useSim((s) => s.buildingsById.get(id));
  const geo = useMemo(() => (b ? outlineGeometry(b) : null), [b]);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), toneMapped: false, transparent: true }), [color]);
  const beamMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }),
    [color],
  );
  useFrame(() => {
    mat.opacity = 0.65 + Math.sin(env.uTime.value * 4) * 0.3;
  });
  if (!b || !geo) return null;
  return (
    <group>
      <lineSegments geometry={geo} material={mat} />
      {beam && (
        <mesh position={[b.position.x, b.height + 40, b.position.z]} material={beamMat}>
          <cylinderGeometry args={[Math.max(b.width, b.depth) * 0.3, Math.max(b.width, b.depth) * 0.55, 80, 24, 1, true]} />
        </mesh>
      )}
    </group>
  );
}

function HighlightSet({ filter, color }: { filter: (b: BuildingDef) => boolean; color: string }) {
  const world = useSim((s) => s.world)!;
  const ref = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const out: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    for (const b of world.buildings) {
      if (!filter(b)) continue;
      for (const t of b.tiers.length ? b.tiers : [{ ox: 0, oz: 0, w: b.width, d: b.depth, y0: 0, h: 1, shape: 'box' as const }]) {
        const p = localToWorld(b.position.x, b.position.z, b.rotation, t.ox, t.oz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotation);
        out.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, t.y0 + t.h / 2, p.z), q, new THREE.Vector3(t.w + 0.5, t.h + 0.4, (t.shape === 'box' ? t.d : t.w) + 0.5)));
      }
    }
    return out;
  }, [world, filter]);
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    [color],
  );
  useLayoutEffect(() => {
    const m = ref.current!;
    items.forEach((mm, i) => m.setMatrixAt(i, mm));
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
  }, [items]);
  useFrame(() => (mat.opacity = 0.16 + Math.sin(env.uTime.value * 3) * 0.08));
  return <instancedMesh ref={ref} args={[new THREE.BoxGeometry(1, 1, 1), mat, Math.max(1, items.length)]} frustumCulled={false} />;
}

const enterable = (b: BuildingDef) => b.enterable;
const clickable = (b: BuildingDef) => b.named || b.enterable;

function EntityRing() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const sel = useUI.getState().selection;
    const sim = useSim.getState();
    let p: THREE.Vector3 | null = null;
    if (sel?.kind === 'citizen') {
      const idx = sim.citizensById.get(sel.id)?.index;
      if (idx !== undefined) p = citizenPosition(idx);
    } else if (sel?.kind === 'vehicle') {
      const idx = sim.vehicles.findIndex((v) => v.id === sel.id);
      if (idx >= 0) p = vehiclePosition(idx);
    }
    m.visible = !!p;
    if (p) {
      m.position.set(p.x, 0.25, p.z);
      m.scale.setScalar(1 + Math.sin(env.uTime.value * 5) * 0.12);
    }
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} visible={false}>
      <ringGeometry args={[1.1, 1.5, 32]} />
      <meshBasicMaterial color={new THREE.Color(3, 2.5, 0.4)} toneMapped={false} transparent opacity={0.9} depthWrite={false} />
    </mesh>
  );
}

/** Schematic transit map: bus stops as coloured pillars, lines linking consecutive stops. */
function TransitOverlay() {
  const world = useSim((s) => s.world)!;
  const data = useMemo(() => {
    const stops = new Map(world.busStops.map((s) => [s.id, s]));
    return world.busLines.map((l) => {
      const pts: number[] = [];
      const ids = [...l.stops, l.stops[0]];
      for (let i = 0; i < ids.length - 1; i++) {
        const a = stops.get(ids[i])!.position;
        const b = stops.get(ids[i + 1])!.position;
        pts.push(a.x, 9, a.z, b.x, 9, b.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      return { line: l, geo: g };
    });
  }, [world]);
  return (
    <group name="transit-overlay">
      {data.map(({ line, geo }) => (
        <lineSegments key={line.id} geometry={geo}>
          <lineBasicMaterial color={new THREE.Color(line.color).multiplyScalar(2)} toneMapped={false} transparent opacity={0.85} />
        </lineSegments>
      ))}
      {world.busStops.map((s) => {
        const line = world.busLines.find((l) => l.stops.includes(s.id));
        return (
          <mesh key={s.id} position={[s.position.x, 4.5, s.position.z]}>
            <cylinderGeometry args={[0.25, 0.25, 9, 6]} />
            <meshBasicMaterial color={new THREE.Color(line?.color ?? '#facc15').multiplyScalar(1.8)} toneMapped={false} transparent opacity={0.7} />
          </mesh>
        );
      })}
    </group>
  );
}

export function SelectionOverlay() {
  const selection = useUI((s) => s.selection);
  const hovered = useUI((s) => s.hovered);
  const highlight = useUI((s) => s.highlight);
  return (
    <group name="selection">
      {selection?.kind === 'building' && <BuildingOutline id={selection.id} color="#fde047" beam />}
      {hovered?.kind === 'building' && hovered.id !== (selection?.kind === 'building' ? selection.id : '') && (
        <BuildingOutline id={hovered.id} color="#67e8f9" beam={false} />
      )}
      {highlight === 'enterable' && <HighlightSet filter={enterable} color="#22d3ee" />}
      {highlight === 'clickable' && <HighlightSet filter={clickable} color="#e879f9" />}
      {highlight === 'transport' && <TransitOverlay />}
      <EntityRing />
    </group>
  );
}
