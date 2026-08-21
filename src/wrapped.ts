// A month-in-review recap, in the same spirit as tonight's milestones (§2.9)
// and duo records (§2.10) — every line here is a count over a month's nights,
// never a verdict, and it costs the organiser nothing: no new input, just a
// different lens on `AppState.history`. Rendered as a shareable image by
// src/wrappedImage.ts.

import type { FixtureRecord } from './types';
import { hasResult, totalWins as fixtureWins } from './calibration';
import { TEAM_COLORS } from './balancer';
import { appearances, MIN_WIN_STREAK, MIN_WINLESS_RUN } from './milestones';
import { computeDuoRecords, type DuoFact } from './duos';
import { mvpCounts } from './mvp';

// A little banter alongside the honest counts — same "it's a count, not a
// verdict" rule applies (the copy says "fewest wins", not "worst player"),
// but a recap with only good news reads as a highlight reel, not a record.
// One asymmetry from the positive side: `bottomScorer` requires at least
// this many nights before it's reported, so a newcomer's only night ever
// isn't what gets them roasted — the same mercy the app already extends
// elsewhere to small samples (debuts, MIN_NIGHTS on rating suggestions).
const MIN_NIGHTS_FOR_ROAST = 2;

export interface WrappedStats {
  period: string; // 'YYYY-MM'
  label: string; // e.g. 'August 2026'
  nightsRecorded: number;
  totalWins: number;
  // Everyone who played *every* recorded night this month — not just
  // whoever happened to have the highest count. The old version of this
  // stat picked the single top attendee and unconditionally labelled them
  // "never missed", which was wrong whenever even the best attendance that
  // month fell short of a clean sweep.
  perfectAttendance: { names: string[]; nights: number } | null;
  // Two different questions, deliberately kept apart rather than collapsed
  // into one "top scorer" — there's no goal tally in this app (§2.6), so
  // "scorer" was never the right word. A *match* win is the three-numbers-a-
  // night tally credited to everyone on the team (§2.6); a *fixture* win is
  // whether that team was the strict top of the whole night (winnerOf, same
  // definition milestones/duos already use). A player can rack up match wins
  // on a team that still didn't top many actual nights, or vice versa.
  topMatchWinners: { name: string; wins: number }[]; // top 3, most individual match wins
  topFixtureWinners: { name: string; nights: number }[]; // top 3, most nights their team outright won
  // The one stat here that isn't derived from a result — the organiser's own
  // pick, just counted (see src/mvp.ts). Unlike the two leaderboards above,
  // *not* capped at 3: an MVP pick is one player a night, so it's common
  // for it to spread across many more people than "most matches won" ever
  // does, and cutting that off would hide most of who actually got picked.
  topMvps: { name: string; count: number }[]; // everyone with at least one MVP night, ranked
  bottomScorer: { name: string; wins: number; nights: number } | null;
  longestStreak: { name: string; nights: number } | null;
  longestWinless: { name: string; nights: number } | null;
  bestDuo: DuoFact | null;
  worstDuo: DuoFact | null;
  // The five who carried the month, drawn onto the gold shirt card (§2.21).
  // Ordered best first — the top of the pentagon is the top of the list.
  teamOfMonth: TotmPlayer[];
}

