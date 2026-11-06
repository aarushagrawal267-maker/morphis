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

export const PALETTE = [
  '#323c4d', '#20252f', '#3d3c46', '#464a53', '#4f4246', '#373e4b', '#283246', '#352c46', '#5a5f69', '#4b3d3f', '#43453f', '#4d4d4f', '#a3acb9',
].map((c) => new THREE.Color(c));

export const FACADE_INDEX: Record<string, number> = { glass: 0, grid: 1, ribbon: 2, panel: 3, industrial: 4, residential: 5, none: 6 };

export const GLSL_HASH = /* glsl */ `
float mHash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;
