/**
 * Building interiors: a cut-away "dollhouse" view of the floor plan with
 * furniture, workstations, lighting and the building's real occupants placed
 * by what they are doing (working at desks, meeting, eating, sleeping...).
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CitizenProfile } from '@morphis/shared';
import { useSim } from '../../state/simStore';
import { useGuest } from '../../state/guestStore';
import { useUI } from '../../state/uiStore';
import { characterGeometry, citizenMaterial } from '../citizens/Citizens';
import { env } from '../env';
import { hash01 } from '../positions';
import { waveAmount, waves } from '../waves';
import { layoutFor, placeOccupants, type Furniture, type Layout, type Room } from './layouts';

const WALL_H = 2.6;

function label(text: string, color: string): THREE.SpriteMaterial {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(6,9,18,0.82)';
  g.fillRect(0, 0, 512, 96);
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.strokeRect(2, 2, 508, 92);
  g.fillStyle = '#fff';
  g.font = 'bold 40px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), 256, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true });
}

const M = {
  wall: new THREE.MeshStandardMaterial({ color: '#2a3140', roughness: 0.8 }),
  wood: new THREE.MeshStandardMaterial({ color: '#4a3b30', roughness: 0.7 }),
  metal: new THREE.MeshStandardMaterial({ color: '#3b4250', metalness: 0.6, roughness: 0.35 }),
  dark: new THREE.MeshStandardMaterial({ color: '#15181f', metalness: 0.4, roughness: 0.5 }),
  fabric: new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.95 }),
  white: new THREE.MeshStandardMaterial({ color: '#d7dde6', roughness: 0.6 }),
  plant: new THREE.MeshStandardMaterial({ color: '#2f7a4c', roughness: 0.9, flatShading: true }),
  screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.4, 2.0), toneMapped: false }),
  screenWarm: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 1.0, 0.4), toneMapped: false }),
  rackLight: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.4, 0.8), toneMapped: false }),
  holo: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.4, 3.0), wireframe: true, transparent: true, opacity: 0.9, toneMapped: false }),
};

function Box({ p, s, m, r = 0 }: { p: [number, number, number]; s: [number, number, number]; m: THREE.Material; r?: number }) {
  return (
    <mesh position={p} rotation-y={r} material={m} castShadow receiveShadow>
      <boxGeometry args={s} />
    </mesh>
  );
}

function Piece({ f }: { f: Furniture }) {
  const r = f.r ?? 0;
  const g = (children: React.ReactNode) => (
    <group position={[f.x, 0, f.z]} rotation-y={r}>
      {children}
    </group>
  );
  switch (f.kind) {
    case 'desk':
      return g(
        <>
          <Box p={[0, 0.72, 0]} s={[1.7, 0.06, 0.8]} m={M.wood} />
          <Box p={[-0.75, 0.36, 0]} s={[0.06, 0.72, 0.7]} m={M.metal} />
          <Box p={[0.75, 0.36, 0]} s={[0.06, 0.72, 0.7]} m={M.metal} />
          <Box p={[0, 1.05, -0.22]} s={[0.9, 0.55, 0.04]} m={M.dark} />
          <Box p={[0, 1.05, -0.195]} s={[0.84, 0.48, 0.01]} m={M.screen} />
        </>,
      );
    case 'chair':
      return g(
        <>
          <Box p={[0, 0.45, 0]} s={[0.5, 0.08, 0.5]} m={M.fabric} />
          <Box p={[0, 0.75, 0.24]} s={[0.5, 0.55, 0.06]} m={M.fabric} />
          <Box p={[0, 0.22, 0]} s={[0.08, 0.45, 0.08]} m={M.metal} />
        </>,
      );
    case 'table':
      return g(
        <>
          <Box p={[0, 0.74, 0]} s={[2.6, 0.08, 1.4]} m={M.wood} />
          <Box p={[0, 0.37, 0]} s={[0.3, 0.74, 0.3]} m={M.metal} />
        </>,
      );
    case 'sofa':
      return g(
        <>
          <Box p={[0, 0.3, 0]} s={[2.4, 0.5, 0.9]} m={M.fabric} />
          <Box p={[0, 0.75, -0.38]} s={[2.4, 0.5, 0.18]} m={M.fabric} />
        </>,
      );
    case 'rack':
      return g(
        <>
          <Box p={[0, 1.1, 0]} s={[1.6, 2.2, 0.9]} m={M.dark} />
          {[0.4, 0.8, 1.2, 1.6, 2.0].map((y) => (
            <Box key={y} p={[0, y, 0.46]} s={[1.3, 0.04, 0.01]} m={M.rackLight} />
          ))}
        </>,
      );
    case 'core':
      return <Core x={f.x} z={f.z} />;
    case 'shelf':
      return g(
        <>
          <Box p={[0, 1.1, 0]} s={[2.4, 2.2, 0.45]} m={M.wood} />
          {[0.5, 1.1, 1.7].map((y) => (
            <Box key={y} p={[0, y, 0.05]} s={[2.2, 0.35, 0.36]} m={y === 1.1 ? M.screenWarm : M.fabric} />
          ))}
        </>,
      );
    case 'screen':
      return g(
        <>
          <Box p={[0, 1.7, 0]} s={[5, 2.2, 0.12]} m={M.dark} />
          <Box p={[0, 1.7, 0.07]} s={[4.7, 1.95, 0.02]} m={M.screen} />
        </>,
      );
    case 'board':
      return g(<Box p={[0, 1.5, 0]} s={[4, 1.6, 0.08]} m={M.white} />);
    case 'bed':
      return g(
        <>
          <Box p={[0, 0.3, 0]} s={[2.2, 0.45, 2.6]} m={M.white} />
          <Box p={[0, 0.7, -1.25]} s={[2.2, 0.9, 0.12]} m={M.wood} />
        </>,
      );
    case 'counter':
      return g(
        <>
          <Box p={[0, 0.5, 0]} s={[4, 1, 0.7]} m={M.white} />
          <Box p={[0, 1.02, 0]} s={[4.05, 0.06, 0.75]} m={M.dark} />
        </>,
      );
    case 'plant':
      return g(
        <>
          <Box p={[0, 0.3, 0]} s={[0.6, 0.6, 0.6]} m={M.dark} />
          <mesh position={[0, 1.05, 0]} material={M.plant}>
            <icosahedronGeometry args={[0.55, 0]} />
          </mesh>
        </>,
      );
    case 'reception':
      return g(
        <>
          <Box p={[0, 0.55, 0]} s={[3.2, 1.1, 0.8]} m={M.dark} />
          <Box p={[0, 1.12, 0.41]} s={[3.2, 0.06, 0.02]} m={M.screen} />
        </>,
      );
    case 'bench':
      return g(
        <>
          <Box p={[0, 0.9, 0]} s={[3.2, 0.08, 1.1]} m={M.white} />
          <Box p={[0, 0.45, 0]} s={[3.0, 0.9, 0.9]} m={M.metal} />
          <Box p={[-0.8, 1.15, 0]} s={[0.4, 0.4, 0.4]} m={M.screen} />
          <Box p={[0.7, 1.05, -0.1]} s={[0.25, 0.25, 0.25]} m={M.rackLight} />
        </>,
      );
    case 'console':
      return g(
        <>
          <Box p={[0, 0.55, 0]} s={[1.6, 1.1, 0.6]} m={M.dark} />
          <Box p={[0, 1.2, -0.1]} s={[1.5, 0.6, 0.04]} m={M.screen} />
        </>,
      );
  }
}

function Core({ x, z }: { x: number; z: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.8;
    if (ring.current) ring.current.rotation.z += dt * 0.5;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position-y={0.3} material={M.dark}>
        <cylinderGeometry args={[1.6, 1.8, 0.6, 24]} />
      </mesh>
      <mesh ref={ref} position-y={1.9} material={M.holo}>
        <icosahedronGeometry args={[1.05, 1]} />
      </mesh>
      <mesh ref={ring} position-y={1.9} rotation-x={Math.PI / 2} material={M.screen}>
        <torusGeometry args={[1.5, 0.04, 8, 64]} />
      </mesh>
      <pointLight position={[0, 2, 0]} color="#22d3ee" intensity={18} distance={9} decay={2} />
    </group>
  );
}

function RoomShell({ room, index, active }: { room: Room; index: number; active: boolean }) {
  const floor = useMemo(() => new THREE.MeshStandardMaterial({ color: room.floor, roughness: 0.55, metalness: 0.2 }), [room.floor]);
  const strip = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(room.light).multiplyScalar(active ? 2.4 : 1.2), toneMapped: false }), [room.light, active]);
  const sprite = useMemo(() => label(room.name, room.light), [room.name, room.light]);
  const hw = room.w / 2;
  const hd = room.d / 2;
  const door = 2.2;
  const t = 0.18;
  return (
    <group position={[room.x, 0, room.z]} onClick={(e) => { e.stopPropagation(); useUI.getState().setRoom(index); }}>
      <mesh position-y={-0.05} material={floor} receiveShadow>
        <boxGeometry args={[room.w, 0.1, room.d]} />
      </mesh>
      {/* back and side walls; the front wall has a doorway */}
      <Box p={[0, WALL_H / 2, -hd]} s={[room.w, WALL_H, t]} m={M.wall} />
      <Box p={[-hw, WALL_H / 2, 0]} s={[t, WALL_H, room.d]} m={M.wall} />
      <Box p={[hw, WALL_H / 2, 0]} s={[t, WALL_H, room.d]} m={M.wall} />
      <Box p={[-(hw + door / 2) / 2, 0.5, hd]} s={[hw - door / 2, 1, t]} m={M.wall} />
      <Box p={[(hw + door / 2) / 2, 0.5, hd]} s={[hw - door / 2, 1, t]} m={M.wall} />
      {/* ceiling light strip on top of the back wall */}
      <Box p={[0, WALL_H + 0.05, -hd]} s={[room.w, 0.08, 0.22]} m={strip} />
      <pointLight position={[0, 3.4, 0]} color={room.light} intensity={active ? 26 : 14} distance={Math.max(room.w, room.d) * 1.3} decay={1.6} />
      <sprite material={sprite} position={[0, WALL_H + 1.1, -hd + 0.4]} scale={[4, 0.75, 1]} />
    </group>
  );
}

