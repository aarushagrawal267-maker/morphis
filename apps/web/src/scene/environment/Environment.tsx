/**
 * Day/night cycle and weather. Everything here is driven by the interpolated
 * simulation time and the simulation's weather state.
 */
import { Environment as DreiEnvironment, Lightformer } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { daylight, hourOf } from '@morphis/shared';
import { simClient } from '../../sim/client';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { GLSL_HASH, env } from '../env';
import { IslandGround, onGroundClick } from './Island';

const C = (h: string) => new THREE.Color(h);
const SKY = {
  dayZenith: C('#3f6c9e'),
  dayHorizon: C('#b7c9da'),
  duskZenith: C('#251c49'),
  duskHorizon: C('#e0745a'),
  nightZenith: C('#02040c'),
  nightHorizon: C('#0e1f45'),
  stormZenith: C('#1b2029'),
  stormHorizon: C('#3b4350'),
};

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const skyFrag = /* glsl */ `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSun; uniform float uNight; uniform float uCloud; uniform float uTime;
varying vec3 vDir;
${GLSL_HASH}
void main() {
  float h = max(vDir.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
  // aurora ribbons over the island at night
  float az = atan(vDir.z, vDir.x);
  float band = exp(-pow((h - 0.32 - 0.06 * sin(az * 3.0 + uTime * 0.05)) * 7.0, 2.0));
  float curtain = 0.55 + 0.45 * sin(az * 23.0 + sin(az * 7.0 + uTime * 0.15) * 3.0);
  col += mix(vec3(0.05, 0.55, 0.45), vec3(0.35, 0.2, 0.75), 0.5 + 0.5 * sin(az * 2.0)) * band * curtain * 0.32 * uNight * (1.0 - uCloud);
  // below the horizon: the sea of clouds fades into haze
  col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.08, vDir.y));
  // sun / moon disc
  float d = dot(normalize(vDir), normalize(uSun));
  col += vec3(1.0, 0.85, 0.6) * pow(max(d, 0.0), 900.0) * 6.0 * (1.0 - uNight) * (1.0 - uCloud);
  col += vec3(1.0, 0.7, 0.45) * pow(max(d, 0.0), 12.0) * 0.25 * (1.0 - uNight) * (1.0 - uCloud);
  vec3 moonDir = normalize(vec3(-uSun.x, abs(uSun.y) + 0.25, -uSun.z));
  float md = dot(normalize(vDir), moonDir);
  col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9975, 0.9982, md) * uNight * (1.0 - uCloud * 0.8);
  col += vec3(0.35, 0.45, 0.8) * pow(max(md, 0.0), 120.0) * 0.5 * uNight * (1.0 - uCloud * 0.8);
  // stars
  vec2 sp = vec2(atan(vDir.z, vDir.x) * 120.0, vDir.y * 220.0);
  float st = mHash12(floor(sp));
  float star = step(0.9965, st) * smoothstep(0.05, 0.4, h) * uNight * (1.0 - uCloud);
  col += vec3(star) * (0.6 + 0.4 * sin(uTime * 2.0 + st * 40.0));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function SkyDome() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uZenith: { value: SKY.nightZenith.clone() },
          uHorizon: { value: SKY.nightHorizon.clone() },
          uSun: { value: new THREE.Vector3(0, 1, 0) },
          uNight: env.uNight,
          uCloud: { value: 0 },
          uTime: env.uTime,
        },
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useFrame(({ camera }) => {
    mat.uniforms.uSun.value.copy(env.sunDir);
    mat.uniforms.uZenith.value.copy(skyColors.zenith);
    mat.uniforms.uHorizon.value.copy(skyColors.horizon);
    mat.uniforms.uCloud.value = skyColors.cloud;
    meshRef.current?.position.copy(camera.position);
  });
  const meshRef = useRef<THREE.Mesh>(null);
  return (
    <mesh ref={meshRef} material={mat} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[900, 32, 16]} />
    </mesh>
  );
}

const skyColors = { zenith: new THREE.Color(), horizon: new THREE.Color(), fog: new THREE.Color(), cloud: 0 };

export function EnvironmentController() {
  const { scene, gl } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const shadows = useUI((s) => s.quality.shadows);
  const fog = useMemo(() => new THREE.FogExp2('#0a0b16', 0.003), []);
  const lightning = useRef(0);

  useLayoutEffect(() => {
    scene.fog = fog;
    gl.shadowMap.enabled = shadows;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog, gl, shadows]);

  useFrame((state, dt) => {
    env.uTime.value += dt;
    simClient.sampleMotion();
    const t = simClient.renderTime();
    env.simTime = t;
    const weather = useSim.getState().state?.weather;
    const day = daylight(t);
    const night = 1 - day;
    const h = hourOf(t);
    const dusk = Math.max(0, 1 - Math.abs(h - 19.4) / 1.4) + Math.max(0, 1 - Math.abs(h - 6.1) / 1.2);
    // smooth environment values (avoid popping when state frames arrive)
    const k = Math.min(1, dt * 1.5);
    env.uNight.value += (night - env.uNight.value) * Math.min(1, dt * 4);
    const raining = weather && (weather.kind === 'rain' || weather.kind === 'storm') ? weather.intensity : 0;
    const fogging = weather && weather.kind === 'fog' ? weather.intensity : 0;
    const storm = weather && weather.kind === 'storm' ? weather.intensity : 0;
    env.uRain.value += (raining - env.uRain.value) * k;
    env.uWet.value += ((weather?.wetness ?? 0) - env.uWet.value) * k;
    env.uFog.value += (fogging - env.uFog.value) * k;
    const cloud = Math.min(1, env.uRain.value * 0.9 + env.uFog.value * 0.6);

    // sun path: rises in the east (+x), sets in the west
    const ang = ((h - 6) / 12) * Math.PI;
    env.sunDir.set(Math.cos(ang) * 0.8, Math.sin(ang), 0.45).normalize();

    // sky colours
    const zen = skyColors.zenith.copy(SKY.nightZenith).lerp(SKY.dayZenith, day).lerp(SKY.duskZenith, Math.min(1, dusk) * 0.65);
    const hor = skyColors.horizon.copy(SKY.nightHorizon).lerp(SKY.dayHorizon, day).lerp(SKY.duskHorizon, Math.min(1, dusk) * 0.7);
    zen.lerp(SKY.stormZenith, cloud * day * 0.8);
    hor.lerp(SKY.stormHorizon, cloud * day * 0.8);
    skyColors.cloud = cloud;
    skyColors.fog.copy(hor).lerp(zen, 0.35).multiplyScalar(0.9);
    fog.color.copy(skyColors.fog);
    fog.density = useUI.getState().interior ? 0 : 0.0010 + night * 0.0004 + env.uRain.value * 0.0022 + env.uFog.value * 0.0105;

    // lightning flashes during storms
    if (storm > 0.5 && Math.random() < dt * 0.25) lightning.current = 1;
    lightning.current = Math.max(0, lightning.current - dt * 3.5);
    const flash = lightning.current * (Math.random() > 0.4 ? 1 : 0.3);

    if (sun.current) {
      const s = sun.current;
      const above = env.sunDir.y > -0.05;
      const dir = above ? env.sunDir : new THREE.Vector3(-env.sunDir.x, Math.abs(env.sunDir.y) + 0.35, -env.sunDir.z).normalize();
      s.position.copy(dir).multiplyScalar(220);
      s.target.position.set(0, 0, 0);
      s.target.updateMatrixWorld();
      const sunI = above ? (3.9 * day + 0.15) * (1 - cloud * 0.6) : 0.3;
      s.intensity = sunI + flash * 3;
      s.color.set(above ? (dusk > 0.3 ? '#ffb47a' : '#fff1dc') : '#8fa8ff');
    }
    if (hemi.current) {
      hemi.current.intensity = 0.95 + day * 1.55 + flash * 2;
      hemi.current.color.copy(zen).lerp(new THREE.Color('#b9c8ff'), 0.4);
      hemi.current.groundColor.set(night > 0.5 ? '#241a38' : '#2a2a30');
    }
    if (ambient.current) {
      ambient.current.intensity = 0.16 + night * 0.4;
      ambient.current.color.set('#5b6fd0');
    }
    scene.environmentIntensity = 0.3 + day * 1.2;
    void state;
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={['#9db3c7', '#202024', 0.8]} />
      <ambientLight ref={ambient} intensity={0.15} />
      <directionalLight
        ref={sun}
        castShadow={shadows}
        intensity={2}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-150}
        shadow-camera-right={150}
        shadow-camera-top={150}
        shadow-camera-bottom={-150}
        shadow-camera-near={20}
        shadow-camera-far={600}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      />
      <DreiEnvironment frames={1} resolution={128}>
        <Lightformer form="rect" intensity={2} color="#7dd3fc" position={[0, 6, -12]} scale={[30, 3, 1]} />
        <Lightformer form="rect" intensity={2.5} color="#e879f9" position={[-14, 3, 4]} rotation={[0, Math.PI / 2, 0]} scale={[14, 2, 1]} />
        <Lightformer form="rect" intensity={1.5} color="#fbbf24" position={[14, 2, 6]} rotation={[0, -Math.PI / 2, 0]} scale={[12, 1.5, 1]} />
        <Lightformer form="circle" intensity={1.2} color="#ffffff" position={[0, 14, 0]} rotation={[Math.PI / 2, 0, 0]} scale={8} />
      </DreiEnvironment>
    </>
  );
}

/** Rain streaks around the camera, density from the simulated weather. */
export function Rain() {
  const COUNT = 7000;
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      p[i * 3] = (Math.random() - 0.5) * 160;
      p[i * 3 + 1] = Math.random() * 70;
      p[i * 3 + 2] = (Math.random() - 0.5) * 160;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: env.uTime, uRain: env.uRain, uOrigin: { value: new THREE.Vector3() }, uNight: env.uNight },
        vertexShader: /* glsl */ `
          uniform float uTime; uniform vec3 uOrigin; uniform float uRain;
          varying float vA;
          void main() {
            vec3 p = position;
            p.y = mod(p.y - uTime * 38.0, 70.0);
            p.xz = mod(p.xz - uOrigin.xz + 80.0, 160.0) - 80.0;
            vec4 mv = modelViewMatrix * vec4(p + vec3(uOrigin.x, 0.0, uOrigin.z), 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(260.0 / -mv.z, 1.0, 26.0);
            vA = step(fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453), uRain);
          }`,
        fragmentShader: /* glsl */ `
          varying float vA; uniform float uNight;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float streak = (1.0 - smoothstep(0.0, 0.06, abs(c.x))) * (1.0 - smoothstep(0.3, 0.5, abs(c.y)));
            float a = streak * vA * 0.38;
            if (a < 0.01) discard;
            gl_FragColor = vec4(mix(vec3(0.75, 0.82, 0.92), vec3(0.6, 0.7, 1.0), uNight), a);
          }`,
      }),
    [],
  );
  useFrame(({ camera }) => {
    const pts = ref.current;
    if (!pts) return;
    pts.visible = env.uRain.value > 0.02;
    const target = new THREE.Vector3();
    camera.getWorldDirection(target);
    mat.uniforms.uOrigin.value.set(camera.position.x + target.x * 40, 0, camera.position.z + target.z * 40);
  });
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} />;
}

/** Ground plane plus park lawns. */
export function Ground() {
  const world = useSim((s) => s.world)!;
  const groundMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0f1218', roughness: 0.95, metalness: 0 }), []);
  const lawnMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1d3b2a', roughness: 1 }), []);
  const pathMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a4f58', roughness: 0.9 }), []);
  const parks = useMemo(() => world.buildings.filter((b) => b.type === 'park' || b.type === 'plaza'), [world]);
  const lotMat = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2b2f37';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
    g.strokeStyle = 'rgba(10,12,16,0.5)';
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 128); g.stroke();
      g.beginPath(); g.moveTo(0, i * 32); g.lineTo(128, i * 32); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(60, 60);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, color: '#8a909c' });
  }, []);
  useFrame(() => {
    groundMat.roughness = 0.95 - env.uWet.value * 0.5;
    lotMat.roughness = 0.92 - env.uWet.value * 0.5;
  });
  const half = world.size / 2;
  return (
    <group name="ground">
      {world.island ? (
        <IslandGround world={world} lotMat={lotMat} />
      ) : (
        <>
          <mesh rotation-x={-Math.PI / 2} position-y={-0.02} material={groundMat} receiveShadow>
            <planeGeometry args={[3000, 3000]} />
          </mesh>
          {/* city block surface (slightly lighter than the outlying land) */}
          <mesh rotation-x={-Math.PI / 2} position-y={-0.01} material={lotMat} receiveShadow onClick={onGroundClick}>
            <planeGeometry args={[half * 2 - 10, half * 2 - 10]} />
          </mesh>
        </>
      )}
      {parks.map((p) => (
        <group key={p.id} position={[p.position.x, 0, p.position.z]} rotation-y={p.rotation}>
          <mesh material={lawnMat} position-y={0.06} receiveShadow>
            <boxGeometry args={[p.width, 0.12, p.depth]} />
          </mesh>
          <mesh material={pathMat} position-y={0.13} receiveShadow>
            <boxGeometry args={[1.6, 0.03, p.depth]} />
          </mesh>
          <mesh material={pathMat} position-y={0.13} receiveShadow>
            <boxGeometry args={[p.width, 0.03, 1.4]} />
          </mesh>
          <mesh material={pathMat} position-y={0.13} rotation-x={-Math.PI / 2} receiveShadow>
            <ringGeometry args={[2.6, 3.6, 24]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
