/**
 * Walk-in mode: the visitor's avatar, its movement (WASD / arrows / on-screen
 * stick / click to walk), a third-person camera (drag to look, wheel to zoom),
 * collision with buildings, Skyrail rides, and the "where am I" probe that
 * feeds the guest HUD and journal.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { displayName } from '@morphis/shared';
import { PedNav } from '@morphis/sim';
import { simClient } from '../../sim/client';
import { arrival, guestInput, guestPose, useGuest } from '../../state/guestStore';
import { useJournal } from '../../state/journalStore';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { characterGeometry, citizenMaterial } from '../citizens/Citizens';
import { railPoint } from '../rail/railGeo';
import { collidersFor } from './collision';
import { enterDoor, guestWave, takePostcard } from './actions';
import { sound } from '../../audio/engine';

const WALK = 4.2;
const RUN = 8;
const RADIUS = 0.45;

export function GuestController() {
  const world = useSim((s) => s.world)!;
  const look = useGuest((s) => s.look);
  const { camera, gl, raycaster, pointer } = useThree();
  const colliders = useMemo(() => collidersFor(world), [world]);
  const ped = useMemo(() => new PedNav(world.ped.nodes, world.ped.edges), [world]);
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const lastProbe = useRef(0);
  const mountedAt = useRef(performance.now());
  const camPitchNow = useRef(guestPose.camPitch);
  const ring = useRef<THREE.Mesh>(null);
  const climb = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number; then: 'wait' | 'street' } | null>(null);

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

  // ---- pointer: drag to look, click to walk, wheel to zoom
  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number; moved: boolean; button: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) < 4) return;
      down.moved = true;
      guestPose.camYaw -= e.movementX * 0.006;
      guestPose.camPitch = Math.max(0.04, Math.min(1.25, guestPose.camPitch + e.movementY * 0.004));
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || d.moved || d.button !== 0) return;
      if (useGuest.getState().ride) return;
      // click to walk: ground point under the cursor
      const rect = el.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return;
      if (hit.distanceTo(new THREE.Vector3(guestPose.x, 0, guestPose.z)) > 140) return;
      walkTo(hit.x, hit.z);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      guestPose.camDist = Math.max(3.5, Math.min(28, guestPose.camDist * (1 + e.deltaY * 0.0012)));
    };
    const onContext = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera]);

  // ---- keyboard
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
        guestInput.keys.add(k);
        guestPose.path = [];
        if (k.startsWith('arrow')) e.preventDefault();
      }
      if (e.repeat) return;
      if (k === 'q') guestWave();
      if (k === 'e') enterDoor();
      if (k === 'p') takePostcard();
      if (k === 'j') useUI.getState().togglePanel('journal');
      if (k === 'r') {
        useGuest.getState().exit();
        useUI.getState().requestCamera({ kind: 'overview' }, 'overview');
      }
      if (k === 'm') sound.setSettings({ ...sound.settings, enabled: !sound.settings.enabled });
    };
    const up = (e: KeyboardEvent) => guestInput.keys.delete(e.key.toLowerCase());
    const blur = () => guestInput.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      guestInput.keys.clear();
    };
  }, []);

  /** Walk to a point: straight when clear, otherwise along the sidewalks. */
  function walkTo(x: number, z: number) {
    const target = { x, z };
    const p = { x, z };
    colliders.resolve(p, RADIUS);
    target.x = p.x;
    target.z = p.z;
    if (!colliders.blocked(guestPose.x, guestPose.z, target.x, target.z)) {
      guestPose.path = [target];
      return;
    }
    const nearest = (px: number, pz: number) => {
      let best = 0;
      let bd = Infinity;
      for (const n of world.ped.nodes) {
        const d = (n.x - px) ** 2 + (n.z - pz) ** 2;
        if (d < bd) {
          bd = d;
          best = n.id;
        }
      }
      return best;
    };
    const route = ped.route(nearest(guestPose.x, guestPose.z), nearest(target.x, target.z));
    if (!route) {
      guestPose.path = [target];
      return;
    }
    const pts = route.map((st) => ({ x: world.ped.nodes[st.to].x, z: world.ped.nodes[st.to].z }));
    const first = route.length ? world.ped.nodes[route[0].from] : null;
    guestPose.path = [...(first ? [{ x: first.x, z: first.z }] : []), ...pts, target];
  }

  const tmpTarget = useMemo(() => new THREE.Vector3(), []);
  const tmpCam = useMemo(() => new THREE.Vector3(), []);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const railTmp = useMemo(() => ({ x: 0, z: 0, dx: 0, dz: 0 }), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(0.1, rawDt);
    const now = performance.now();
    const g = useGuest.getState();
    const line = world.rail;
    const sample = simClient.sampleMotion();
    let moving = 0;

    // ---------------- Skyrail ride (stairs, platform, train)
    const ride = g.ride;
    const cl = climb.current;
    if (cl) {
      const t = Math.min(1, (now - cl.t0) / cl.dur);
      guestPose.x = cl.from.x + (cl.to.x - cl.from.x) * t;
      guestPose.z = cl.from.z + (cl.to.z - cl.from.z) * t;
      guestPose.y = cl.from.y + (cl.to.y - cl.from.y) * t;
      guestPose.yaw = Math.atan2(cl.to.x - cl.from.x, cl.to.z - cl.from.z) || guestPose.yaw;
      moving = 1;
      if (t >= 1) {
        climb.current = null;
        if (cl.then === 'street') {
          guestPose.y = 0;
          useGuest.getState().setRide(null);
        }
      }
    } else if (ride && line) {
      const from = line.stations.find((s) => s.id === ride.fromId)!;
      const to = line.stations.find((s) => s.id === ride.toId)!;
      if (ride.phase === 'waiting') {
        if (guestPose.y < 1) {
          // climb the stair tower to the platform
          railPoint(line, from.s, railTmp);
          climb.current = {
            from: new THREE.Vector3(guestPose.x, 0, guestPose.z),
            to: new THREE.Vector3(railTmp.x - railTmp.dz * 1.9, line.height + 0.35, railTmp.z + railTmp.dx * 1.9),
            t0: now,
            dur: 1600,
            then: 'wait',
          };
        } else if (sample) {
          const k = sample.rail.findIndex((s) => Math.abs(s - from.s) < 0.08);
          if (k >= 0) useGuest.getState().setRide({ ...ride, phase: 'riding', train: k });
        }
        if (guestInput.keys.size || guestInput.stickX || guestInput.stickY) {
          // walked away: back down the stairs
          climb.current = { from: new THREE.Vector3(guestPose.x, guestPose.y, guestPose.z), to: new THREE.Vector3(from.access.x, 0, from.access.z), t0: now, dur: 1400, then: 'street' };
        }
      } else if (sample) {
        const s = sample.rail[ride.train];
        if (s !== undefined) {
          railPoint(line, s, railTmp);
          guestPose.x = railTmp.x;
          guestPose.z = railTmp.z;
          guestPose.y = line.height + 0.45;
          guestPose.yaw = Math.atan2(railTmp.dx, railTmp.dz);
          if (Math.abs(s - to.s) < 0.08) {
            useJournal.getState().ride();
            useUI.getState().notify(`Arrived at ${to.name}`);
            climb.current = { from: new THREE.Vector3(guestPose.x, guestPose.y, guestPose.z), to: new THREE.Vector3(to.access.x, 0, to.access.z), t0: now, dur: 1800, then: 'street' };
          }
        }
      }
    } else {
      // ---------------- walking
      const k = guestInput.keys;
      let ix = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + guestInput.stickX;
      let iz = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) + guestInput.stickY;
      const run = k.has('shift');
      let mx = 0;
      let mz = 0;
      if (ix || iz) {
        const l = Math.hypot(ix, iz);
        if (l > 1) {
          ix /= l;
          iz /= l;
        }
        // forward = away from the camera
        const fx = -Math.sin(guestPose.camYaw);
        const fz = -Math.cos(guestPose.camYaw);
        mx = fx * iz - fz * ix;
        mz = fz * iz + fx * ix;
      } else if (guestPose.path.length) {
        const wp = guestPose.path[0];
        const dx = wp.x - guestPose.x;
        const dz = wp.z - guestPose.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) guestPose.path.shift();
        else {
          mx = dx / d;
          mz = dz / d;
        }
      }
      if (mx || mz) {
        const sp = run ? RUN : WALK;
        const p = { x: guestPose.x + mx * sp * dt, z: guestPose.z + mz * sp * dt };
        colliders.resolve(p, RADIUS);
        const moved = Math.hypot(p.x - guestPose.x, p.z - guestPose.z);
        if (moved < sp * dt * 0.15 && guestPose.path.length) guestPose.path = []; // stuck: give up the click target
        guestPose.x = p.x;
        guestPose.z = p.z;
        const targetYaw = Math.atan2(mx, mz);
        let dy = targetYaw - guestPose.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        guestPose.yaw += dy * Math.min(1, dt * 12);
        moving = run ? 1.25 : 1;
      }
    }
    guestPose.speed = moving;

    // ---------------- avatar
    const grp = group.current;
    const m = mesh.current;
    if (grp && m) {
      grp.position.set(guestPose.x, guestPose.y + 0.12, guestPose.z);
      grp.rotation.y = guestPose.yaw;
      // landing ring: a burst when dropping in, then a soft marker at the feet
      if (ring.current) {
        const since = (now - arrival.at) / 700;
        const burst = since < 1 ? 1 + (1 - since) * 3.5 : 1;
        ring.current.scale.setScalar(burst);
        (ring.current.material as THREE.MeshBasicMaterial).opacity = since < 1 ? 0.95 : 0.55;
        ring.current.visible = guestPose.y < 1;
      }
      m4.makeScale(look.build, look.height, look.build);
      m.setMatrixAt(0, m4);
      m.instanceMatrix.needsUpdate = true;
      const anim = geo.getAttribute('aAnim') as THREE.InstancedBufferAttribute;
      anim.setXY(0, 0, moving ? Math.min(1, moving) : 0);
      anim.needsUpdate = true;
      const wv = geo.getAttribute('aWave') as THREE.InstancedBufferAttribute;
      const left = guestPose.waveUntil - now;
      wv.setX(0, left > 0 ? Math.min(1, (2200 - left) / 220, left / 260) : 0);
      wv.needsUpdate = true;
    }

    // ---------------- camera
    const ty = guestPose.y + 1.15;
    tmpTarget.set(guestPose.x, ty, guestPose.z);
    // keep the camera out of walls: first try looking from higher up, then move closer
    const clearDist = (pitch: number): number => {
      const cp = Math.cos(pitch);
      const dx = Math.sin(guestPose.camYaw) * cp;
      const dy = Math.sin(pitch);
      const dz = Math.cos(guestPose.camYaw) * cp;
      for (let d = 1; d <= guestPose.camDist; d += 0.5) {
        if (colliders.solidAt(guestPose.x + dx * d, guestPose.z + dz * d, ty + dy * d)) return Math.max(1.8, d - 0.6);
      }
      return guestPose.camDist;
    };
    let pitch = guestPose.camPitch;
    let dist = clearDist(pitch);
    for (const extra of [0.2, 0.4]) {
      if (dist >= guestPose.camDist * 0.8) break;
      const p2 = Math.min(1.35, guestPose.camPitch + extra);
      const d2 = clearDist(p2);
      if (d2 > dist) {
        pitch = p2;
        dist = d2;
      }
    }
    camPitchNow.current += (pitch - camPitchNow.current) * Math.min(1, dt * 4);
    const cp = Math.cos(camPitchNow.current);
    const dirx = Math.sin(guestPose.camYaw) * cp;
    const diry = Math.sin(camPitchNow.current);
    const dirz = Math.cos(guestPose.camYaw) * cp;
    tmpCam.set(guestPose.x + dirx * dist, Math.max(0.6, ty + diry * dist), guestPose.z + dirz * dist);
    // fly down from wherever the camera was (overview) on entering, then follow closely
    const intro = Math.min(1, (now - mountedAt.current) / 2200);
    camera.position.lerp(tmpCam, Math.min(1, dt * (intro < 1 ? 1.6 + intro * 4 : 10)));
    camera.lookAt(tmpTarget);

    // ---------------- where am I (4 Hz)
    if (now - lastProbe.current > 250) {
      lastProbe.current = now;
      probe();
    }
  });

  function probe() {
    const sim = useSim.getState();
    const g = useGuest.getState();
    const x = guestPose.x;
    const z = guestPose.z;
    // street
    let street = '';
    let sd = Infinity;
    for (const e of world.roads.edges) {
      const a = world.roads.nodes[e.a];
      const b = world.roads.nodes[e.b];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const l2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / l2));
      const d = Math.hypot(x - a.x - abx * t, z - a.z - abz * t);
      if (d < sd) {
        sd = d;
        street = e.name;
      }
    }
    if (sd > 14) {
      const dist = world.districts.reduce((best, d) => (Math.hypot(d.center.x - x, d.center.z - z) < Math.hypot(best.center.x - x, best.center.z - z) ? d : best), world.districts[0]);
      street = dist.name;
    }
    if (g.ride?.phase === 'riding') street = 'Skyrail';
    // nearest landmark
    let lm: { id: string; name: string; d: number } | null = null;
    for (const id of world.landmarks) {
      const b = sim.buildingsById.get(id);
      if (!b) continue;
      const d = Math.hypot(b.entrance.x - x, b.entrance.z - z);
      if (!lm || d < lm.d) lm = { id, name: displayName(b.name), d };
    }
    g.setPlace({ street, landmark: lm?.name ?? null, landmarkDist: Math.round((lm?.d ?? 0) * 2) });
    if (lm && lm.d < 14 && guestPose.y < 1) useJournal.getState().visit(lm.id);
    // door within reach
    let door: { id: string; name: string } | null = null;
    if (!g.ride && guestPose.y < 1) {
      let dd = 3.4;
      for (const b of world.buildings) {
        if (!b.enterable) continue;
        const d = Math.hypot(b.entrance.x - x, b.entrance.z - z);
        if (d < dd) {
          dd = d;
          door = { id: b.id, name: displayName(sim.businessByBuilding.get(b.id)?.name ?? b.name) };
        }
      }
    }
    g.setDoor(door);
    // skyrail stairs within reach
    let station: string | null = null;
    if (world.rail && !g.ride) {
      for (const s of world.rail.stations) if (Math.hypot(s.access.x - x, s.access.z - z) < 4.5) station = s.id;
    }
    g.setStation(station);
  }

  return (
    <group ref={group} name="guest">
      {/* a soft light that travels with the visitor so the street around them reads at night */}
      <pointLight position={[0, 2.6, 0.6]} color="#ffd9a8" intensity={14} distance={16} decay={1.6} />
      <instancedMesh ref={mesh} args={[geo, mat, 1]} castShadow frustumCulled={false} />
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.04}>
        <ringGeometry args={[0.55, 0.68, 40]} />
        <meshBasicMaterial color={new THREE.Color(look.eyes).multiplyScalar(1.6)} toneMapped={false} transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {/* visor: the guest's eyes */}
      <mesh position={[0, 0.925 * look.height, 0.086 * look.build]}>
        <boxGeometry args={[0.12, 0.028, 0.02]} />
        <meshBasicMaterial color={look.eyes} toneMapped={false} />
      </mesh>

    </group>
  );
}
