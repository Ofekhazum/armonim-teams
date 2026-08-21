// Everything one player's page shows, counted from the nights already on
// record (§2.19).
//
// Nothing here is new data. It is the same history the standings table, the
// badges and the milestones are built from, sliced per player instead of per
// column — which is the whole reason a profile page is cheap: the counting was
// already being done, just never gathered in one place with somebody's name on
// it.
//
// One rule runs through all of it. The app records three teams and how many
// matches each won; it has never recorded an individual. So a player's wins
// are the wins of the teams he was in, and the wording here says so wherever
// it could be misread — "his team won it on penalties", never "he won it".

import type { FixtureRecord, MatchLogEntry, TeamColor, TeamWins } from './types';
import { TEAM_COLORS } from './balancer';
import { hasResult } from './calibration';
import {
  isFixtureWinMilestone,
  isMilestoneNight,
  isMvpMilestone,
  isWinMilestone,
  winnerOf,
} from './milestones';

// How much football before a *rate* is worth printing. The same bar the
// rating calibration uses (`MIN_NIGHTS`), and deliberately one number rather
// than a different threshold per statistic: a page that shows "67%" under one
// heading and "not enough nights yet" under the next, off the same four
// nights, is a page nobody can calibrate their trust against.
export const MIN_PROFILE_NIGHTS = 4;

// Which shirt this player wore that night, if they were on the sheet at all.
export const shirtOf = (fx: FixtureRecord, id: string): TeamColor | null =>
  TEAM_COLORS.find((c) => fx.teams[c].includes(id)) ?? null;

// --- The night-by-night ribbon ---------------------------------------------

// Where a team finished that night, out of the three. Standard competition
// ranking: a place is one more than the number of teams strictly above, so two
// teams level at the top are both 1st and the third is 3rd, not 2nd.
export type Place = 1 | 2 | 3;

// Note this is a *placement*, not a win. `winnerOf` (§2.6) says nobody took a
// night that ended level at the top, and that stays true — `nights won` counts
// outright wins only. Two teams genuinely level did both finish first, though,
// so the ribbon gives them both gold and the tooltip says it was shared.
export function placeOf(wins: TeamWins, shirt: TeamColor): Place {
  const mine = wins[shirt] ?? 0;
  return (TEAM_COLORS.filter((c) => (wins[c] ?? 0) > mine).length + 1) as Place;
}

// Did anyone else finish on exactly the same number?
export const sharedPlace = (wins: TeamWins, shirt: TeamColor): boolean =>
  TEAM_COLORS.filter((c) => (wins[c] ?? 0) === (wins[shirt] ?? 0)).length > 1;

export interface ProfileNight {
  fixtureId: string;
  date: string;
  shirt: TeamColor;
  // 1st / 2nd / 3rd on the night, or null when no result was ever recorded
  place: Place | null;
  shared: boolean;
  // whether this player's team took the night outright. Null on a night whose
  // result was never entered — which is not a loss, and must not be drawn as
  // one. `appearances` in milestones.ts drops those nights entirely; a ribbon
  // cannot, because it is a picture of *turning up* as much as of winning.
  won: boolean | null;
  wins: number; // what their team took that night
}

// Every night this player was on the sheet, oldest first — the ribbon in
// order, and the thing most of the counts below are derived from.
export function profileNights(history: FixtureRecord[], id: string): ProfileNight[] {
  return [...history]
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((fx) => {
      const shirt = shirtOf(fx, id);
      if (!shirt) return [];
      const decided = hasResult(fx.wins);
      return [
        {
          fixtureId: fx.id,
          date: fx.date,
          shirt,
          place: decided ? placeOf(fx.wins, shirt) : null,
          shared: decided && sharedPlace(fx.wins, shirt),
          won: decided ? winnerOf(fx) === shirt : null,
          wins: fx.wins[shirt] ?? 0,
        },
      ];
    });
}

// How many nights in each shirt. Pure trivia — it proves nothing about anyone
// — but it is the kind of trivia a squad enjoys, and unlike most of what a
// profile page could show, it is not an inference at all: it is a count of
// what colour someone wore.
export function shirtNights(nights: ProfileNight[]): Record<TeamColor, number> {
  const out: Record<TeamColor, number> = { black: 0, white: 0, blue: 0 };
  for (const n of nights) out[n.shirt]++;
  return out;
}

// --- The counted line -------------------------------------------------------

