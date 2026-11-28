/** Display-only formatting for the HUD. Shared data keeps its original casing; the server and the AI prompts see it unchanged. */
import { CITY_NAME, WEEKDAYS, displayName } from '@morphis/shared';

/** "MORPHIS" -> "Morphis". */
export function titleWord(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Building and district names in title case, keeping JARVIS as the product spells it. */
export function hudName(name: string): string {
  return displayName(name).replace(/\bJarvis\b/g, 'JARVIS');
}

/** Weekday by index in sentence case: "Mon". */
export function weekday(i: number): string {
  return titleWord(WEEKDAYS[i] ?? '');
}

export const HUD_CITY_NAME = titleWord(CITY_NAME);
export const HUD_TAGLINE = 'Emergent AI city · year 2126 · The Complex';
