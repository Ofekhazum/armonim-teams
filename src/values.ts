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

import { REMOTE_URL } from './remote';

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
export async function fetchValues(): Promise<Values> {
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