export interface ProfileCounts {
  nights: number; // nights with a result — what every rate below is over
  onSheet: number; // nights turned up for, result or not
  nightsWon: number; // nights their team finished top of
  wins: number; // matches their teams won, a shootout counting half
  perNight: number | null; // null until MIN_PROFILE_NIGHTS, rather than a lie
  currentRun: number; // nights won in a row, right now
  bestRun: number; // the longest such run ever
}

export function profileCounts(nights: ProfileNight[]): ProfileCounts {
  const decided = nights.filter((n) => n.won !== null);
  let best = 0;
  let run = 0;
  for (const n of decided) {
    run = n.won ? run + 1 : 0;
    if (run > best) best = run;
  }
  const wins = decided.reduce((sum, n) => sum + n.wins, 0);
  return {
    nights: decided.length,
    onSheet: nights.length,
    nightsWon: decided.filter((n) => n.won).length,
    wins,
    perNight: decided.length >= MIN_PROFILE_NIGHTS ? wins / decided.length : null,
    currentRun: run, // the loop ends on the most recent night, so this is it
    bestRun: best,
  };
}

// --- The milestone ladder ---------------------------------------------------

export interface Rung {
  target: number;
  reached: boolean;
}

// The ladder of night counts and win counts a player is climbing, as rungs
// rather than as a surprise on the fixture page. `tonightsMilestones` already
// announces the moment one is crossed (§2.9); this is the same ladder standing
// still, so the announcement reads as an arrival rather than a trick.
//
// Shows every rung already reached plus the next one, and nothing beyond it:
// a list running out to 500 wins is a list about the ladder, not about the
// player standing on it.
function ladder(count: number, isRung: (n: number) => boolean, ceiling: number): Rung[] {
  const rungs: Rung[] = [];
  for (let n = 1; n <= ceiling; n++) {
    if (!isRung(n)) continue;
    rungs.push({ target: n, reached: n <= count });
    if (n > count) break; // the next one, and then stop
  }
  return rungs;
}

// Ceilings are just loop bounds — high enough that a real player never reaches
// them, low enough that this stays a handful of iterations.
export const nightRungs = (nights: number): Rung[] => ladder(nights, isMilestoneNight, 5_000);
export const winRungs = (wins: number): Rung[] => ladder(Math.floor(wins), isWinMilestone, 50_000);
export const fixtureRungs = (won: number): Rung[] => ladder(won, isFixtureWinMilestone, 5_000);
export const mvpRungs = (picks: number): Rung[] => ladder(picks, isMvpMilestone, 1_000);

// --- Ladder badges ----------------------------------------------------------

export interface LadderBadge {
  key: string;
  icon: string;
  // what it is, short enough to wear: "25 nights"
  label: string;
  // how it was earned, in a sentence — shown on hover, and on tap, because a
  // phone has no hover and a badge nobody can decode is decoration
  detail: string;
}

// The top rung reached on each ladder, worn as a badge.
//
// The highest one only, not every rung crossed: a player four ladders deep
// would otherwise carry a dozen chips, and "10 nights" stops being worth saying
// the moment "25 nights" is true. The ladder card underneath still shows the
// whole climb, so nothing is hidden — this is the headline of it.
export function ladderBadges(
  counts: Pick<ProfileCounts, 'nights' | 'nightsWon' | 'wins'>,
  mvps: number,
): LadderBadge[] {
  const top = (rungs: Rung[]): number | null => {
    const reached = rungs.filter((r) => r.reached);
    return reached.length ? reached[reached.length - 1].target : null;
  };

  const out: LadderBadge[] = [];
  const nights = top(nightRungs(counts.nights));
  if (nights) {
    out.push({
      key: `nights-${nights}`,
      icon: '🎽',
      label: `${nights} nights`,
      detail: `Played ${nights} recorded nights.`,
    });
  }
  const wins = top(winRungs(counts.wins));
  if (wins) {
    out.push({
      key: `wins-${wins}`,
      icon: '🏆',
      label: `${wins} wins`,
      detail: `Their teams have won ${wins} matches with them on the pitch.`,
    });
  }
  const fixtures = top(fixtureRungs(counts.nightsWon));
  if (fixtures) {
    out.push({
      key: `fixtures-${fixtures}`,
      icon: '🥇',
      label: `${fixtures} nights won`,
      detail: `Finished top of the night ${fixtures} times.`,
    });
  }
  const picks = top(mvpRungs(mvps));
  if (picks) {
    out.push({
      key: `mvp-${picks}`,
      icon: '🌟',
      label: picks === 1 ? 'First MVP' : `${picks} MVPs`,
      detail:
        picks === 1
          ? 'Picked MVP for the first time.'
          : `Picked MVP on ${picks} different nights.`,
    });
  }
  return out;
}

