/** Fireflies drifting around the trees after dark (additive points, animated on the GPU). */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useSim } from '../../state/simStore';
import { env } from '../env';

export function Fireflies() {
  const trees = useSim((s) => s.world?.props.trees);
  const geo = useMemo(() => {
    const list = trees ?? [];
    const n = Math.min(1600, list.length * 2);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = list[i % list.length];
      const a = Math.sin(i * 12.9898) * 43758.5453;
      const r = (a - Math.floor(a)) * 3 + 0.5;
      const ang = i * 2.399;
      pos[i * 3] = t.x + Math.cos(ang) * r;
      pos[i * 3 + 1] = 1.2 + ((i * 0.37) % 1) * 3.2 * (t.s ?? 1);
      pos[i * 3 + 2] = t.z + Math.sin(ang) * r;
      seed[i] = (i * 0.618) % 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, [trees]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: env.uTime, uNight: env.uNight },
        vertexShader: /* glsl */ `
          uniform float uTime; uniform float uNight; attribute float aSeed; varying float vA;
          void main() {
            vec3 p = position;
            float t = uTime * (0.25 + aSeed * 0.3) + aSeed * 40.0;
            p += vec3(sin(t) * 0.9, sin(t * 1.7) * 0.5, cos(t * 1.3) * 0.9);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float blink = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 30.0);
            vA = smoothstep(0.55, 0.9, uNight) * blink;
            gl_PointSize = (2.0 + 3.0 * blink) * (60.0 / max(1.0, -mv.z));
          }`,
        fragmentShader: /* glsl */ `
          varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d) * vA;
            gl_FragColor = vec4(vec3(1.6, 1.5, 0.55) * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  if (!trees?.length) return null;
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}
