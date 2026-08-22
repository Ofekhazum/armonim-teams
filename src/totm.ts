// Team of the Month: the five who carried a month (§2.25).
//
// Lifted out of `wrapped.ts` for one reason, and it is the reason the whole
// feature hangs on. Two things now ask who was in a month's team — the shirt
// image the organiser posts to the group, and the Worker's cron, which writes
// the award down on the 1st with nobody's phone open. If those two ever
// disagreed the feature would be worse than not having it: a player's page
// would name five people and the card everybody saw would name five others.
//
// So the scoring lives here, once, and both of them import it. The Worker
// bundles this file directly (esbuild follows the import and tree-shakes the
// rest of `milestones`/`calibration` away), which is the only way to be sure
// the rule cannot drift — a copy in the Worker would agree on the day it was
// written and quietly stop agreeing on the day one of them was tuned.

import type { FixtureRecord } from './types';
import { hasResult } from './calibration';
import { TEAM_COLORS } from './balancer';
import { teamOf, winnerOf } from './milestones';
import { mvpCounts } from './mvp';

// One place in the team, with the parts that earned it kept alongside the
// score. The card itself shows only names, but a number nobody can take apart
// is a number nobody should trust, so the components travel with it for
// anywhere that wants to explain the pick later.
export interface TotmPlayer {
  id: string;
  name: string;
  score: number;
  nights: number;
  wins: number;
  nightsWon: number;
  mvps: number;
}

// How many of the month's nights a player has to have turned up for before
// they can be picked. Half, rounded up: three nights out of five, two out of
// four. Without it the team is whoever happened to be there on a good night —
// a single appearance at a high rate would top a month of steady football,
// which is the opposite of what "of the month" means.
export const totmEligible = (playerNights: number, monthNights: number): boolean =>
  monthNights > 0 && playerNights >= Math.ceil(monthNights / 2);

// A night's worth of credit, per night played.
//
// Match wins are the base currency — about four or five a night, per
// isWinMilestone's calibration. A night the team took *outright* is worth two
// more, which is what separates the player who kept edging nights from the one
// who banked a single blowout. An MVP is worth three: a real thumb on the
// scale for the one human judgement the app records, without letting a single
// pick outrank a month of winning football.
//
// Deliberately not shown to anyone. It is arithmetic that has to be defensible
// rather than arithmetic that has to be read.
const MATCH_WIN = 1;
const NIGHT_WON = 2;
const MVP_PICK = 3;

export const totmScore = (p: Omit<TotmPlayer, 'id' | 'name' | 'score'>): number =>
  p.nights === 0
    ? 0
    : (p.wins * MATCH_WIN + p.nightsWon * NIGHT_WON + p.mvps * MVP_PICK) / p.nights;

export const TOTM_SIZE = 5;

/** The month's played nights with a result, oldest first. `period` is `YYYY-MM`. */
export const monthNights = (history: FixtureRecord[], period: string): FixtureRecord[] =>
  history
    .filter((fx) => hasResult(fx.wins) && fx.date.startsWith(`${period}-`))
    .sort((a, b) => a.date.localeCompare(b.date));

/**
 * The five who carried the month, best first. Fewer than five if the month is
 * thin, and empty if nothing was played.
 *
 * Ties are broken by the parts of the score in the order they matter — more
 * football played, then more of the human pick, then more nights taken
 * outright — so the fifth slot is decided by something rather than by
 * whichever way the sort happened to fall. That matters more here than it
 * looks: the fifth slot is the one that gets argued about, and "the sort was
 * unstable" is not an answer anybody accepts.
 */
export function teamOfMonth(history: FixtureRecord[], period: string): TotmPlayer[] {
  const played = monthNights(history, period);
  if (played.length === 0) return [];

  const nameOf = new Map<string, string>();
  for (const fx of played) for (const p of fx.players) nameOf.set(p.id, p.name);

  const nights = new Map<string, number>();
  const wins = new Map<string, number>();
  const nightsWon = new Map<string, number>();
  for (const fx of played) {
    // the strict top of the night — a three-way or two-way tie means nobody
    // "took" it, the same way `winnerOf` reads it everywhere else
    const champion = winnerOf(fx);
    for (const c of TEAM_COLORS) {
      for (const id of fx.teams[c]) {
        nights.set(id, (nights.get(id) ?? 0) + 1);
        wins.set(id, (wins.get(id) ?? 0) + (fx.wins[c] ?? 0));
        if (champion === c) nightsWon.set(id, (nightsWon.get(id) ?? 0) + 1);
      }
    }
  }

  const mvpsById = new Map(mvpCounts(played).map((m) => [m.id, m.count]));

  return [...nights.entries()]
    .filter(([, n]) => totmEligible(n, played.length))
    .map(([id, n]) => {
      const parts = {
        nights: n,
        wins: wins.get(id) ?? 0,
        nightsWon: nightsWon.get(id) ?? 0,
        mvps: mvpsById.get(id) ?? 0,
      };
      return { id, name: nameOf.get(id) ?? '?', score: totmScore(parts), ...parts };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.nights - a.nights ||
        b.mvps - a.mvps ||
        b.nightsWon - a.nightsWon ||
        a.name.localeCompare(b.name, 'he'),
    )
    .slice(0, TOTM_SIZE);
}

/** Which months have at least one night with a result, newest first. */
export function totmPeriods(history: FixtureRecord[]): string[] {
  const periods = new Set<string>();
  for (const fx of history) {
    if (hasResult(fx.wins)) periods.add(fx.date.slice(0, 7));
  }
  return [...periods].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

// `teamOf` is re-exported so the Worker has one import for everything it needs
// to answer "was this player in that team" without reaching into milestones.
export { teamOf };
