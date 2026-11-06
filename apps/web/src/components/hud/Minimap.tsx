/**
 * Live minimap rendered to a 2D canvas: districts, roads, buildings, JARVIS HQ,
 * citizens (cyan) and vehicles (amber), plus the camera view. Click to focus.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { localToWorld } from '@morphis/sim';
import { simClient } from '../../sim/client';
import { cameraBridge } from '../../scene/cameraBridge';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { focusPoint } from '../panels/actions';
import { arrival, guestPose, useGuest } from '../../state/guestStore';
import { visitors } from '../../state/presence';
import { collidersFor } from '../../scene/guest/collision';
import { sound } from '../../audio/engine';
import { dropIn } from './GuestHud';

const SIZE = 210;

export function Minimap() {
  const world = useSim((s) => s.world);
  const canvas = useRef<HTMLCanvasElement>(null);
  const interior = useUI((s) => s.interior);
  const extent = useMemo(() => {
    if (!world) return 1;
    if (!world.island) return world.size + 8;
    let r = 0;
    for (let i = 0; i < world.island.outline.length; i += 2) r = Math.max(r, Math.abs(world.island.outline[i]), Math.abs(world.island.outline[i + 1]));
    return r * 2 + 14;
  }, [world]);
  const scale = world ? SIZE / extent : 1;
  const toPx = (x: number, z: number): [number, number] => [SIZE / 2 + x * scale, SIZE / 2 + z * scale];

  const base = useMemo(() => {
    if (!world) return null;
    const c = document.createElement('canvas');
    c.width = c.height = SIZE * 2;
    const g = c.getContext('2d')!;
    g.scale(2, 2);
    g.fillStyle = '#070a12';
    g.fillRect(0, 0, SIZE, SIZE);
    if (world.island) {
      // the island itself, with a soft glow at its edge
      const o = world.island.outline;
      g.beginPath();
      g.moveTo(...toPx(o[0], o[1]));
      for (let i = 2; i < o.length; i += 2) g.lineTo(...toPx(o[i], o[i + 1]));
      g.closePath();
      g.fillStyle = '#141a28';
      g.shadowColor = '#6d5bd0';
      g.shadowBlur = 8;
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = '#4c4f8f';
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = '#22d3ee';
      for (const l of world.island.lifts) {
        const [x, y] = toPx(l.x, l.z);
        g.fillRect(x - 2, y - 2, 4, 4);
      }
    }
    for (const d of world.districts) {
      if (d.type === 'central') continue;
      const [x, y] = toPx(d.center.x, d.center.z);
      g.fillStyle = d.color + '22';
      g.strokeStyle = d.color + '66';
      g.beginPath();
      g.arc(x, y, d.radius * scale, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.lineCap = 'round';
    for (const e of world.roads.edges) {
      const a = world.roads.nodes[e.a];
      const b = world.roads.nodes[e.b];
      g.strokeStyle = e.cls === 'highway' ? '#64748b' : e.cls === 'avenue' ? '#475569' : '#334155';
      g.lineWidth = Math.max(0.8, e.width * scale * 0.9);
      g.beginPath();
      g.moveTo(...toPx(a.x, a.z));
      g.lineTo(...toPx(b.x, b.z));
      g.stroke();
    }
    for (const b of world.buildings) {
      const pts = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([sx, sz]) => toPx(...(Object.values(localToWorld(b.position.x, b.position.z, b.rotation, (sx * b.width) / 2, (sz * b.depth) / 2)) as [number, number])));
      g.fillStyle = b.type === 'park' ? '#14532d' : b.named ? '#c084fc' : '#1e293b';
      g.beginPath();
      g.moveTo(...pts[0]);
      for (const p of pts.slice(1)) g.lineTo(...p);
      g.closePath();
      g.fill();
    }
    if (world.rail) {
      const pts = world.rail.points;
      g.strokeStyle = '#a78bfa';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(...toPx(pts[0], pts[1]));
      for (let i = 2; i < pts.length; i += 2) g.lineTo(...toPx(pts[i], pts[i + 1]));
      g.closePath();
      g.stroke();
    }
    const hq = world.buildings.find((b) => b.id === world.hqId)!;
    const [hx, hy] = toPx(hq.position.x, hq.position.z);
    g.fillStyle = '#22d3ee';
    g.beginPath();
    g.arc(hx, hy, 4, 0, Math.PI * 2);
    g.fill();
    return c;
  }, [world]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!base) return;
    let raf = 0;
    let last = 0;
    const target = new THREE.Vector3();
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 180) return;
      last = t;
      const c = canvas.current;
      const sample = simClient.sampleMotion();
      if (!c || !sample) return;
      const g = c.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(base, 0, 0);
      g.scale(2, 2);
      g.fillStyle = '#67e8f9';
      for (let i = 0; i < sample.cVisible.length; i++) {
        if (!sample.cVisible[i]) continue;
        const [x, y] = toPx(sample.cX[i], sample.cZ[i]);
        g.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
      }
      g.fillStyle = '#fbbf24';
      for (let i = 0; i < sample.vVisible.length; i++) {
        if (!sample.vVisible[i]) continue;
        const [x, y] = toPx(sample.vX[i], sample.vZ[i]);
        g.fillRect(x - 1, y - 1, 2, 2);
      }
      // other visitors and you
      g.fillStyle = '#f472b6';
      for (const v of visitors.values()) {
        if (v.inside) continue;
        const [x, y] = toPx(v.rx, v.rz);
        g.beginPath();
        g.arc(x, y, 2.2, 0, Math.PI * 2);
        g.fill();
      }
      if (useGuest.getState().active) {
        const [x, y] = toPx(guestPose.x, guestPose.z);
        const a = guestPose.yaw;
        g.fillStyle = '#ffffff';
        g.strokeStyle = '#0b1020';
        g.beginPath();
        g.moveTo(x + Math.sin(a) * 6, y + Math.cos(a) * 6);
        g.lineTo(x + Math.sin(a + 2.5) * 4, y + Math.cos(a + 2.5) * 4);
        g.lineTo(x + Math.sin(a - 2.5) * 4, y + Math.cos(a - 2.5) * 4);
        g.closePath();
        g.fill();
        g.stroke();
        return;
      }
      // camera view
      const cam = cameraBridge.camera;
      const ctrl = (window as unknown as { __morphisCamera?: { getTarget: (v: THREE.Vector3) => THREE.Vector3 } }).__morphisCamera;
      if (cam && ctrl) {
        ctrl.getTarget(target);
        const [tx, ty] = toPx(target.x, target.z);
        const [cx, cy] = toPx(cam.position.x, cam.position.z);
        g.strokeStyle = '#fde047';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(tx, ty);
        g.stroke();
        g.strokeRect(tx - 6, ty - 6, 12, 12);
      }
      const sel = useUI.getState().selection;
      if (sel?.kind === 'building') {
        const b = useSim.getState().buildingsById.get(sel.id);
        if (b) {
          const [x, y] = toPx(b.position.x, b.position.z);
          g.strokeStyle = '#fde047';
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(x, y, 6, 0, Math.PI * 2);
          g.stroke();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!world || interior) return null;
  return (
    <section className="minimap glass" data-testid="minimap">
      <canvas
        ref={canvas}
        width={SIZE * 2}
        height={SIZE * 2}
        style={{ width: SIZE, height: SIZE }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - r.left - SIZE / 2) / scale;
          const z = (e.clientY - r.top - SIZE / 2) / scale;
          // drop in there (or, when already walking, travel there)
          if (useGuest.getState().active) {
            const p = { x, z };
            const col = collidersFor(world);
            if (!col.onIsland(x, z)) return;
            col.resolve(p, 0.6);
            guestPose.x = p.x;
            guestPose.z = p.z;
            guestPose.path = [];
            arrival.at = performance.now();
            sound.whoosh();
          } else if (!dropIn(x, z)) focusPoint(x, z, 70);
        }}
      />
      <div className="minimap__legend">
        <span>
          <i style={{ background: '#67e8f9' }} /> citizens
        </span>
        <span>
          <i style={{ background: '#fbbf24' }} /> vehicles
        </span>
        <span>
          <i style={{ background: '#c084fc' }} /> landmarks
        </span>
        <span>
          <i style={{ background: '#a78bfa' }} /> skyrail
        </span>
      </div>
    </section>
  );
}