// How far off the next rung is, or null when it has just been reached exactly.
export function toGo(rungs: Rung[], count: number): { target: number; away: number } | null {
  const next = rungs.find((r) => !r.reached);
  return next ? { target: next.target, away: next.target - Math.floor(count) } : null;
}

// --- Teammates --------------------------------------------------------------

export interface TeammateCount {
  id: string;
  name: string;
  together: number; // nights on the same team, with a result recorded
  won: number; // how many of those their team took
}

// Who this player has actually played alongside, most often first.
//
// A plain count, and deliberately separate from `computeDuoRecords` (§2.10),
// which answers a much harder question: whether a pair does *better* than
// chance. That test is shrunk hard on purpose — a pair needs to win around 60%
// of their nights together against a base rate near a third before it will say
// anything, which is roughly 6 of 8 or 9 of 15 — so on an ordinary season it is
// silent, and a card that only had that to show was a card that only ever said
// "not yet". This says who someone plays with, which is always true and always
// interesting, and leaves the claim about chemistry to the part that earned it.
export function teammateCounts(history: FixtureRecord[], id: string): TeammateCount[] {
  const nameOf = new Map<string, string>();
  const counts = new Map<string, { together: number; won: number }>();

  for (const fx of history) {
    if (!hasResult(fx.wins)) continue;
    const shirt = shirtOf(fx, id);
    if (!shirt) continue;
    const won = winnerOf(fx) === shirt;
    for (const other of fx.teams[shirt]) {
      if (other === id) continue;
      const rec = counts.get(other) ?? { together: 0, won: 0 };
      rec.together++;
      if (won) rec.won++;
      counts.set(other, rec);
      nameOf.set(other, fx.players.find((p) => p.id === other)?.name ?? '?');
    }
  }

  return [...counts.entries()]
    .map(([other, rec]) => ({ id: other, name: nameOf.get(other) ?? '?', ...rec }))
    .sort(
      (a, b) => b.together - a.together || b.won - a.won || a.name.localeCompare(b.name, 'he'),
    );
}

// --- Shootouts --------------------------------------------------------------

export interface ShootoutRecord {
  loggedNights: number; // nights on this player's sheet that were logged match by match
  taken: number; // matches their team won on penalties
  wonInPlay: number; // matches their team won before it got that far
}

// Only nights written down match by match can answer this: a win tally records
// half-wins, but not *which* matches they were. So the record is explicitly
// over the logged nights alone, and the page says how many those are — two
// counts over different windows are fine, two that look like they cover the
// same window are not.
export function shootoutRecord(history: FixtureRecord[], id: string): ShootoutRecord {
  let loggedNights = 0;
  let taken = 0;
  let wonInPlay = 0;
  for (const fx of history) {
    const shirt = shirtOf(fx, id);
    if (!shirt || !fx.matchLog?.length) continue;
    loggedNights++;
    for (const m of fx.matchLog) {
      if (m.winner !== shirt) continue;
      if (m.viaPenalties) taken++;
      else wonInPlay++;
    }
  }
  return { loggedNights, taken, wonInPlay };
}

// Shootouts won by each player's teams, across every logged night — the input
// to the 🎯 badge. Keyed by player id; anybody whose nights were all tallied
// rather than logged simply isn't in the map.
export function shootoutWins(history: FixtureRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (ids: string[], by: number) => {
    for (const id of ids) out.set(id, (out.get(id) ?? 0) + by);
  };
  for (const fx of history) {
    if (!fx.matchLog?.length) continue;
    const penalties = fx.matchLog.filter((m: MatchLogEntry) => m.viaPenalties);
    for (const c of TEAM_COLORS) {
      bump(fx.teams[c], penalties.filter((m) => m.winner === c).length);
    }
  }
  return out;
}

// Nights on a player's sheet that were logged match by match. The 🎯 badge is
// gated on this rather than on nights played: a shootout count from one logged
// night is not a fact about anybody.
export function loggedNightsFor(history: FixtureRecord[], id: string): number {
  return history.filter((fx) => fx.matchLog?.length && shirtOf(fx, id)).length;
}
