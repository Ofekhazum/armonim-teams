// A player's marks over time (§2.39), as a series a chart can draw.
//
// Pure and synchronous: the marks arrive from the Worker (`GET /grades/all`)
// and the dates from the archive this device already has, and everything here
// is the join between them plus a date filter. No fetching, no formatting, no
// pixels — those belong to `GradeGraph.tsx`, and keeping them apart is what
// makes the windowing testable without a DOM.

import type { FixtureRecord } from './types';

/** `{ fixtureId: { playerId: grade } }` — what `GET /grades/all` returns. */
export type AllMarks = Record<string, Record<string, number>>;

export interface GradePoint {
  fixtureId: string;
  /** ISO 'YYYY-MM-DD', straight off the fixture. */
  date: string;
  /** Epoch ms, for placing the point along a time axis. */
  t: number;
  grade: number;
}

export type GradeRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';

/**
 * The ranges, in order, with how far back each reaches.
 *
 * Months are approximated in days rather than walked on the calendar, which is
 * the right trade for an axis: "1M" here is a window on a graph, not a date
 * anybody will do arithmetic against, and a 30-day window that is always the
 * same width beats one that silently changes size in February.
 */
export const RANGES: { id: GradeRange; label: string; days: number | null }[] = [
  { id: '1M', label: '1M', days: 30 },
  { id: '3M', label: '3M', days: 91 },
  { id: '6M', label: '6M', days: 182 },
  { id: '1Y', label: '1Y', days: 365 },
  { id: 'ALL', label: 'All', days: null },
];

/**
 * The default window, and the reason it is the shortest one.
 *
 * A season of weekly football is fifty-odd points; drawn across a phone that is
 * a line with no shape in it. One month is four or five nights — few enough to
 * read as a run of form, which is the question somebody opens their own profile
 * to ask. Every longer view is one tap away.
 */
export const DEFAULT_RANGE: GradeRange = '1M';

/**
 * Every night this player has a published mark for, oldest first.
 *
 * **Only nights that were actually graded and published appear.** A night
 * somebody played but nobody ever wrote marks for is not a gap in their form,
 * it is a night with no data — so it is absent rather than plotted as a zero,
 * which would read as the worst night of their career.
 */
export function playerGradeSeries(
  history: FixtureRecord[],
  marks: AllMarks,
  playerId: string,
): GradePoint[] {
  const out: GradePoint[] = [];
  for (const fx of history) {
    const grade = marks[fx.id]?.[playerId];
    if (!Number.isFinite(grade)) continue;
    const t = Date.parse(fx.date);
    if (!Number.isFinite(t)) continue;
    out.push({ fixtureId: fx.id, date: fx.date, t, grade });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * The part of a series inside a window, measured back from `now`.
 *
 * **Anchored to today rather than to their last night**, which is a real
 * choice. Anchoring to the last night would guarantee the default view always
 * has something in it — but then "1M" would mean a different month for every
 * player, and somebody who has not turned up since April would see a busy graph
 * labelled as the last month. A window that means what it says can be empty,
 * and an empty one is itself the answer to "how has their month been".
 */
export function inRange(points: GradePoint[], range: GradeRange, now: number): GradePoint[] {
  const spec = RANGES.find((r) => r.id === range);
  if (!spec || spec.days === null) return points;
  const from = now - spec.days * 24 * 60 * 60 * 1000;
  return points.filter((p) => p.t >= from);
}

/** Their mean mark across the points on screen, or null when there are none. */
export function meanGrade(points: GradePoint[]): number | null {
  if (points.length === 0) return null;
  return points.reduce((s, p) => s + p.grade, 0) / points.length;
}

/**
 * Which ranges would actually show something, so the controls can say so.
 *
 * Offering "6M" as a live button when it holds exactly what "3M" holds is a
 * control that does nothing, and a reader who taps it learns only that the app
 * wasted their tap. Ranges with nothing in them at all are the ones worth
 * marking, because tapping those is how somebody finds out the graph is not
 * broken — it is empty on purpose.
 */
export function rangeCounts(points: GradePoint[], now: number): Record<GradeRange, number> {
  const out = {} as Record<GradeRange, number>;
  for (const r of RANGES) out[r.id] = inRange(points, r.id, now).length;
  return out;
}
