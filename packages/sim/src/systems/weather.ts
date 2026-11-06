/**
 * Weather: an hourly Markov chain (clear / rain / fog / storm) with smooth
 * intensity ramps and a surface-wetness model that lags behind the rain.
 */
import type { WeatherKind } from '@morphis/shared';
import { hourOf } from '@morphis/shared';
import type { CitySimulation } from '../engine';

const LABEL: Record<WeatherKind, string> = { clear: 'Clear skies', rain: 'Rain', fog: 'Fog', storm: 'Storm' };

export class WeatherSystem {
  constructor(private sim: CitySimulation) {}

  /** Hourly transition. */
  hourly(): void {
    const w = this.sim.state.weather;
    if (w.manual) return;
    const h = hourOf(this.sim.time);
    const r = this.sim.rng.float();
    const cur = w.target;
    let next: WeatherKind = cur;
    switch (cur) {
      case 'clear':
        if (r < 0.05) next = 'rain';
        else if (r < 0.05 + (h >= 3 && h <= 8 ? 0.14 : 0.015)) next = 'fog';
        else if (r < 0.075 + (h >= 3 && h <= 8 ? 0.14 : 0.015)) next = 'storm';
        break;
      case 'rain':
        if (r < 0.22) next = 'clear';
        else if (r < 0.3) next = 'storm';
        break;
      case 'fog':
        if (r < (h > 9 ? 0.5 : 0.18)) next = 'clear';
        break;
      case 'storm':
        if (r < 0.35) next = 'rain';
        else if (r < 0.45) next = 'clear';
        break;
    }
    if (next !== cur) this.setTarget(next, false);
  }

  setTarget(kind: WeatherKind, manual: boolean): void {
    const w = this.sim.state.weather;
    const prev = w.target;
    w.target = kind;
    w.manual = manual;
    if (prev !== kind) {
      this.sim.bus.emit('weather.changed', this.sim.time, { weather: kind, previous: prev, manual });
      const sev = kind === 'storm' ? 'warning' : 'info';
      this.sim.cityEvents.news('weather', `${LABEL[kind]} ${kind === 'clear' ? 'returning' : 'moving in'} over Morphis`, manual ? 'Weather set manually from the control panel.' : weatherBody(kind), sev);
    }
  }

  /** Per sim-minute smoothing of intensity, wetness and wind. */
  minute(): void {
    const w = this.sim.state.weather;
    const step = 1 / 20; // ~20 sim minutes for a full ramp
    if (w.kind !== w.target) {
      w.intensity = Math.max(0, w.intensity - step);
      if (w.intensity <= 0) w.kind = w.target;
    } else {
      w.intensity = Math.min(1, w.intensity + step);
    }
    if (w.kind === 'clear') w.intensity = 1;
    const raining = w.kind === 'rain' || w.kind === 'storm';
    if (raining) w.wetness = Math.min(1, w.wetness + 0.03 * w.intensity);
    else w.wetness = Math.max(0, w.wetness - 0.006);
    w.windDir += (this.sim.rng.float() - 0.5) * 0.02;
    w.intensity = Math.round(w.intensity * 1000) / 1000;
    w.wetness = Math.round(w.wetness * 1000) / 1000;
  }
}

function weatherBody(kind: WeatherKind): string {
  switch (kind) {
    case 'rain':
      return 'Expect wet streets and more taxi demand. Pedestrians are walking faster.';
    case 'storm':
      return 'Strong winds and heavy rain. Outdoor activities are discouraged; traffic is slower.';
    case 'fog':
      return 'Low visibility on the expressway. Drivers are reducing speed.';
    default:
      return 'Skies are clearing across all districts.';
  }
}
