/**
 * District pin labels as a DOM overlay. Positions are projected from the real
 * district anchors every animation frame and written straight to the DOM.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { cameraBridge } from '../../scene/cameraBridge';
import { focusDistrict, pinAnchor } from '../../scene/districts/DistrictPins';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { DistrictIcon } from '../ui/icons';

export function PinOverlay() {
  const world = useSim((s) => s.world);
  const pins = useUI((s) => s.pins);
  const interior = useUI((s) => s.interior);
  const selected = useUI((s) => (s.selection?.kind === 'district' ? s.selection.id : null));
  const anchors = useMemo(() => (world ? world.districts.filter((d) => d.type !== 'central').map((d) => ({ d, ...pinAnchor(d, world) })) : []), [world]);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const v = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cam = cameraBridge.camera;
      if (!cam) return;
      anchors.forEach((a, i) => {
        const el = refs.current[i];
        if (!el) return;
        v.set(a.x, a.h, a.z).project(cam);
        const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        el.style.display = visible ? 'flex' : 'none';
        if (!visible) return;
        const x = ((v.x + 1) / 2) * cameraBridge.width;
        const y = ((1 - v.y) / 2) * cameraBridge.height;
        el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        el.style.zIndex = String(1000 - Math.round(v.z * 1000));
      });
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [anchors]);

  if (!pins || interior) return null;
  return (
    <div className="pin-layer">
      {anchors.map(({ d }, i) => (
        <button
          key={d.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={`district-pin ${selected === d.id ? 'active' : ''}`}
          style={{ ['--pin' as string]: d.color }}
          onClick={() => focusDistrict(d)}
          data-testid={`pin-${d.type}`}
        >
          <span className="district-pin__icon">
            <DistrictIcon name={d.icon} />
          </span>
          <span className="district-pin__text">
            <strong>{d.name.toUpperCase()}</strong>
            <small>{d.tagline}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
