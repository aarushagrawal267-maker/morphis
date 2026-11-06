/**
 * Talking to people: Wave, "What are you up to?", "Where's good around
 * here?" or anything you type. The simulation supplies what the person
 * actually knows (their day, plan, recent deeds, what is open nearby). With an
 * AI model connected (server mode) the model answers in their voice from those
 * facts; otherwise the simulation answers. Every reply says which.
 */
import { useRef, useState } from 'react';
import type { CitizenProfile } from '@morphis/shared';
import { firstName } from '@morphis/shared';
import { WAVE_RADIUS } from '../../scene/guest/actions';
import { citizenPosition } from '../../scene/positions';
import { simClient } from '../../sim/client';
import { guestPose, useGuest } from '../../state/guestStore';
import { useJournal } from '../../state/journalStore';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { Icon } from '../ui/icons';

type Line = { who: 'you' | 'them'; text: string; by?: 'ai' | 'sim'; note?: string };

export function TalkBox({ p }: { p: CitizenProfile }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const ai = useSim((s) => s.ai?.connected);
  const walking = useGuest((s) => s.active);
  const log = useRef<HTMLDivElement>(null);
  const push = (...l: Line[]) => {
    setLines((cur) => [...cur.slice(-7), ...l]);
    setTimeout(() => log.current?.scrollTo({ top: 1e6 }), 0);
  };
  const ask = (topic: 'upto' | 'where' | 'chat', said: string, typed?: string) => {
    if (busy) return;
    push({ who: 'you', text: said });
    setBusy(true);
    void simClient
      .command({ type: 'guest.talk', citizenId: p.id, topic, ...(typed ? { text: typed } : {}) })
      .then((data) => {
        const r = data as { reply: string; by: 'ai' | 'sim'; note?: string };
        push({ who: 'them', text: r.reply, by: r.by, note: r.note });
      })
      .catch(() => push({ who: 'them', text: `${firstName(p.name)} didn't hear you.`, by: 'sim' }))
      .finally(() => setBusy(false));
  };
  const wave = () => {
    const pos = citizenPosition(p.index);
    const inside = useUI.getState().interior?.buildingId;
    const near = walking && pos && (inside || Math.hypot(pos.x - guestPose.x, pos.z - guestPose.z) < WAVE_RADIUS);
    if (!near) {
      push({ who: 'you', text: '(wave)' }, { who: 'them', text: walking ? `${firstName(p.name)} is too far away to see you.` : 'Walk in and get closer to wave.', by: 'sim' });
      return;
    }
    guestPose.waveUntil = performance.now() + 2200;
    useJournal.getState().waved();
    void simClient
      .command({ type: 'guest.wave', x: inside ? pos.x : guestPose.x, z: inside ? pos.z : guestPose.z, citizens: [p.id], ...(inside ? { buildingId: inside } : {}) })
      .then((data) => {
        const waved = ((data as { waved?: string[] } | undefined)?.waved ?? []).includes(p.id);
        if (waved) useJournal.getState().meet([p.id], () => !!p.agent);
        push({ who: 'you', text: '(wave)' }, { who: 'them', text: waved ? `(waves back) Hi! I'm ${firstName(p.name)}.` : `${firstName(p.name)} didn't notice you.`, by: 'sim' });
      })
      .catch(() => undefined);
  };
  return (
    <div className="talk" data-testid="talk">
      {lines.length > 0 && (
        <div className="talk__log" ref={log}>
          {lines.map((l, i) => (
            <p key={i} className={`talk__line talk__line--${l.who}`} title={l.note}>
              {l.text}
              {l.who === 'them' && l.by === 'ai' && <em className="talk__ai">AI</em>}
            </p>
          ))}
          {busy && <p className="talk__line talk__line--them talk__typing">…</p>}
        </div>
      )}
      <div className="talk__actions">
        <button onClick={wave} data-testid="talk-wave">
          <Icon name="hand" size={13} /> Wave
        </button>
        <button disabled={busy} onClick={() => ask('upto', 'What are you up to?')} data-testid="talk-upto">
          What are you up to?
        </button>
        <button disabled={busy} onClick={() => ask('where', "Where's good around here?")} data-testid="talk-where">
          Where's good around here?
        </button>
      </div>
      <form
        className="talk__say"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          setText('');
          ask('chat', t, t);
        }}
      >
        <input value={text} maxLength={240} placeholder={ai ? `Say something to ${firstName(p.name)}…` : 'Say something… (needs an AI model for free chat)'} onChange={(e) => setText(e.target.value)} data-testid="talk-input" />
        <button type="submit" disabled={busy || !text.trim()} data-testid="talk-send">
          Say
        </button>
      </form>
      <p className="note">{ai ? 'Replies are voiced by the connected AI model from this person’s simulated day; AI marks them.' : 'Replies come from this person’s simulated day and what is open around them.'}</p>
    </div>
  );
}
