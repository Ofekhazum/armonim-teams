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
  mostNights: { name: string; nights: number } | null;
  topScorer: { name: string; wins: number } | null;
  bottomScorer: { name: string; wins: number; nights: number } | null;
  longestStreak: { name: string; nights: number } | null;
  longestWinless: { name: string; nights: number } | null;
  bestDuo: DuoFact | null;
  worstDuo: DuoFact | null;
}

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

  const [mostNightsId, mostNightsCount] =
    [...nights.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  const [topScorerId, topScorerWins] = [...wins.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

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
    mostNights: mostNightsId ? { name: nameOf.get(mostNightsId)!, nights: mostNightsCount } : null,
    topScorer: topScorerId ? { name: nameOf.get(topScorerId)!, wins: topScorerWins } : null,
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
  };
}
