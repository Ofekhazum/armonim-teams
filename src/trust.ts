// Does "balanced by rating" actually mean "close on the pitch"? The balancer
// (src/balancer.ts) optimizes for a small rating-sum gap between teams, but
// nothing in the app ever checks whether that prediction shows up in the
// result. This turns recorded history into one point per night — predicted
// gap vs. actual gap — so that question has an answer instead of an
// assumption.
//
// No new data needed: a FixtureRecord already snapshots each player's rating
// *at the time* (`players: FixturePlayer[]`) and which team they were on
// (`teams`), which is exactly what the balancer had to work with that night.
// Nothing here feeds back into team generation — it's descriptive, the same
// posture as calibration.ts's rating suggestions: a number to look at, never
// an auto-tune loop.

import type { FixtureRecord } from './types';
import { hasResult, totalWins } from './calibration';
import { TEAM_COLORS } from './balancer';

export interface TrustPoint {
  fixtureId: string;
  date: string;
  predictedGap: number; // spread between team *average* ratings (0 = evenly matched on paper)
  actualGap: number; // spread in win share, 0..1 (0 = every team took an equal cut)
}

// Nights with only one team fielded (well below the 13-player minimum, or
// corrupted data) can't be compared — there's nothing to spread.
export function trustPoints(history: FixtureRecord[]): TrustPoint[] {
  const out: TrustPoint[] = [];
  for (const fx of history) {
    if (!hasResult(fx.wins)) continue;

    const ratingOf = new Map(fx.players.map((p) => [p.id, p.rating]));
    const avgs = TEAM_COLORS.map((c) => {
      const ids = fx.teams[c];
      if (ids.length === 0) return null;
      const sum = ids.reduce((n, id) => n + (ratingOf.get(id) ?? 0), 0);
      return sum / ids.length;
    }).filter((a): a is number => a != null);
    if (avgs.length < 2) continue;

    const total = totalWins(fx.wins);
    if (total <= 0) continue;
    const shares = TEAM_COLORS.map((c) => (fx.wins[c] ?? 0) / total);

    out.push({
      fixtureId: fx.id,
      date: fx.date,
      predictedGap: Math.max(...avgs) - Math.min(...avgs),
      actualGap: Math.max(...shares) - Math.min(...shares),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// A night's worth of comparisons is single-digit noise — this is the same
// MIN_NIGHTS-style floor as calibration.ts, so the correlation isn't reported
// off a handful of points that could say anything.
export const MIN_TRUST_NIGHTS = 8;

// Pearson correlation between predicted and actual gap. Null when there isn't
// enough history yet, or when one side never varies (e.g. every night was
// scored 0 wins on one side) and a correlation coefficient is undefined.
export function trustCorrelation(points: TrustPoint[]): number | null {
  if (points.length < MIN_TRUST_NIGHTS) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.predictedGap, 0) / n;
  const my = points.reduce((s, p) => s + p.actualGap, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.predictedGap - mx;
    const dy = p.actualGap - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
