/**
 * Walking inside a building: the guest's avatar moves through the rooms of
 * the interior layout (WASD / click / stick), the camera follows from above
 * and behind, and walking back through the entrance (or "Out") returns to
 * the street at the same door.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { guestInput, guestPose, useGuest } from '../../state/guestStore';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { characterGeometry, citizenMaterial } from '../citizens/Citizens';
import { planFor } from '../interiors/plan';
import { guestWave, takePostcard } from './actions';

const SCALE = 1.9; // interior plans are drawn at a larger scale than the street
const SPEED = 4.2;

/** Leave the building through its door, back onto the street. */
export function leaveInterior(): void {
  const ui = useUI.getState();
  ui.setFading(true);
  setTimeout(() => {
    useUI.getState().exitInterior();
    useUI.getState().select(null);
  }, 280);
  setTimeout(() => useUI.getState().setFading(false), 600);
}

export function InteriorGuest({ buildingId }: { buildingId: string }) {
  const b = useSim((s) => s.buildingsById.get(buildingId));
  const look = useGuest((s) => s.look);
  const floor = useUI((s) => s.interior?.floor ?? 0);
  const layout = useMemo(() => (b ? planFor(b, floor, b.name) : null), [b, floor]);
  const { camera, gl, raycaster, pointer } = useThree();
  const pose = useRef({ x: 0, z: 0, yaw: Math.PI, target: null as null | { x: number; z: number }, camYaw: 0 });
  const leaving = useRef(false);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);

  const bounds = useMemo(() => {
    if (!layout) return { x0: -10, x1: 10, z0: -10, z1: 10 };
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const r of layout.rooms) {
      x0 = Math.min(x0, r.x - r.w / 2 + 0.6);
      x1 = Math.max(x1, r.x + r.w / 2 - 0.6);
      z0 = Math.min(z0, r.z - r.d / 2 + 0.6);
      z1 = Math.max(z1, r.z + r.d / 2 - 0.6);
    }
    return { x0, x1, z0, z1 };
  }, [layout]);

  useEffect(() => {
    if (!layout) return;
    pose.current.x = layout.entrance.x;
    pose.current.z = Math.min(bounds.z1 - 0.5, layout.entrance.z - 1.5);
    pose.current.yaw = Math.PI;
    camera.position.set(layout.entrance.x, 9, layout.entrance.z + 9);
    leaving.current = false;
  }, [layout, bounds, camera]);

  const geo = useMemo(() => {
    const g = characterGeometry();
    const c = new THREE.Color();
    const col = (name: string, hex: string) => {
      c.set(hex).convertSRGBToLinear();
      g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array([c.r, c.g, c.b]), 3));
    };
    col('aTop', look.coat);
    col('aBottom', look.trousers);
    col('aSkin', look.skin);
    col('aHair', look.hair);
    g.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array([0, 0]), 2));
    g.setAttribute('aWave', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
    return g;
  }, [look]);
  const mat = useMemo(() => citizenMaterial(), []);

  // click on the floor to walk there
  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || e.button !== 0) return;
      const r = el.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) pose.current.target = { x: hit.x, z: hit.z };
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        pose.current.target = null;
        if (k.startsWith('arrow')) e.preventDefault();
      }
      if (e.repeat) return;
      if (k === 'q') guestWave();
      if (k === 'p') takePostcard();
      if (k === 'escape') leaveInterior();
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, camera, raycaster, pointer]);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, rawDt) => {
    if (!layout) return;
    const dt = Math.min(0.1, rawDt);
    const p = pose.current;
    const k = guestInput.keys;
    const ix = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + guestInput.stickX;
    const iz = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) + guestInput.stickY;
    let mx = 0;
    let mz = 0;
    if (ix || iz) {
      // camera looks toward -z: forward is -z, right is +x
      mx = ix;
      mz = -iz;
    } else if (p.target) {
      const dx = p.target.x - p.x;
      const dz = p.target.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) p.target = null;
      else {
        mx = dx / d;
        mz = dz / d;
      }
    }
    const l = Math.hypot(mx, mz);
    let moving = 0;
    if (l > 0) {
      mx /= Math.max(1, l);
      mz /= Math.max(1, l);
      p.x = Math.max(bounds.x0, Math.min(bounds.x1, p.x + mx * SPEED * dt));
      const nz = p.z + mz * SPEED * dt;
      // the entrance is the way out
      if (nz > bounds.z1 && Math.abs(p.x - layout.entrance.x) < 2.2 && !leaving.current) {
        leaving.current = true;
        leaveInterior();
      }
      p.z = Math.max(bounds.z0, Math.min(bounds.z1 + 0.6, nz));
      p.yaw = Math.atan2(mx, mz);
      moving = 1;
    }
    guestPose.speed = moving;
    const grp = group.current;
    const m = mesh.current;
    if (grp && m) {
      grp.position.set(p.x, 0, p.z);
      grp.rotation.y = p.yaw;
      m.setMatrixAt(0, new THREE.Matrix4().makeScale(look.build * SCALE, look.height * SCALE, look.build * SCALE));
      m.instanceMatrix.needsUpdate = true;
      const anim = geo.getAttribute('aAnim') as THREE.InstancedBufferAttribute;
      anim.setXY(0, 0, moving);
      anim.needsUpdate = true;
      const wv = geo.getAttribute('aWave') as THREE.InstancedBufferAttribute;
      const left = guestPose.waveUntil - performance.now();
      wv.setX(0, left > 0 ? Math.min(1, (2200 - left) / 220, left / 260) : 0);
      wv.needsUpdate = true;
    }
    tmp.set(p.x, 10.5, p.z + 8.5);
    camera.position.lerp(tmp, Math.min(1, dt * 6));
    camera.lookAt(p.x, 0.8, p.z - 0.5);
  });

  if (!layout) return null;
  return (
    <group ref={group} name="interior-guest">
      <instancedMesh ref={mesh} args={[geo, mat, 1]} castShadow frustumCulled={false} />
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
        <ringGeometry args={[0.7, 0.85, 32]} />
        <meshBasicMaterial color={new THREE.Color(look.eyes).multiplyScalar(1.6)} toneMapped={false} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}
