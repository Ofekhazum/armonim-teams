// Reading the Team of the Month awards (§2.25).
//
// An award is a *record* rather than a calculation, which is what makes this
// file a fetch rather than a function: the five names for August were decided
// on the 1st of September and written down, so the only way to know them is to
// ask. That is the whole difference between this and everything else the app
// shows about a player, all of which is worked out on the spot from history.

import { REMOTE_URL } from './remote';

export interface MonthAward {
  ids: string[];
  names: string[];
  at: number; // epoch ms, when it was registered
}

/** Keyed by `YYYY-MM`. */
export type Awards = Record<string, MonthAward>;

/** Everything registered so far. `{}` on any failure — an award is decoration. */
export async function fetchAwards(): Promise<Awards> {
  if (!REMOTE_URL) return {};
  try {
    const res = await fetch(`${REMOTE_URL}/awards`, { cache: 'no-store' });
    if (!res.ok) return {};
    const data = (await res.json()) as { awards?: Awards };
    return data.awards && typeof data.awards === 'object' ? data.awards : {};
  } catch {
    return {};
  }
}

/** Which months this player was named in, newest first. */
export const monthsWon = (awards: Awards, playerId: string): string[] =>
  Object.keys(awards)
    .filter((period) => awards[period]?.ids?.includes(playerId))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

const post = async (body: unknown): Promise<boolean> => {
  if (!REMOTE_URL) return false;
  try {
    const res = await fetch(`${REMOTE_URL}/awards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Register one month now, overwriting whatever is there.
 *
 * Two jobs, and the second is why it survives the cron existing: seeding the
 * archive rather than waiting a month for the first automatic run, and
 * correcting a month the automatic pick got wrong. The cron never overwrites,
 * so anything set here stays set.
 */
export const announceMonth = (period: string, secret: string): Promise<boolean> =>
  post({ secret, period });

/** Forget one month, so the next cron may register it afresh. */
export const clearMonth = (period: string, secret: string): Promise<boolean> =>
  post({ secret, period, clear: true });

/** Do the cron's pass now: every finished month that has no team yet. */
export const runRegistrar = (secret: string): Promise<boolean> => post({ secret, run: true });
