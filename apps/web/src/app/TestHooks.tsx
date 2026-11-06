/**
 * Exposes a small, read-only automation surface on window for end-to-end tests
 * (Playwright) and debugging: state access and world->screen projection.
 */
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { simClient } from '../sim/client';
import { useSim } from '../state/simStore';
import { useUI } from '../state/uiStore';
import { guestPose, useGuest } from '../state/guestStore';
import { useJournal } from '../state/journalStore';
import { perf } from '../scene/perf';

export function TestHooks() {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    const api = {
      simClient,
      sim: useSim,
      ui: useUI,
      guest: useGuest,
      guestPose,
      journal: useJournal,
      project(x: number, y: number, z: number) {
        const v = new THREE.Vector3(x, y, z).project(camera);
        const r = gl.domElement.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, visible: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 };
      },
      info() {
        return { calls: perf.calls, triangles: perf.triangles, fps: perf.fps, objects: scene.children.length };
      },
    };
    (window as unknown as { __morphis: typeof api }).__morphis = api;
  }, [camera, gl, scene]);
  return null;
}
