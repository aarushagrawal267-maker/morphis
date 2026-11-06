/**
 * JARVIS HQ landmark extras: plaza with glowing rings, vertical light seams,
 * rotating holographic rings, a beacon beam and a floating core hologram.
 * The tower massing itself is rendered by Buildings (so it is selectable).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSim } from '../../state/simStore';
import { env } from '../env';

function plazaTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 1024);
  g.translate(512, 512);
  for (const [r, w, col] of [
    [500, 6, '#22d3ee'],
    [430, 3, '#0e7490'],
    [360, 8, '#22d3ee'],
    [250, 3, '#e879f9'],
  ] as const) {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = '#0891b2';
  g.lineWidth = 3;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * 370, Math.sin(a) * 370);
    g.lineTo(Math.cos(a) * 495, Math.sin(a) * 495);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function HQ() {
  const world = useSim((s) => s.world)!;
  const hq = world.buildings.find((b) => b.id === world.hqId)!;
  const tower = hq.tiers[1];
  const top = hq.height;
  const ringsRef = useRef<THREE.Group>(null);
  const holoRef = useRef<THREE.Mesh>(null);
  const beamMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#22d3ee'), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    [],
  );
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.2, 2.6), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  );
  const ringMat2 = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.5, 2.6), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  );
  const seamMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.6, 3.0), toneMapped: false }), []);
  const plazaMat = useMemo(() => {
    const t = plazaTexture();
    return new THREE.MeshStandardMaterial({ color: '#1b1f27', emissiveMap: t, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.4 });
  }, []);
  const holoMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.4, 3.0), wireframe: true, transparent: true, opacity: 0.9, toneMapped: false }),
    [],
  );

  // vertical light seams on the hex tower corners
  const seams = useMemo(() => {
    const out: { x: number; z: number; y: number; h: number }[] = [];
    const r = tower.w / 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: tower.y0, h: tower.h });
    }
    const upper = hq.tiers[2];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      out.push({ x: Math.cos(a) * (upper.w / 2), z: Math.sin(a) * (upper.w / 2), y: upper.y0, h: upper.h });
    }
    return out;
  }, [tower, hq]);

  useFrame((_, dt) => {
    const n = env.uNight.value;
    if (ringsRef.current) {
      ringsRef.current.children.forEach((c, i) => {
        c.rotation.z += dt * (i % 2 ? -0.25 : 0.18);
        c.position.y = c.userData.baseY + Math.sin(env.uTime.value * 0.6 + i) * 0.8;
      });
    }
    if (holoRef.current) {
      holoRef.current.rotation.y += dt * 0.6;
      holoRef.current.rotation.x += dt * 0.2;
    }
    beamMat.opacity = 0.03 + n * 0.12;
    ringMat.opacity = 0.35 + n * 0.55;
    ringMat2.opacity = 0.3 + n * 0.5;
    plazaMat.emissiveIntensity = 0.15 + n * 0.9;
    seamMat.color.setRGB(0.3 + n * 0.4, 1.2 + n * 1.6, 1.5 + n * 1.8);
  });

  return (
    <group name="jarvis-hq">
      <mesh rotation-x={-Math.PI / 2} position-y={0.05} material={plazaMat} receiveShadow>
        <circleGeometry args={[13.6, 64]} />
      </mesh>
      {seams.map((s, i) => (
        <mesh key={i} position={[s.x, s.y + s.h / 2, s.z]} material={seamMat}>
          <boxGeometry args={[0.28, s.h, 0.28]} />
        </mesh>
      ))}
      <group ref={ringsRef}>
        {[0.32, 0.55, 0.78].map((f, i) => (
          <mesh key={i} rotation-x={Math.PI / 2} position-y={top * f} userData={{ baseY: top * f }} material={i === 1 ? ringMat2 : ringMat}>
            <torusGeometry args={[tower.w * (0.75 - i * 0.08), 0.18, 8, 96]} />
          </mesh>
        ))}
      </group>
      <mesh position-y={top + 40} material={beamMat}>
        <cylinderGeometry args={[0.6, 4, 80, 24, 1, true]} />
      </mesh>
      <mesh ref={holoRef} position={[0, 9, 16.5]} material={holoMat}>
        <icosahedronGeometry args={[1.6, 1]} />
      </mesh>
      <pointLight position={[0, 6, 14]} color="#22d3ee" intensity={30} distance={30} decay={2} />
    </group>
  );
}
