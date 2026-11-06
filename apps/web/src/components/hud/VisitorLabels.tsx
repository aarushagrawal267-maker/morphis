/** Name tags over other visitors (hosted towns). */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { cameraBridge } from '../../scene/cameraBridge';
import { usePresence, visitors } from '../../state/presence';

export function VisitorLabels() {
  const count = usePresence((s) => s.count);
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!count) return;
    const els = new Map<string, HTMLDivElement>();
    const v3 = new THREE.Vector3();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cam = cameraBridge.camera;
      if (!cam || !layer.current) return;
      const seen = new Set<string>();
      for (const v of visitors.values()) {
        if (v.inside) continue;
        seen.add(v.id);
        let el = els.get(v.id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'visitor-tag';
          layer.current.appendChild(el);
          els.set(v.id, el);
        }
        if (el.textContent !== v.name) el.textContent = v.name;
        v3.set(v.rx, v.ry + 2.1, v.rz).project(cam);
        const visible = v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
        el.style.display = visible ? 'block' : 'none';
        if (visible) el.style.transform = `translate(-50%, -100%) translate(${(((v3.x + 1) / 2) * cameraBridge.width).toFixed(1)}px, ${(((1 - v3.y) / 2) * cameraBridge.height).toFixed(1)}px)`;
      }
      for (const [id, el] of els) if (!seen.has(id)) {
        el.remove();
        els.delete(id);
      }
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      els.forEach((e) => e.remove());
    };
  }, [count]);
  return <div ref={layer} className="visitor-layer" />;
}
