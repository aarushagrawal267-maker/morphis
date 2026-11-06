import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { perf } from './perf';

/** Accumulates draw calls/triangles across all passes of a frame (incl. post-processing). */
export function PerfProbe() {
  const { gl } = useThree();
  const last = useRef(performance.now());
  const acc = useRef({ n: 0, t: 0 });
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame(() => {
    const now = performance.now();
    const dt = now - last.current;
    last.current = now;
    acc.current.n++;
    acc.current.t += dt;
    if (acc.current.t > 500) {
      perf.fps = Math.round((acc.current.n * 1000) / acc.current.t);
      perf.frameMs = acc.current.t / acc.current.n;
      acc.current = { n: 0, t: 0 };
    }
    perf.calls = gl.info.render.calls;
    perf.triangles = gl.info.render.triangles;
    perf.frames++;
    gl.info.reset();
  }, -100);
  return null;
}
