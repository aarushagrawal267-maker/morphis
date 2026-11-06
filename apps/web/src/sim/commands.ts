/** UI helper: send a validated command and surface failures as toasts. */
import type { SimCommand } from '@morphis/shared';
import { useUI } from '../state/uiStore';
import { simClient } from './client';

export async function run<T = unknown>(cmd: SimCommand, success?: string): Promise<T | null> {
  try {
    const data = (await simClient.command(cmd)) as T;
    if (success) useUI.getState().notify(success);
    return data;
  } catch (e) {
    useUI.getState().notify(e instanceof Error ? e.message : String(e), 'error');
    return null;
  }
}