// One place in the Team of the Month, with the parts that earned it kept
// alongside the score. The card itself shows only names, but a number nobody
// can take apart is a number nobody should trust, so the components travel
// with it for anywhere that wants to explain the pick later.
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

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// Which months have at least one recorded night, newest first — populates the
// month picker without assuming the current calendar month has any data yet.
export function wrappedPeriods(history: FixtureRecord[]): string[] {
  const periods = new Set<string>();
  for (const fx of history) {
    if (!hasResult(fx.wins)) continue;
    periods.add(fx.date.slice(0, 7));
  }
  return [...periods].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

function longestRun(apps: { won: boolean }[], won: boolean): number {
  let best = 0;
  let cur = 0;
  for (const a of apps) {
    if (a.won === won) {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

export function buildWrapped(history: FixtureRecord[], period: string): WrappedStats {
  const chronological = [...history]
    .filter((fx) => hasResult(fx.wins) && fx.date.startsWith(`${period}-`))
    .sort((a, b) => a.date.localeCompare(b.date));

  const nameOf = new Map<string, string>();
  for (const fx of chronological) for (const p of fx.players) nameOf.set(p.id, p.name);

  const nights = new Map<string, number>();
  const wins = new Map<string, number>();
  for (const fx of chronological) {
    for (const c of TEAM_COLORS) {
      for (const id of fx.teams[c]) {
        nights.set(id, (nights.get(id) ?? 0) + 1);
        wins.set(id, (wins.get(id) ?? 0) + (fx.wins[c] ?? 0));
      }
    }
  }

  // Not the same number as summing the `wins` map above — that map is each
  // *player's* personal credit (their team's tally, once per player on it),
  // so a single 3-0 night would count as 15 there. This is the actual match
  // total, once per night — what "wins banked by the squad" should mean.
  const totalWins = chronological.reduce((n, fx) => n + fixtureWins(fx.wins), 0);

  const perfectNames = [...nights.entries()]
    .filter(([, n]) => n === chronological.length)
    .map(([id]) => nameOf.get(id)!)
    .sort((a, b) => a.localeCompare(b, 'he'));
  const perfectAttendance =
    chronological.length > 0 && perfectNames.length > 0
      ? { names: perfectNames, nights: chronological.length }
      : null;

  const topMatchWinners = [...wins.entries()]
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, w]) => ({ name: nameOf.get(id)!, wins: w }));

  // Nights (not matches) this player's team was the strict top of the whole
  // night — `appearances()` already carries that flag per night (`won`),
  // computed the same way tonight's win-streak fact reads it.
  const fixturesWon = new Map<string, number>();
  for (const id of nameOf.keys()) {
    fixturesWon.set(id, appearances(id, chronological).filter((a) => a.won).length);
  }
  const topFixtureWinners = [...fixturesWon.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, n]) => ({ name: nameOf.get(id)!, nights: n }));

  const topMvps = mvpCounts(chronological).map((m) => ({ name: m.name, count: m.count }));

  // The five who carried the month. Ties are broken by the parts of the score
  // in the order they matter — more football played, then more of the human
  // pick, then more nights taken outright — so the fifth slot is decided by
  // something rather than by whichever way the sort happened to fall.
  const mvpsById = new Map(mvpCounts(chronological).map((m) => [m.id, m.count]));
  const teamOfMonth: TotmPlayer[] = [...nights.entries()]
    .filter(([, n]) => totmEligible(n, chronological.length))
    .map(([id, n]) => {
      const parts = {
        nights: n,
        wins: wins.get(id) ?? 0,
        nightsWon: fixturesWon.get(id) ?? 0,
        mvps: mvpsById.get(id) ?? 0,
      };
      return { id, name: nameOf.get(id)!, score: totmScore(parts), ...parts };
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

  const [bottomScorerId, bottomScorerWins] =
    [...wins.entries()]
      .filter(([id]) => (nights.get(id) ?? 0) >= MIN_NIGHTS_FOR_ROAST)
      .sort((a, b) => a[1] - b[1])[0] ?? [];

  let longestStreak: { name: string; nights: number } | null = null;
  let longestWinless: { name: string; nights: number } | null = null;
  for (const id of nameOf.keys()) {
    const apps = appearances(id, chronological);
    const won = longestRun(apps, true);
    if (won >= MIN_WIN_STREAK && (!longestStreak || won > longestStreak.nights)) {
      longestStreak = { name: nameOf.get(id)!, nights: won };
    }
    const lost = longestRun(apps, false);
    if (lost >= MIN_WINLESS_RUN && (!longestWinless || lost > longestWinless.nights)) {
      longestWinless = { name: nameOf.get(id)!, nights: lost };
    }
  }

  const { best: bestDuo, worst: worstDuo } = computeDuoRecords(
    chronological,
    new Set(nameOf.keys()),
    nameOf,
  );

  return {
    period,
    label: periodLabel(period),
    nightsRecorded: chronological.length,
    totalWins,
    perfectAttendance,
    topMatchWinners,
    topFixtureWinners,
    topMvps,
    bottomScorer: bottomScorerId
      ? {
          name: nameOf.get(bottomScorerId)!,
          wins: bottomScorerWins,
          nights: nights.get(bottomScorerId)!,
        }
      : null,
    longestStreak,
    longestWinless,
    bestDuo,
    worstDuo,
    teamOfMonth,
  };
}
