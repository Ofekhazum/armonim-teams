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

// --- The same question, asked as a count ----------------------------------
// The scatter plot and the correlation below answer "does balanced by rating
// mean close on the pitch" in the language of statistics, which is the wrong
// language for the person who has to decide whether to trust the teams. This
// asks it the way the rest of the app asks everything (§1): sort the recorded
// nights into the ones the ratings called even and the ones it called uneven,
// and count how each group actually turned out. If the two groups finish the
// same way, the ratings are not predicting anything — and *that* comparison is
// the whole signal, visible without knowing what an r is.

// The threshold the teams board already paints green (§2.4). Reusing it means
// "called even" here means exactly what it meant on the night.
export const EVEN_PREDICTION_MAX = 0.35;

// Win share runs 0 (every team took an equal cut) to 1 (one team took the lot).
// A normal night of three teams and half a dozen matches lands around 3/2/1,
// which is a spread of a third; past that one team ran away with it.
export const CLOSE_RESULT_MAX = 0.34;

export interface TrustBucket {
  nights: number;
  close: number; // ...of which finished with the wins shared around
}

export interface TrustSummary {
  even: TrustBucket;
  uneven: TrustBucket;
  enough: boolean;
}

const bucket = (points: TrustPoint[]): TrustBucket => ({
  nights: points.length,
  close: points.filter((p) => p.actualGap <= CLOSE_RESULT_MAX).length,
});

export function trustSummary(points: TrustPoint[]): TrustSummary {
  return {
    even: bucket(points.filter((p) => p.predictedGap <= EVEN_PREDICTION_MAX)),
    uneven: bucket(points.filter((p) => p.predictedGap > EVEN_PREDICTION_MAX)),
    enough: points.length >= MIN_TRUST_NIGHTS,
  };
}

// The share of each group that finished close, or null when the group is empty
// — a rate off no nights is not a rate.
export const closeRate = (b: TrustBucket): number | null =>
  b.nights ? b.close / b.nights : null;

export type TrustVerdict =
  | 'too-early' // not enough nights, or every night fell in one group
  | 'tracks' // nights called even do finish closer
  | 'no-signal' // both groups finish much the same
  | 'backwards'; // the ones called even finish *less* close

// Twenty points of difference between the two groups before this claims
// anything. Crude on purpose: with a dozen nights split into two groups, one
// night either way moves a rate by ten points, so a smaller margin would be
// reporting noise as a finding.
const MARGIN = 0.2;

export function trustVerdict(summary: TrustSummary): TrustVerdict {
  const even = closeRate(summary.even);
  const uneven = closeRate(summary.uneven);
  // one group empty means there is nothing to compare it against — common
  // early on, when the balancer has called every single night even
  if (!summary.enough || even == null || uneven == null) return 'too-early';
  if (even - uneven >= MARGIN) return 'tracks';
  if (uneven - even >= MARGIN) return 'backwards';
  return 'no-signal';
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
