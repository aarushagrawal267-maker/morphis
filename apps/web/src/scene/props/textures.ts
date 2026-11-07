/**
 * Canvas-generated textures (no external assets): billboard ads and building
 * sign atlas. All text and brands are original to Morphis.
 */
import * as THREE from 'three';

const ADS: { title: string; sub: string; a: string; b: string }[] = [
  { title: 'MORPHIS OS', sub: 'THE CITY THAT THINKS', a: '#22d3ee', b: '#1e1b4b' },
  { title: 'LANTERN NOODLES', sub: 'OPEN ALL NIGHT', a: '#f472b6', b: '#3b0764' },
  { title: 'ORBITAL', sub: 'LAUNCH WITH US', a: '#a78bfa', b: '#0f172a' },
  { title: 'NOVA BANK', sub: 'CREDITS THAT GROW', a: '#fbbf24', b: '#1c1917' },
  { title: 'SYNTH//WAVE', sub: 'ARCADIA ARENA LIVE', a: '#fb7185', b: '#111827' },
  { title: 'AI LAB', sub: 'BUILDING TOMORROW', a: '#4ade80', b: '#022c22' },
  { title: 'HOLO ARCADE', sub: 'PLAY • WIN • REPEAT', a: '#e879f9', b: '#1e1b4b' },
  { title: 'MAGLEV 2126', sub: 'CROSS TOWN IN MINUTES', a: '#38bdf8', b: '#082f49' },
];

let adTex: THREE.CanvasTexture | null = null;

/** 4x2 atlas of billboard ads; each billboard samples the whole atlas row-wise via UV offset (k). */
export function adTexture(): THREE.CanvasTexture {
  if (adTex) return adTex;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  ADS.forEach((ad, i) => {
    const x = (i % 4) * 256;
    const y = Math.floor(i / 4) * 256;
    const grad = g.createLinearGradient(x, y, x + 256, y + 256);
    grad.addColorStop(0, ad.b);
    grad.addColorStop(1, '#05060a');
    g.fillStyle = grad;
    g.fillRect(x, y, 256, 256);
    g.strokeStyle = ad.a;
    g.lineWidth = 6;
    g.strokeRect(x + 8, y + 8, 240, 240);
    for (let k = 0; k < 6; k++) {
      g.fillStyle = ad.a + '33';
      g.fillRect(x + 16, y + 150 + k * 14, 224 * Math.random(), 4);
    }
    g.fillStyle = ad.a;
    g.font = 'bold 34px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText(ad.title, x + 128, y + 96);
    g.fillStyle = '#e5e7eb';
    g.font = '16px "Segoe UI", Arial, sans-serif';
    g.fillText(ad.sub, x + 128, y + 128);
  });
  adTex = new THREE.CanvasTexture(c);
  adTex.colorSpace = THREE.SRGBColorSpace;
  // billboards show the whole atlas scaled; a frame shader picks the cell (see Props)
  adTex.repeat.set(0.25, 0.5);
  adTex.offset.set(0, 0.5);
  return adTex;
}

/** Build a sign atlas: each entry 512x128 px. Returns texture and UV rects. */
export function signAtlas(entries: { text: string; color: string }[]): { texture: THREE.CanvasTexture; cols: number; rows: number } {
  const cols = 4;
  const rows = Math.max(1, Math.ceil(entries.length / cols));
  const c = document.createElement('canvas');
  c.width = 512 * cols;
  c.height = 128 * rows;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  entries.forEach((e, i) => {
    const x = (i % cols) * 512;
    const y = Math.floor(i / cols) * 128;
    g.fillStyle = 'rgba(5,6,10,0.92)';
    g.fillRect(x + 4, y + 4, 504, 120);
    g.strokeStyle = e.color;
    g.lineWidth = 5;
    g.strokeRect(x + 8, y + 8, 496, 112);
    let size = 64;
    g.font = `bold ${size}px "Segoe UI", Arial, sans-serif`;
    while (g.measureText(e.text).width > 460 && size > 18) {
      size -= 2;
      g.font = `bold ${size}px "Segoe UI", Arial, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = e.color;
    g.shadowBlur = 18;
    g.fillStyle = e.color;
    g.fillText(e.text, x + 256, y + 66);
    g.shadowBlur = 0;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.85;
    g.fillText(e.text, x + 256, y + 66);
    g.globalAlpha = 1;
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { texture: t, cols, rows };
}
