/**
 * City-management camera: pan (left drag), orbit (right drag), zoom to cursor,
 * smooth animated transitions, inertia, focus modes, citizen/vehicle follow and
 * a cinematic orbit.
 */
import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useSim } from '../../state/simStore';
import { useUI, type CameraRequest } from '../../state/uiStore';
import { citizenPosition, vehiclePosition } from '../positions';

export const OVERVIEW = { pos: [128, 168, 182] as const, target: [0, 0, 4] as const };

export function CameraRig() {
  const ref = useRef<CameraControlsImpl>(null);
  const { camera } = useThree();
  const req = useUI((s) => s.cameraRequest);
  const handled = useRef(0);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.mouseButtons.left = CameraControlsImpl.ACTION.TRUCK;
    c.mouseButtons.right = CameraControlsImpl.ACTION.ROTATE;
    c.mouseButtons.middle = CameraControlsImpl.ACTION.ROTATE;
    c.mouseButtons.wheel = CameraControlsImpl.ACTION.DOLLY;
    c.touches.one = CameraControlsImpl.ACTION.TOUCH_TRUCK;
    c.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY_ROTATE;
    c.dollyToCursor = true;
    c.minDistance = 4;
    c.maxDistance = 360;
    c.minPolarAngle = 0.12;
    c.maxPolarAngle = 1.44;
    c.smoothTime = 0.35;
    c.draggingSmoothTime = 0.12;
    c.truckSpeed = 1.6;
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-170, -1, -170), new THREE.Vector3(170, 120, 170)));
    c.setLookAt(...OVERVIEW.pos, ...OVERVIEW.target, false);
    (window as unknown as { __morphisCamera: CameraControlsImpl }).__morphisCamera = c;
  }, []);

  useEffect(() => {
    if (!req || req.id === handled.current) return;
    handled.current = req.id;
    run(req);
  }, [req]);

  function run(r: CameraRequest) {
    const c = ref.current;
    if (!c) return;
    const az = c.azimuthAngle;
    const from = (tx: number, ty: number, tz: number, dist: number, polar: number, azimuth = az) => {
      const x = tx + dist * Math.sin(polar) * Math.sin(azimuth);
      const y = ty + dist * Math.cos(polar);
      const z = tz + dist * Math.sin(polar) * Math.cos(azimuth);
      void c.setLookAt(x, y, z, tx, ty, tz, true);
    };
    switch (r.kind) {
      case 'overview':
        void c.setLookAt(...OVERVIEW.pos, ...OVERVIEW.target, true);
        break;
      case 'district':
        from(r.x ?? 0, 0, r.z ?? 0, (r.radius ?? 30) * 2.6 + 45, 0.95);
        break;
      case 'building': {
        const h = r.height ?? 20;
        from(r.x ?? 0, Math.min(h * 0.4, 30), r.z ?? 0, Math.max(34, h * 1.35), 1.1);
        break;
      }
      case 'street':
        from(r.x ?? 0, 1.4, r.z ?? 0, 16, 1.36);
        break;
      case 'point':
        from(r.x ?? 0, 0, r.z ?? 0, r.radius ?? 60, 0.95);
        break;
      case 'cinematic':
        void c.setLookAt(140, 70, 140, 0, 30, 0, true);
        break;
    }
  }

  useFrame((_, dt) => {
    const c = ref.current;
    if (!c) return;
    const ui = useUI.getState();
    if (ui.cameraMode === 'cinematic') {
      void c.rotate(dt * 0.06, Math.sin(performance.now() * 0.00011) * dt * 0.02, false);
    }
    if (ui.follow) {
      const sim = useSim.getState();
      let p: THREE.Vector3 | null = null;
      if (ui.follow.kind === 'citizen') {
        const idx = sim.citizensById.get(ui.follow.id)?.index;
        if (idx !== undefined) p = citizenPosition(idx);
      } else {
        const idx = sim.vehicles.findIndex((v) => v.id === ui.follow!.id);
        if (idx >= 0) p = vehiclePosition(idx);
      }
      if (p) void c.moveTo(p.x, p.y + 1, p.z, true);
    }
    void camera;
  });

  return <CameraControls ref={ref} makeDefault />;
}
