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
  // What `nights` is measured against for the attendance bonus below —
  // carried on the row (rather than looked up separately) so the score is
  // always recomputable from the row alone.
  monthLength: number;
}

// How many of the month's nights a player has to have turned up for before
// they can be picked: **more than half**, not half. Three nights out of four,
// two out of three, three out of five. Without a floor at all the team is
// whoever happened to be there on a good night — a single appearance at a high
// rate would top a month of steady football, which is the opposite of what "of
// the month" means.
//
// It was `>= ceil(monthNights / 2)` until 2026-08, which is a different rule
// only on **even-length months**: for an odd month, half rounded up is already
// more than half, so three-of-five was the bar before and after. On a
// four-night month it meant two, and two nights is not enough football to
// carry a month — one lucky shirt out of two turns into a "rate" the score
// cannot tell apart from a real one. The club found this the first time a
// four-night month picked somebody who played twice, won two matches on one of
// those nights and seven on the other.
export const totmEligible = (playerNights: number, monthNights: number): boolean =>
  monthNights > 0 && playerNights > monthNights / 2;

// A night's worth of credit, per night played.
//
// Match wins are the base currency — about four or five a night, per
// isWinMilestone's calibration. A night the team took *outright* is worth two
// more, which is what separates the player who kept edging nights from the one
// who banked a single blowout. An MVP is worth three: a real thumb on the
// scale for the one human judgement the app records, without letting a single
// pick outrank a month of winning football.
//
// ATTENDANCE_BONUS is not a new preference — the sort below already breaks a
// tied score by whoever played more nights. This is that same rule made
// continuous instead of needing an exact float tie to fire, so "played three
// or four times" gets a little credit over "played twice" even when the two
// scores were never going to land on the same number. Scaled by the same
// nights/monthLength share `totmEligible` already gates on, so it only ever
// ranges over [0.5, 1] — weight 1 puts a full-attendance player half a point
// ahead of a half-attendance one, about 1.5x the median score gap near the
// cut measured against a season of real play. Enough to flip a genuinely
// close call, not enough to let attendance alone decide a month.
//
// Deliberately not shown to anyone. It is arithmetic that has to be defensible
// rather than arithmetic that has to be read.
const MATCH_WIN = 1;
const NIGHT_WON = 2;
const MVP_PICK = 3;
const ATTENDANCE_BONUS = 1;

export const totmScore = (p: Omit<TotmPlayer, 'id' | 'name' | 'score'>): number =>
  p.nights === 0 || p.monthLength === 0
    ? 0
    : (p.wins * MATCH_WIN + p.nightsWon * NIGHT_WON + p.mvps * MVP_PICK) / p.nights +
      ATTENDANCE_BONUS * (p.nights / p.monthLength);

export const TOTM_SIZE = 5;

// Two scores this close are not really a ranking, they are the arithmetic
// landing somewhere. `+0.083` — which is what one extra night of attendance
// bonus looks like on a four-night month — is not a reason to put one player
// above another, but it is enough to decide the fifth seat, and the fifth seat
// is the one that gets argued about.
//
// So scores within NEAR_TIE of each other are treated as level and the order
// comes from what the club actually thinks is important, below.
export const NEAR_TIE = 0.1;

/**
 * The order to settle a near-tie in, most important first: the human pick,
 * then nights taken outright, then match wins, then turning up.
 *
 * This is a deliberate inversion of the score's own emphasis. The score is a
 * *rate*, so it deliberately doesn't care how often you came; this list is what
 * to do when the rate has stopped saying anything, and at that point the rarest
 * thing wins — an MVP is one pick a night, a night won is one shirt in three,
 * a match win is four or five an evening, and an appearance is just a yes.
 */
const byImportance = (a: TotmPlayer, b: TotmPlayer): number =>
  b.mvps - a.mvps ||
  b.nightsWon - a.nightsWon ||
  b.wins - a.wins ||
  b.nights - a.nights ||
  a.name.localeCompare(b.name, 'he');

/**
 * Rank by score, but re-order each band of near-level scores by `byImportance`.
 *
 * **Why this is a banding pass and not just a comparator.** The obvious
 * implementation — "if `|a.score - b.score| < NEAR_TIE` compare by importance,
 * else by score" — is not a valid sort comparator, because it is not
 * transitive: with scores 5.09, 5.00 and 4.91 the first two are level and the
 * last two are level, but the outer pair is not, and `Array.prototype.sort`
 * given an inconsistent comparator may produce any order at all. That is a real
 * bug and not a theoretical one: it would make the fifth seat depend on the
 * engine's sort implementation.
 *
 * So the bands are cut first, off a plain score sort, each anchored on its own
 * top scorer — which makes a band strictly narrower than NEAR_TIE, and makes
 * the whole thing deterministic — and only then is each band reordered.
 */
function rankByScoreThenImportance(rows: TotmPlayer[]): TotmPlayer[] {
  const byScore = [...rows].sort((a, b) => b.score - a.score || byImportance(a, b));
  const ranked: TotmPlayer[] = [];
  for (let i = 0; i < byScore.length; ) {
    let end = i + 1;
    while (end < byScore.length && byScore[i].score - byScore[end].score < NEAR_TIE) end++;
    ranked.push(...byScore.slice(i, end).sort(byImportance));
    i = end;
  }
  return ranked;
}

/** The month's played nights with a result, oldest first. `period` is `YYYY-MM`. */
export const monthNights = (history: FixtureRecord[], period: string): FixtureRecord[] =>
  history
    .filter((fx) => hasResult(fx.wins) && fx.date.startsWith(`${period}-`))
    .sort((a, b) => a.date.localeCompare(b.date));

/**
 * The five who carried the month, best first. Fewer than five if the month is
 * thin, and empty if nothing was played.
 *
 * Near-level scores are settled by `byImportance` rather than by the last
 * decimal place — see `rankByScoreThenImportance`. That matters more here than
 * it looks: the fifth slot is the one that gets argued about, and neither "the
 * sort was unstable" nor "he was 0.08 ahead" is an answer anybody accepts.
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

  const eligible = [...nights.entries()]
    .filter(([, n]) => totmEligible(n, played.length))
    .map(([id, n]) => {
      const parts = {
        nights: n,
        wins: wins.get(id) ?? 0,
        nightsWon: nightsWon.get(id) ?? 0,
        mvps: mvpsById.get(id) ?? 0,
        monthLength: played.length,
      };
      return { id, name: nameOf.get(id) ?? '?', score: totmScore(parts), ...parts };
    });

  return rankByScoreThenImportance(eligible).slice(0, TOTM_SIZE);
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
