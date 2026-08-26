// A player's marks over time (§2.39, §2.40), as rows a form panel can show.
//
// Pure and synchronous: the marks arrive from the Worker (`GET /grades/all`)
// and the dates from the archive this device already has, and everything here
// is the join between them plus a date filter. No fetching, no formatting, no
// pixels — those belong to `GradeForm.tsx`, and keeping them apart is what
// makes the windowing testable without a DOM.

import type { FixtureRecord, TeamColor } from './types';
import { profileNights, type Place } from './playerProfile';

/** `{ fixtureId: { playerId: grade } }` — what `GET /grades/all` returns. */
export type AllMarks = Record<string, Record<string, number>>;

/**
 * One graded night, with the context that makes the mark readable.
 *
 * Everything here is a count or a placing the app already holds — there are no
 * goals, assists, minutes or shots anywhere in this record, because nobody
 * writes them down (§2.24). A form table in this app is built from the shirt,
 * what the team took, where they finished and the player-of-the-night pick,
 * and those are the columns because those are the facts.
 */
export interface GradePoint {
  fixtureId: string;
  /** ISO 'YYYY-MM-DD', straight off the fixture. */
  date: string;
  /** Epoch ms, for ordering and for the date windows. */
  t: number;
  grade: number;
  shirt: TeamColor;
  /** What their team took that night — halves included (§2.8). */
  teamWins: number;
  place: Place | null;
  /** Level with another team on that placing — see the "=1" in `GradeForm`. */
  shared: boolean;
  /** Took the night outright; a night level at the top belongs to nobody (§2.6). */
  wonNight: boolean;
  isMvp: boolean;
}

export type GradeRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';

/**
 * The ranges, in order, with how far back each reaches.
 *
 * Months are approximated in days rather than walked on the calendar, which is
 * the right trade here: "1M" is a window on a list, not a date
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
 * A season of weekly football is fifty-odd nights; listed on a phone that is a
 * table nobody scrolls to the end of. One month is four or five nights — few enough to
 * read as a run of form, which is the question somebody opens their own profile
 * to ask. Every longer view is one tap away.
 */
export const DEFAULT_RANGE: GradeRange = '1M';

/**
 * Every night this player has a published mark for, oldest first.
 *
 * **Only nights that were actually graded and published appear.** A night
 * somebody played but nobody ever wrote marks for is not a gap in their form,
 * it is a night with no data — so it is absent rather than shown as a zero,
 * which would read as the worst night of their career.
 */
export function playerGradeSeries(
  history: FixtureRecord[],
  marks: AllMarks,
  playerId: string,
): GradePoint[] {
  // The shirt, the placing and what the team took, from the one function that
  // already answers all three — rather than re-deriving them here and having
  // two places in the app that could disagree about where somebody finished.
  const nights = new Map(profileNights(history, playerId).map((n) => [n.fixtureId, n]));
  const mvpOn = new Set(
    history.filter((fx) => fx.mvpId === playerId).map((fx) => fx.id),
  );

  const out: GradePoint[] = [];
  for (const fx of history) {
    const grade = marks[fx.id]?.[playerId];
    if (!Number.isFinite(grade)) continue;
    const night = nights.get(fx.id);
    if (!night) continue; // graded but not on the sheet — nothing to describe
    const t = Date.parse(fx.date);
    if (!Number.isFinite(t)) continue;
    out.push({
      fixtureId: fx.id,
      date: fx.date,
      t,
      grade,
      shirt: night.shirt,
      teamWins: night.wins,
      place: night.place,
      shared: night.shared,
      wonNight: night.won === true,
      isMvp: mvpOn.has(fx.id),
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * The part of a series inside a window, measured back from `now`.
 *
 * **Anchored to today rather than to their last night**, which is a real
 * choice. Anchoring to the last night would guarantee the default view always
 * has something in it — but then "1M" would mean a different month for every
 * player, and somebody who has not turned up since April would see a busy panel
 * labelled as the last month. A window that means what it says can be empty,
 * and an empty one is itself the answer to "how has their month been".
 */
export function inRange<T extends { t: number }>(points: T[], range: GradeRange, now: number): T[] {
  const spec = RANGES.find((r) => r.id === range);
  if (!spec || spec.days === null) return points;
  const from = now - spec.days * 24 * 60 * 60 * 1000;
  return points.filter((p) => p.t >= from);
}

/** Their mean mark across the points on screen, or null when there are none. */
export function meanGrade(points: { grade: number }[]): number | null {
  if (points.length === 0) return null;
  return points.reduce((s, p) => s + p.grade, 0) / points.length;
}

/**
 * How many nights the form strip shows.
 *
 * Five, which is the number every football screen uses for "recent form" and
 * the number `RECENT_NIGHTS` in `grades.ts` already measures momentum over —
 * so the squares and the momentum term in the mark are looking at the same
 * stretch of football rather than two different definitions of "lately".
 */
export const FORM_NIGHTS = 5;

/** The last few graded nights, oldest first — what the squares are drawn from. */
export const recentForm = (points: GradePoint[]): GradePoint[] =>
  points.slice(-FORM_NIGHTS);

/**
 * Which ranges would actually show something, so the controls can say so.
 *
 * Offering "6M" as a live button when it holds exactly what "3M" holds is a
 * control that does nothing, and a reader who taps it learns only that the app
 * wasted their tap. Ranges with nothing in them at all are the ones worth
 * marking, because tapping those is how somebody finds out the panel is not
 * broken — it is empty on purpose.
 */
export function rangeCounts(points: GradePoint[], now: number): Record<GradeRange, number> {
  const out = {} as Record<GradeRange, number>;
  for (const r of RANGES) out[r.id] = inRange(points, r.id, now).length;
  return out;
}
