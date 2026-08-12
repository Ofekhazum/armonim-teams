import type { FixtureRecord, Player } from './types';

// A fact about tonight that's true by counting, not by interpretation.
export type Milestone =
  | { kind: 'nth-night'; id: string; name: string; nights: number }
  | { kind: 'debut'; id: string; name: string }
  // too many debuts to name individually — see MAX_NAMED_DEBUTS
  | { kind: 'debut-group'; count: number };

// A debut is only worth announcing if the history is deep enough that *not*
// appearing in it means something. With two nights on record, everyone who
// missed those two nights is "making their debut", which is just noise —
// and on a fresh install it would tag the entire squad at once.
export const MIN_HISTORY_FOR_DEBUTS = 5;

// Past this many first-timers it stops reading as a milestone and starts
// reading as a list, so they collapse into a single line.
export const MAX_NAMED_DEBUTS = 3;

// Round numbers worth mentioning: 10, 25, then every 50. At roughly one night
// a week that's a mention every year or so once you're established, which is
// about the right rate for it to still feel like something.
export function isMilestoneNight(n: number): boolean {
  return n === 10 || n === 25 || (n >= 50 && n % 50 === 0);
}

// Deliberately only *counts and firsts* — nothing about form, streaks or who's
// playing well. Those read as claims about a player, and a handful of nights
// of three-numbers-a-night results cannot support one (the same reasoning that
// keeps rating suggestions behind MIN_NIGHTS — see calibration.ts and §2.6).
//
// Guests are skipped entirely: a guest gets a fresh uid on every visit, so
// their history never matches and they would be "making their debut" every
// single week. Better to say nothing than to say something false.
export function tonightsMilestones(
  todays: Player[],
  history: FixtureRecord[],
): Milestone[] {
  const priorNights = new Map<string, number>();
  for (const fx of history) {
    // count each fixture once per player, however the sheet is shaped
    for (const id of new Set(fx.players.map((p) => p.id))) {
      priorNights.set(id, (priorNights.get(id) ?? 0) + 1);
    }
  }

  const counted: Extract<Milestone, { kind: 'nth-night' }>[] = [];
  const debuts: { id: string; name: string }[] = [];
  for (const p of todays) {
    if (p.isGuest) continue;
    const prior = priorNights.get(p.id) ?? 0;
    if (prior === 0) {
      debuts.push({ id: p.id, name: p.name });
    } else if (isMilestoneNight(prior + 1)) {
      counted.push({ kind: 'nth-night', id: p.id, name: p.name, nights: prior + 1 });
    }
  }

  counted.sort((a, b) => b.nights - a.nights || a.name.localeCompare(b.name, 'he'));

  if (history.length < MIN_HISTORY_FOR_DEBUTS) return counted;
  if (debuts.length > MAX_NAMED_DEBUTS) {
    return [...counted, { kind: 'debut-group', count: debuts.length }];
  }
  return [
    ...counted,
    ...debuts
      .sort((a, b) => a.name.localeCompare(b.name, 'he'))
      .map((d): Milestone => ({ kind: 'debut', id: d.id, name: d.name })),
  ];
}
