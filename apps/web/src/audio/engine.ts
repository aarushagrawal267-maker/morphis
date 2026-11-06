/**
 * Morphis sound: everything is synthesised in the browser (Web Audio), so the
 * town needs no audio files.
 *
 * - Music: a slow, original ambient score (soft pads over a gently moving
 *   chord progression, sparse plucked notes), darker and slower at night.
 * - Ambience: wind high above the island, a town hum at street level, rain
 *   when it rains, a murmur and clinks indoors.
 * - Effects: footsteps (faster when running), wave chime, postcard shutter,
 *   a whoosh when dropping in.
 *
 * Audio starts only after the first click or key press (browser rule) and
 * only when sound is switched on.
 */

export interface SoundSettings {
  enabled: boolean;
  music: number;
  ambience: number;
  effects: number;
}

const KEY = 'morphis.sound';
const DEFAULTS: SoundSettings = { enabled: true, music: 0.55, ambience: 0.6, effects: 0.7 };

export function loadSoundSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SoundSettings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveSoundSettings(s: SoundSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

// D major / B minor colour, voiced softly (MIDI note numbers)
const PROGRESSION = [
  [50, 57, 61, 66, 69], // Dmaj9-ish
  [47, 54, 57, 62, 66], // Bm9
  [43, 50, 54, 59, 66], // Gmaj7#11 colour
  [45, 52, 57, 61, 64], // A6sus
];
const PENTATONIC = [62, 64, 66, 69, 71, 74, 76, 78, 81];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Live inputs the engine reads every update. */
export interface SoundScene {
  night: number;
  rain: number;
  /** 0 = at street level, 1 = high above the island. */
  altitude: number;
  indoors: boolean;
  /** People and vehicles moving near the listener (0..1). */
  bustle: number;
}

class SoundEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private padFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private wind?: { g: GainNode; f: BiquadFilterNode };
  private hum?: { g: GainNode; f: BiquadFilterNode };
  private rainN?: { g: GainNode; f: BiquadFilterNode };
  private murmur?: { g: GainNode; f: BiquadFilterNode };
  private chord = 0;
  private nextChordAt = 0;
  private nextPluckAt = 0;
  private nextClinkAt = 0;
  private scene: SoundScene = { night: 0, rain: 0, altitude: 1, indoors: false, bustle: 0 };
  settings: SoundSettings = loadSoundSettings();
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Call from a user gesture. Creates the audio graph once. */
  unlock(): void {
    if (!this.settings.enabled) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(ctx.destination);
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 1.2);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);
    this.musicBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.ambBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.sfxBus.connect(this.reverb);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1400;
    this.padFilter.Q.value = 0.5;
    this.padFilter.connect(this.musicBus);
    this.noise = this.noiseBuffer(4);
    this.wind = this.loopNoise('bandpass', 420, 0.6);
    this.hum = this.loopNoise('lowpass', 260, 0.7);
    this.rainN = this.loopNoise('highpass', 2200, 0.4);
    this.murmur = this.loopNoise('bandpass', 650, 1.2);
    this.applyVolumes();
    this.nextChordAt = ctx.currentTime + 0.2;
    this.nextPluckAt = ctx.currentTime + 3;
    this.timer = setInterval(() => this.tick(), 120);
  }

  setSettings(s: SoundSettings): void {
    this.settings = s;
    saveSoundSettings(s);
    if (!s.enabled) {
      if (this.ctx && this.master) this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2);
      return;
    }
    if (!this.ctx) return; // waits for the next gesture
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.4);
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.32, t, 0.3);
    this.ambBus.gain.setTargetAtTime(this.settings.ambience * 0.5, t, 0.3);
    this.sfxBus.gain.setTargetAtTime(this.settings.effects * 0.6, t, 0.1);
  }

  setScene(s: SoundScene): void {
    this.scene = s;
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.settings.enabled) return;
    const t = ctx.currentTime;
    const s = this.scene;
    // ambience mix
    const outdoor = s.indoors ? 0 : 1;
    this.wind?.g.gain.setTargetAtTime((0.05 + s.altitude * 0.5) * outdoor, t, 0.8);
    this.wind?.f.frequency.setTargetAtTime(300 + Math.sin(t * 0.13) * 120 + s.altitude * 200, t, 1.5);
    this.hum?.g.gain.setTargetAtTime((0.08 + s.bustle * 0.45) * (1 - s.altitude) * outdoor, t, 0.6);
    this.rainN?.g.gain.setTargetAtTime(s.rain * 0.55 * (s.indoors ? 0.25 : 1), t, 0.8);
    this.murmur?.g.gain.setTargetAtTime(s.indoors ? 0.22 : 0, t, 0.5);
    this.padFilter.frequency.setTargetAtTime(500 + (1 - s.night) * 1500 - s.rain * 250 - (s.indoors ? 300 : 0), t, 2);
    // music: chord changes and sparse plucks
    if (t >= this.nextChordAt) {
      this.playChord(PROGRESSION[this.chord % PROGRESSION.length], t, s.night);
      this.chord++;
      this.nextChordAt = t + (s.night > 0.5 ? 11 : 8.5);
    }
    if (t >= this.nextPluckAt) {
      const n = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
      this.pluck(midi(n), t, 0.06 + Math.random() * 0.05);
      if (Math.random() < 0.35) this.pluck(midi(n + (Math.random() < 0.5 ? 5 : 7)), t + 0.18, 0.04);
      this.nextPluckAt = t + (s.night > 0.5 ? 2.4 : 1.4) + Math.random() * 2.6;
    }
    if (s.indoors && t >= this.nextClinkAt) {
      this.clink(t);
      this.nextClinkAt = t + 1.5 + Math.random() * 4;
    }
  }

  private playChord(notes: number[], t: number, night: number): void {
    const ctx = this.ctx!;
    const dur = night > 0.5 ? 12 : 9.5;
    for (const n of notes) {
      for (const detune of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = n < 52 ? 'triangle' : 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = detune + (Math.random() - 0.5) * 4;
        const g = ctx.createGain();
        const peak = (n < 52 ? 0.07 : 0.022) * (night > 0.5 ? 0.9 : 1);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 2.8);
        g.gain.setValueAtTime(peak, t + dur - 3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.5);
        o.connect(g).connect(this.padFilter);
        o.start(t);
        o.stop(t + dur + 1.6);
      }
    }
  }

  private pluck(freq: number, t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.musicBus);
    o.start(t);
    o2.start(t);
    o.stop(t + 2.3);
    o2.stop(t + 2.3);
  }

  private clink(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2400 + Math.random() * 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.02, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.ambBus);
    o.start(t);
    o.stop(t + 0.4);
  }

  /** One footstep (soft filtered noise burst). */
  step(run: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.settings.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = (run ? 1500 : 1100) + Math.random() * 500;
    f.Q.value = 1.4;
    const g = ctx.createGain();
    const v = run ? 0.16 : 0.1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 3, 0.12);
  }

  /** Short rising chime (waving). */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || !this.settings.enabled) return;
    const t = ctx.currentTime;
    [74, 78, 81].forEach((n, i) => this.pluckTo(midi(n), t + i * 0.09, 0.09, this.sfxBus));
  }

  /** Camera shutter (postcard). */
  shutter(): void {
    const ctx = this.ctx;
    if (!ctx || !this.settings.enabled) return;
    const t = ctx.currentTime;
    for (const [dt, freq] of [[0, 3200], [0.07, 2100]] as const) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.25, t + dt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.06);
      src.connect(f).connect(g).connect(this.sfxBus);
      src.start(t + dt, Math.random(), 0.08);
    }
  }

  /** Descending air (dropping in from above). */
  whoosh(): void {
    const ctx = this.ctx;
    if (!ctx || !this.settings.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, 0, 1.9);
  }

  /** A soft "ding" (notifications such as a goal completed). */
  ding(): void {
    const ctx = this.ctx;
    if (!ctx || !this.settings.enabled) return;
    const t = ctx.currentTime;
    this.pluckTo(midi(81), t, 0.08, this.sfxBus);
    this.pluckTo(midi(86), t + 0.12, 0.07, this.sfxBus);
  }

  private pluckTo(freq: number, t: number, vol: number, bus: GainNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 1);
  }

  private loopNoise(type: BiquadFilterType, freq: number, q: number): { g: GainNode; f: BiquadFilterNode } {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.ambBus);
    src.start(0, Math.random() * 3);
    return { g, f };
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = b.getChannelData(0);
    // pinkish noise (sum of a few filtered white sources)
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029591;
      b1 = 0.985 * b1 + w * 0.032534;
      b2 = 0.95 * b2 + w * 0.048056;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.5;
    }
    return b;
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return b;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const sound = new SoundEngine();
