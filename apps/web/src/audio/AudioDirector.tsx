/**
 * Feeds the sound engine from the scene: unlocks audio on the first gesture,
 * sets the mix (height above the island, rain, night, indoors, how busy the
 * street is) and plays footsteps in time with the visitor's walk.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { simClient } from '../sim/client';
import { guestPose, useGuest } from '../state/guestStore';
import { useUI } from '../state/uiStore';
import { env } from '../scene/env';
import { sound } from './engine';

export function AudioDirector() {
  const { camera } = useThree();
  const last = useRef(0);
  const stepPhase = useRef(0);

  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useFrame((_, dt) => {
    if (!sound.ctx) return;
    const walking = useGuest.getState().active;
    // footsteps: about two steps a second walking, three running
    if (walking && guestPose.speed > 0 && guestPose.y < 1) {
      const run = guestPose.speed > 1.1;
      stepPhase.current += dt * (run ? 3.1 : 2.1);
      if (stepPhase.current >= 1) {
        stepPhase.current -= 1;
        sound.step(run);
      }
    } else stepPhase.current = 0.6;

    const now = performance.now();
    if (now - last.current < 250) return;
    last.current = now;
    const indoors = !!useUI.getState().interior;
    const lx = walking ? guestPose.x : camera.position.x;
    const lz = walking ? guestPose.z : camera.position.z;
    const altitude = walking || indoors ? 0 : Math.min(1, Math.max(0, (camera.position.y - 12) / 140));
    let busy = 0;
    const s = simClient.sampleMotion();
    if (s) {
      for (let i = 0; i < s.cVisible.length; i++) if (s.cVisible[i] && Math.abs(s.cX[i] - lx) < 30 && Math.abs(s.cZ[i] - lz) < 30) busy += 1;
      for (let i = 0; i < s.vVisible.length; i++) if (s.vVisible[i] && Math.abs(s.vX[i] - lx) < 40 && Math.abs(s.vZ[i] - lz) < 40) busy += 2;
    }
    sound.setScene({ night: env.uNight.value, rain: env.uRain.value, altitude, indoors, bustle: Math.min(1, busy / 16) });
  });
  return null;
}