/** Real occupants of the building, seated or standing according to their activity. */
function Occupants({ buildingId, layout }: { buildingId: string; layout: Layout }) {
  const state = useSim((s) => s.state);
  const profiles = useSim((s) => s.citizens);
  const occupants = useMemo(() => {
    if (!state) return [] as { p: CitizenProfile; activity: string }[];
    const out: { p: CitizenProfile; activity: string }[] = [];
    state.citizens.forEach((d, i) => {
      if (d.location.kind === 'building' && d.location.id === buildingId) out.push({ p: profiles[i], activity: d.activity });
    });
    return out.slice(0, 120);
  }, [state, profiles, buildingId]);
  const key = occupants.map((o) => `${o.p.id}:${o.activity}`).join(',');

  const placements = useMemo(() => placeOccupants(layout, occupants, hash01), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = Math.max(1, placements.length);
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const g = characterGeometry();
    const col = (attr: string, f: (p: CitizenProfile) => string) => {
      const arr = new Float32Array(n * 3);
      const c = new THREE.Color();
      placements.forEach((pl, i) => {
        c.set(f(pl.o.p)).convertSRGBToLinear();
        arr.set([c.r, c.g, c.b], i * 3);
      });
      g.setAttribute(attr, new THREE.InstancedBufferAttribute(arr, 3));
    };
    col('aTop', (p) => p.appearance.top);
    col('aBottom', (p) => p.appearance.bottom);
    col('aSkin', (p) => p.appearance.skin);
    col('aHair', (p) => p.appearance.hair);
    const anim = new Float32Array(n * 2);
    placements.forEach((pl, i) => anim.set([hash01(i) * 6, pl.pose === 'stand' ? 0.05 : 0], i * 2));
    g.setAttribute('aAnim', new THREE.InstancedBufferAttribute(anim, 2));
    g.setAttribute('aWave', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    return g;
  }, [placements, n]);
  const mat = useMemo(() => citizenMaterial(), []);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    placements.forEach((pl, i) => {
      const lie = pl.pose === 'lie';
      e.set(lie ? -Math.PI / 2 : 0, pl.r, 0, 'YXZ');
      q.setFromEuler(e);
      const y = pl.pose === 'sit' ? 0.12 : lie ? 0.62 : 0;
      const h = pl.o.p.appearance.height * 1.9;
      const s = pl.o.p.appearance.build * 1.9;
      m.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(pl.x, y, pl.z), q, new THREE.Vector3(s, pl.pose === 'sit' ? h * 0.82 : h, s)));
    });
    m.count = placements.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [placements]);

  useFrame(() => {
    if (!waves.size) return;
    const attr = geo.getAttribute('aWave') as THREE.InstancedBufferAttribute;
    const now = performance.now();
    placements.forEach((pl, i) => attr.setX(i, waveAmount(pl.o.p.index, now)));
    attr.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={ref}
      args={[geo, mat, n]}
      castShadow
      frustumCulled={false}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (e.instanceId === undefined || e.delta > 6) return;
        e.stopPropagation();
        const pl = placements[e.instanceId];
        if (pl) useUI.getState().select({ kind: 'citizen', id: pl.o.p.id });
      }}
    />
  );
}

