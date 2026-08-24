// Reading market values (§2.31).
//
// A fetch rather than a function, for the same reason `awards.ts` is one — but
// a different reason underneath. An award is a *record* and can only be asked
// for. A price is a calculation, and this device is missing an input: ratings
// do not leave the Worker (§2.28), so a phone physically cannot work one out.
// Asking is the only way, and that is the design rather than a limitation.
//
// Deliberately does **not** import `marketValue.ts`. The formula belongs to the
// Worker; pulling it into the client bundle would ship a ridge solver and six
// tuning constants to every phone in order to render a string. Everything here
// is about the string.

import type { FixtureRecord, Player } from './types';
import { REMOTE_URL } from './remote';
import { isTestMode } from './testMode';

export interface PlayerValue {
  /** In millions of euros. */
  value: number;
  /** What it was before the most recent night — null on a first valuation. */
  previous: number | null;
}

/** Keyed by player id. Players with no price are simply absent. */
export type Values = Record<string, PlayerValue>;

/**
 * Everyone's price. `{}` on any failure, and on a club too new to have one.
 *
 * A price tag is decoration: an offline phone, a Worker that has not been
 * deployed yet, or a club four nights old should all show a page without one
 * rather than an error about one.
 */
export async function fetchValues(
  // Used only in the sandbox, where there is no Worker to ask and the ratings
  // are invented, so this device is allowed to do the arithmetic itself. In
  // live mode these are ignored — a phone has no ratings and could not compute
  // a price if it wanted to.
  players: Player[] = [],
  history: FixtureRecord[] = [],
): Promise<Values> {
  if (isTestMode()) {
    // Dynamically imported so the formula, the ridge solver and six tuning
    // constants stay out of the main bundle for everybody who is not in the
    // sandbox — which is the same reason this module does not import it at
    // the top.
    const { marketValues } = await import('./marketValue');
    const { testAwards } = await import('./testAwards');
    const awards = testAwards();
    const months = new Map<string, number>();
    for (const period of Object.keys(awards)) {
      for (const id of awards[period].ids) months.set(id, (months.get(id) ?? 0) + 1);
    }
    const out: Values = {};
    for (const v of marketValues(history, players, (id) => months.get(id) ?? 0).values()) {
      out[v.id] = { value: v.value, previous: v.previous };
    }
    return out;
  }

  if (!REMOTE_URL) return {};
  try {
    const res = await fetch(`${REMOTE_URL}/values`, { cache: 'no-store' });
    if (!res.ok) return {};
    const data = (await res.json()) as { values?: Values };
    return data.values && typeof data.values === 'object' ? data.values : {};
  } catch {
    return {};
  }
}

/** `€14.5M`, the way a price is written — trailing zeros trimmed. */
export const formatValue = (millions: number): string =>
  `€${millions.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}M`;

export type Move = { dir: 'up' | 'down'; by: number } | { dir: 'flat' } | { dir: 'new' };

/**
 * Which way it went this week.
 *
 * `new` is its own answer rather than a zero move: a first valuation has
 * nothing behind it, and drawing that as "no change" claims a stability that
 * has not been observed yet.
 */
export function moveOf(price: PlayerValue): Move {
  if (price.previous === null) return { dir: 'new' };
  const by = Math.round((price.value - price.previous) * 100) / 100;
  if (by === 0) return { dir: 'flat' };
  return { dir: by > 0 ? 'up' : 'down', by: Math.abs(by) };
}
