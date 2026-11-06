/**
 * City events you can see from anywhere: while an event is live, its building
 * sends up sweeping light beams and a floating sign with the event's name.
 */
import { Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSim } from '../../state/simStore';

const KIND_COLOR: Record<string, string> = {
  market: '#fbbf24',
  concert: '#f472b6',
  lecture: '#60a5fa',
  conference: '#22d3ee',
  exhibition: '#a78bfa',
  sports: '#4ade80',
};

function signTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,10,20,0.85)';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(3, 3, 506, 122);
  g.fillStyle = color;
  g.font = 'bold 30px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('● LIVE', 256, 44);
  g.fillStyle = '#ffffff';
  g.font = "bold 32px \"Segoe UI\", Arial, sans-serif";
  g.fillText(text.length > 24 ? `${text.slice(0, 23)}…` : text, 256, 96);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Beacon({ x, z, h, name, color }: { x: number; z: number; h: number; name: string; color: string }) {
  const beams = useRef<THREE.Group>(null);
  const tex = useMemo(() => signTexture(name, color), [name, color]);
  const beamMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    [color],
  );
  const beamGeo = useMemo(() => new THREE.ConeGeometry(2.2, 40, 16, 1, true).translate(0, -20, 0).rotateX(Math.PI), []);
  useFrame(({ clock }) => {
    const g = beams.current;
    if (!g) return;
    g.children.forEach((b, i) => {
      b.rotation.z = Math.sin(clock.elapsedTime * 0.7 + i * 2.1) * 0.45;
      b.rotation.x = Math.cos(clock.elapsedTime * 0.5 + i * 1.3) * 0.3;
    });
  });
  return (
    <group position={[x, h, z]}>
      <group ref={beams}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} geometry={beamGeo} material={beamMat} position={[(i - 1) * 2, 0, 0]} />
        ))}
      </group>
      <Billboard position={[0, 6, 0]}>
        <mesh>
          <planeGeometry args={[12, 3]} />
          <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      </Billboard>
    </group>
  );
}

export function EventBeacons() {
  const events = useSim((s) => s.cityEvents);
  const buildings = useSim((s) => s.buildingsById);
  const live = events.filter((e) => e.status === 'LIVE');
  return (
    <group name="event-beacons">
      {live.map((e) => {
        const b = buildings.get(e.buildingId);
        if (!b) return null;
        return <Beacon key={e.id} x={b.position.x} z={b.position.z} h={Math.max(4, b.height) + 1} name={e.name} color={KIND_COLOR[e.kind] ?? '#22d3ee'} />;
      })}
    </group>
  );
}