export function Interior({ buildingId }: { buildingId: string }) {
  const b = useSim((s) => s.buildingsById.get(buildingId));
  const roomIndex = useUI((s) => s.interior?.room ?? 0);
  const layout = useMemo(() => (b ? layoutFor(b.interior ?? 'office', b.name) : null), [b]);

  // camera: start at the entrance, glide to the floor-plan overview / selected room
  const entered = useRef(false);
  useEffect(() => {
    const cam = (window as unknown as { __morphisCamera?: { setLookAt: (...a: (number | boolean)[]) => Promise<void> } }).__morphisCamera;
    if (!cam || !layout || useGuest.getState().active) return; // a walking guest drives the camera
    if (!entered.current) {
      entered.current = true;
      void cam.setLookAt(layout.entrance.x, 2.2, layout.entrance.z + 10, layout.entrance.x, 1.2, layout.entrance.z - 4, false);
      setTimeout(() => void cam.setLookAt(0, 30, 31, 0, 0, 1, true), 60);
      return;
    }
    const r = layout.rooms[roomIndex];
    if (r) void cam.setLookAt(r.x, 10, r.z + 10, r.x, 0.5, r.z, true);
  }, [layout, roomIndex]);

  useFrame(() => {
    M.rackLight.color.setRGB(0.3, 2.4 * (Math.sin(env.uTime.value * 6) > -0.6 ? 1 : 0.2), 0.8);
  });

  if (!b || !layout) return null;
  return (
    <group name="interior">
      <color attach="background" args={['#05070d']} />
      <ambientLight intensity={0.55} color="#9db3d6" />
      <hemisphereLight args={['#b9c8ff', '#1a1020', 0.6]} />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.12} receiveShadow>
        <planeGeometry args={[80, 60]} />
        <meshStandardMaterial color="#0a0d14" roughness={0.9} />
      </mesh>
      {layout.rooms.map((r, i) => (
        <group key={r.name}>
          <RoomShell room={r} index={i} active={i === roomIndex} />
          {r.furniture.map((f, k) => (
            <Piece key={k} f={f} />
          ))}
        </group>
      ))}
      <Occupants buildingId={buildingId} layout={layout} />
    </group>
  );
}
