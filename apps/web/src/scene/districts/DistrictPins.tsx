/**
 * Floating district markers anchored to real district centres: a glowing
 * ground endpoint, a coloured connection line and an HTML label card.
 * Also renders the highlight of the selected district's buildings.
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { District } from '@morphis/shared';
import { localToWorld } from '@morphis/sim';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { env } from '../env';

export function focusDistrict(d: District) {
  const ui = useUI.getState();
  ui.select({ kind: 'district', id: d.id });
  ui.requestCamera({ kind: 'district', x: d.center.x, z: d.center.z, radius: d.radius }, 'district');
}

export function pinAnchor(d: District, world: NonNullable<ReturnType<typeof useSim.getState>['world']>): { x: number; z: number; h: number } {
  // place the pin over the district's tallest landmark-free open spot near its centre
  const inD = world.buildings.filter((b) => b.districtId === d.id);
  const tallest = inD.reduce((m, b) => Math.max(m, b.height), 0);
  const h = Math.min(110, Math.max(38, tallest + 14));
  return { x: d.center.x, z: d.center.z, h };
}

export function DistrictPins() {
  const world = useSim((s) => s.world)!;
  const pins = useUI((s) => s.pins);
  const selected = useUI((s) => (s.selection?.kind === 'district' ? s.selection.id : null));
  const anchors = useMemo(() => world.districts.filter((d) => d.type !== 'central').map((d) => ({ d, ...pinAnchor(d, world) })), [world]);
  if (!pins) return <DistrictHighlight id={selected} />;
  return (
    <group name="district-pins">
      {anchors.map(({ d, x, z, h }) => (
        <group key={d.id} position={[x, 0, z]}>
          <mesh position-y={h / 2}>
            <cylinderGeometry args={[0.07, 0.07, h, 6]} />
            <meshBasicMaterial color={new THREE.Color(d.color).multiplyScalar(1.6)} transparent opacity={0.75} toneMapped={false} />
          </mesh>
          <PinBase color={d.color} active={selected === d.id} />

        </group>
      ))}
      <DistrictHighlight id={selected} />
    </group>
  );
}

function PinBase({ color, active }: { color: string; active: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false }), [color]);
  useFrame(() => {
    if (!ring.current) return;
    const t = (env.uTime.value * 0.6) % 1;
    ring.current.scale.setScalar(1 + t * (active ? 5 : 3));
    mat.opacity = (1 - t) * 0.8;
  });
  return (
    <group position-y={0.25}>
      <mesh>
        <sphereGeometry args={[0.55, 12, 8]} />
        <meshBasicMaterial color={new THREE.Color(color).multiplyScalar(2.5)} toneMapped={false} />
      </mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} material={mat}>
        <ringGeometry args={[0.8, 1.0, 32]} />
      </mesh>
    </group>
  );
}

/** Translucent overlay on every building of the selected district. */
export function DistrictHighlight({ id }: { id: string | null }) {
  const world = useSim((s) => s.world)!;
  const ref = useRef<THREE.InstancedMesh>(null);
  const district = id ? world.districts.find((d) => d.id === id) : null;
  const boxes = useMemo(() => {
    if (!district) return [];
    const out: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    for (const b of world.buildings) {
      if (b.districtId !== district.id) continue;
      for (const t of b.tiers) {
        const p = localToWorld(b.position.x, b.position.z, b.rotation, t.ox, t.oz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotation);
        out.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, t.y0 + t.h / 2, p.z), q, new THREE.Vector3(t.w + 0.4, t.h + 0.3, (t.shape === 'box' ? t.d : t.w) + 0.4)));
      }
    }
    return out;
  }, [district, world]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }), []);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    boxes.forEach((b, i) => m.setMatrixAt(i, b));
    m.count = boxes.length;
    m.instanceMatrix.needsUpdate = true;
    if (district) mat.color.set(district.color).multiplyScalar(1.5);
  }, [boxes, district, mat]);
  if (!district) return null;
  return (
    <group>
      <instancedMesh ref={ref} args={[new THREE.BoxGeometry(1, 1, 1), mat, Math.max(1, boxes.length)]} frustumCulled={false} />
      <mesh rotation-x={-Math.PI / 2} position={[district.center.x, 0.2, district.center.z]}>
        <ringGeometry args={[district.radius - 0.6, district.radius, 96]} />
        <meshBasicMaterial color={new THREE.Color(district.color).multiplyScalar(1.8)} transparent opacity={0.7} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}
