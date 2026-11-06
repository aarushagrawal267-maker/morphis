/** Shares the active camera with DOM overlays (projected labels) without React re-renders. */
import type * as THREE from 'three';

export const cameraBridge: { camera: THREE.Camera | null; width: number; height: number } = { camera: null, width: 1, height: 1 };
