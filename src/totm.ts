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
// who banked a single blowout.
//
// An MVP is worth four, raised from three in 2026-08, which makes it **exactly
// two nights taken outright** — the one ratio here anybody can say out loud.
//
// Raised because it is the only term in this formula that is *about a person
// rather than about a shirt*: match wins and nights won are team facts, banked
// identically by all five players who happened to wear that colour, so two
// teammates are separated by nothing else. At three, divided by nights, one MVP
// was worth 0.75 to a full-attendance player — less than the perfect-attendance
// bonus, which had the single human judgement in the app ranking below turning
// up.
//
// Not higher, and the reason is the shape of a month rather than a number: one
// outstanding night should not be able to carry four bad ones. An MVP already
// arrives on top of the wins and the night its holder's shirt took, so raising
// it further pays three times for one evening. Measured over the invented
// club's ten months (§2.32), five instead of four moves a single seat in a
// single month — the two are the same rule nine months in ten — while six
// starts turning the award into a record of who the organiser liked, which is
// the one thing §2.9 exists to keep this app away from. Given that, the tie
// goes to the weight that explains itself.
//
// The attendance bonus is paid for playing **every** night of the month, for
// nothing less, and it is **worth more in a busier month**.
//
// It replaced a bonus proportional to `nights / monthLength` in 2026-08, on the
// back of raising the eligibility bar above half the month (`totmEligible`):
// once you must play more than half to be eligible at all, a bonus that also
// scales with attendance is paying twice for the same thing, and the sliding
// part had stopped doing any work anyway. On a four-night month the only values
// it could still take were 0.75 and 1.00 — every eligible player already inside
// a 0.25 band — so the slope was noise dressed up as a rule. All-or-nothing
// says the one thing left worth saying: you were here every week.
//
// Scaling it by `monthLength` is the other half of the same thought. Turning up
// to all five nights of a busy month is a harder thing to have done than
// turning up to both nights of a quiet one, and a flat bonus called those
// equal. PERFECT_NIGHT is what each night of the month adds, so the bonus is
// the month's own size — five nights is worth more than three because it *was*
// more.
//
// 0.125 a night puts a four-night month at 0.5, which is where the club landed
// after seeing the real numbers either side: above ~0.73 the bonus decides the
// month outright, dragging a full-attendance player over somebody a clear
// stretch better per night, and at 0.25 it reproduces the old standings and
// changes nothing. Half a point is worth about half a match win a night —
// enough that turning up every week breaks a close call, not enough to outrank
// a genuinely better record.
//
// The cap is a guard rather than a rule anybody will meet: at a weekly fixture
// the month's size runs 4 or 5, and 8 nights would be needed to reach it. It
// stops a freak month (a tournament week, a fixture backlog cleared at once)
// turning the bonus into the whole score.
//
// Deliberately not shown to anyone. It is arithmetic that has to be defensible
// rather than arithmetic that has to be read.
const MATCH_WIN = 1;
const NIGHT_WON = 2;
const MVP_PICK = 4;
const PERFECT_NIGHT = 0.125;
const PERFECT_MAX = 1;

/** What playing every night of an `n`-night month is worth. */
export const perfectAttendanceBonus = (monthLength: number): number =>
  Math.min(PERFECT_MAX, PERFECT_NIGHT * monthLength);

export const totmScore = (p: Omit<TotmPlayer, 'id' | 'name' | 'score'>): number =>
  p.nights === 0 || p.monthLength === 0
    ? 0
    : (p.wins * MATCH_WIN + p.nightsWon * NIGHT_WON + p.mvps * MVP_PICK) / p.nights +
      (p.nights >= p.monthLength ? perfectAttendanceBonus(p.monthLength) : 0);

export const TOTM_SIZE = 5;

// Two scores this close are not really a ranking, they are the arithmetic
// landing somewhere.
//
// 0.1 is calibrated against the smallest thing that can actually happen on the
// pitch. The finest increment this club records is half a match win — a
// shootout — and over a four-night month that is worth 0.125 to a player's
// rate, with a whole match win worth 0.25. So a gap below 0.1 cannot be traced
// back to a single result: it is the division landing differently, not football.
// Deciding the fifth seat on it would be deciding it on rounding, and the fifth
// seat is the one that gets argued about.
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
