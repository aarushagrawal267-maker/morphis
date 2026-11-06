/**
 * Shared shader uniforms and environment values, written once per frame by the
 * EnvironmentController and read by every custom material.
 */
import * as THREE from 'three';

export const env = {
  uTime: { value: 0 },
  /** 0 = full day, 1 = full night */
  uNight: { value: 0 },
  uWet: { value: 0 },
  uRain: { value: 0 },
  uFog: { value: 0 },
  uHighlight: { value: 0 },
  simTime: 0,
  sunDir: new THREE.Vector3(0.4, 0.8, 0.3),
};

/** Facade colours: soft pastels that read warm under street light and cool under the moon. */
export const PALETTE = [
  '#7d8fb3', '#5d6a8a', '#c99aa6', '#a7b89a', '#d6c29a', '#9a8cc0', '#6f8fa3', '#8e7aa8', '#cfc4b2', '#c58e74', '#8d8a7c', '#7a7f88', '#e2e0dc',
].map((c) => new THREE.Color(c));

/** Pitched-roof colours: slate, terracotta, teal tile, plum, moss. */
export const ROOF_PALETTE = ['#3d4560', '#8c4f3f', '#2f5f66', '#5c3d63', '#4b5a3a', '#6b4a3a'].map((c) => new THREE.Color(c));

/** Shop awning colours. */
export const AWNING_PALETTE = ['#e11d48', '#0ea5e9', '#f59e0b', '#10b981', '#a855f7', '#f472b6'].map((c) => new THREE.Color(c));

export const FACADE_INDEX: Record<string, number> = { glass: 0, grid: 1, ribbon: 2, panel: 3, industrial: 4, residential: 5, none: 6 };

export const GLSL_HASH = /* glsl */ `
float mHash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;
