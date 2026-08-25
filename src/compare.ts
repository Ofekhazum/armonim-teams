// Two players' records, side by side (§2.37).
//
// **Nothing here is measured that was not already being measured.** Each side
// is `profileCounts` over `profileNights` — the same numbers the career table
// prints and the player page shows — and the shared half is one entry out of
// `matchups()`, which has counted both "played alongside" and "played against"
// since §2.18. This module picks two players out and lines the columns up.
//
// **It compares, and it does not judge.** The backlog's own rule for this
// feature was that it must not become a ranking of two named friends on
// anything the data cannot carry, and the way that is kept is by restricting
// it to numbers *both players own*: nights, nights won, match wins, MVP picks,
// runs. Every one is a count of something that happened to each of them
// separately, so putting them beside each other is arithmetic the reader could
// do by looking at the table twice.
//
// `perNight` is the one rate here, and it is included where it was excluded
// from the podiums (§2.36) — deliberately, and the difference is the sample
// size. A podium shows "best in the club" with nothing to calibrate against;
// here the nights each rate was computed from are on the same row, two lines
// up. A rate you can see the denominator of is a fact; one you cannot is a
// verdict.
//
// **What is *not* here: anything about the two of them as a pair beyond the
// raw record.** No "these two click", no chemistry score — `duos.ts` explains
// at length why a shrunk win rate is the most that record can support, and a
// comparison screen is exactly where somebody would over-read it.

import type { FixtureRecord } from './types';
import { profileCounts, profileNights, matchups } from './playerProfile';
import { mvpCounts } from './mvp';

export interface CompareSide {
  id: string;
  name: string;
  nights: number; // nights with a result — what every number below is over
  nightsWon: number;
  wins: number; // matches their teams won, a shootout counting half (§2.8)
  perNight: number | null;
  mvps: number;
  bestRun: number;
  currentRun: number;
}

/** What the two of them have done to and alongside each other. */
export interface Shared {
  together: number; // nights on the same team, with a result
  togetherWon: number; // of those, nights that team took outright
  against: number; // nights on opposing teams
  // Matches — not nights — and therefore only from nights logged match by
  // match (§2.17). Zero here means "never logged against each other", which is
  // a different thing from "never opposed", and the UI has to say which.
  faced: number;
  aWon: number; // matches a's team took off b's
  bWon: number;
}

export interface Comparison {
  a: CompareSide;
  b: CompareSide;
  shared: Shared;
}

function sideOf(history: FixtureRecord[], id: string, mvps: Map<string, number>): CompareSide | null {
  const nights = profileNights(history, id);
  if (nights.length === 0) return null;
  const c = profileCounts(nights);
  return {
    id,
    // Read off the fixtures rather than the roster: a player who has left the
    // club still has a record, and it is still theirs.
    name: nameFrom(history, id),
    nights: c.nights,
    nightsWon: c.nightsWon,
    wins: c.wins,
    perNight: c.perNight,
    mvps: mvps.get(id) ?? 0,
    bestRun: c.bestRun,
    currentRun: c.currentRun,
  };
}

const nameFrom = (history: FixtureRecord[], id: string): string => {
  // Latest first — a player who changed their name should read as the name
  // they go by now, not the one on their first night.
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i].players.find((x) => x.id === id);
    if (p) return p.name;
  }
  return '?';
};

/**
 * Both records and the football between them, or `null` when the pair cannot
 * be compared — the same id twice, or either of them with nothing on record.
 */
export function comparePlayers(
  history: FixtureRecord[],
  aId: string,
  bId: string,
): Comparison | null {
  if (aId === bId) return null;
  const mvps = new Map(mvpCounts(history).map((m) => [m.id, m.count]));
  const a = sideOf(history, aId, mvps);
  const b = sideOf(history, bId, mvps);
  if (!a || !b) return null;

  // One entry out of a's matchup list — read from a's side, so `beat` is a's
  // team winning. Absent entirely when they have never been on a sheet
  // together, which is a real state and not an error.
  const m = matchups(history, aId).find((x) => x.id === bId);

  return {
    a,
    b,
    shared: {
      together: m?.together ?? 0,
      togetherWon: m?.togetherWon ?? 0,
      against: m?.against ?? 0,
      faced: m?.faced ?? 0,
      aWon: m?.beat ?? 0,
      bWon: m?.beatenBy ?? 0,
    },
  };
}
