/**
 * Postcards: grabs the rendered frame right after it is drawn, frames it with
 * a caption (place and city time) and files it in the journal. Mounted only
 * while a postcard is pending: a priority > 0 frame callback takes over
 * rendering in R3F, so it must not stay mounted.
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { WEEKDAYS, dayOf, formatClock, weekdayOf } from '@morphis/shared';
import { useGuest } from '../../state/guestStore';
import { useJournal } from '../../state/journalStore';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { usePostcard } from './actions';

export function PostcardCapture() {
  const busy = useRef(false);
  useFrame(({ gl, scene, camera }) => {
    if (busy.current) return;
    const q = useUI.getState().quality;
    // without post-processing nobody else renders this frame (a priority > 0 callback is mounted)
    if (!q.bloom && !q.ao) gl.render(scene, camera);
    let shot: string;
    try {
      shot = gl.domElement.toDataURL('image/jpeg', 0.92);
    } catch {
      useUI.getState().notify('Could not capture this view', 'error');
      usePostcard.setState({ pending: false });
      return;
    }
    busy.current = true;
    const place = useGuest.getState().place;
    const t = useSim.getState().state?.clock.time ?? 0;
    const label = place?.landmark && place.landmarkDist < 60 ? place.landmark : place?.street || 'Morphis';
    const caption = `MORPHIS · ${label.toUpperCase()} · DAY ${dayOf(t)} ${WEEKDAYS[weekdayOf(t)]} ${formatClock(t)}`;
    void frame(shot, caption)
      .then((url) => useJournal.getState().addPostcard(url, label))
      .then(() => useUI.getState().notify('Postcard saved to your journal'))
      .catch(() => useUI.getState().notify('Could not save the postcard', 'error'))
      .finally(() => {
        busy.current = false;
        usePostcard.setState({ pending: false });
      });
  }, 3);
  return null;
}

async function frame(src: string, caption: string): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const W = 1200;
  const H = 820;
  const pad = 26;
  const cap = 54;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0f19';
  g.fillRect(0, 0, W, H);
  const iw = W - pad * 2;
  const ih = H - pad * 2 - cap;
  const s = Math.max(iw / img.width, ih / img.height);
  const sw = iw / s;
  const sh = ih / s;
  g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, pad, pad, iw, ih);
  g.strokeStyle = 'rgba(34, 211, 238, 0.65)';
  g.lineWidth = 2;
  g.strokeRect(pad - 1, pad - 1, iw + 2, ih + 2);
  g.fillStyle = '#e2e8f0';
  g.font = '600 20px "Rajdhani", "Segoe UI", sans-serif';
  g.textBaseline = 'middle';
  g.fillText(caption, pad, H - pad - cap / 2 + 4);
  g.fillStyle = '#22d3ee';
  g.textAlign = 'right';
  g.fillText('POSTCARD', W - pad, H - pad - cap / 2 + 4);
  return c.toDataURL('image/jpeg', 0.86);
}
