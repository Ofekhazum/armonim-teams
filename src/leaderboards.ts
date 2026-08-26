// The club's podiums (§2.36) — the top three in each of the counts this app
// already keeps, for the Club statistics tab.
//
// **Nothing here is a new fact.** Every board below is a column that already
// exists somewhere: `playerStandings` has wins and nights, `mvpCounts` has the
// picks, and `achievements.ts` already computes both winning runs in order to
// badge them. This file re-reads those and ranks them; it does not measure
// anything that was not already being measured.
//
// **Counts only, and that is a deliberate exclusion rather than an oversight.**
// The one number on the career table that is *not* a raw count is `perNight`,
// a rate — and a rate is the one thing that must not go on a podium. A podium
// is a much stronger claim than a sortable column: sorted, "2.5 per night off
// two nights" sits at the top of a list the reader can see the rest of; on a
// podium it becomes "best in the club" with the sample size nowhere on screen.
// Wins, nights and picks cannot do that to anybody — they are totals, so more
// football can only ever help. `perNight` stays a column (§2.9).
//
// **Ties share a rank, the way places do.** Standard competition ranking, the
// same rule `placeOf` uses for three teams level on a night: four players tied
// for second are all second, and nobody is third. So a board can be longer
// than three names, and on a young club usually is — which is honest, and the
// alternative is breaking a genuine tie on something arbitrary like the
// alphabet.

import type { FixtureRecord } from './types';
import { hasResult, playerStandings } from './calibration';
import { MIN_NIGHTS_FOR_TITLES, activeWinRun, longestWinRun } from './achievements';
import { appearances } from './milestones';
import { mvpCounts } from './mvp';

// **There is deliberately no minimum number of nights here any more.**
//
// There was: `MIN_NIGHTS_FOR_TITLES`, on the reasoning that "most nights won"
// off three nights is a fact about the history's length rather than about the
// player. That reasoning is still true, and the organiser weighed it against a
// Club tab that says nothing for five weeks and chose to show the boards
// anyway — measured, on the real club's three nights: two of the six boards
// separate people cleanly, and the other four come out as eight to thirteen
// names level on one. Ties sharing a rank is correct and stays correct; it just
// means an early podium can be a long list of people who are genuinely level.
//
// The one thing still filtered is a board with *nothing* in it — see the return
// of `leaderboards`.

/** How many *ranks* deep a podium goes — not how many names, see the tie rule. */
export const TOP_RANKS = 3;

export type BoardKey = 'wins' | 'nights-won' | 'nights' | 'mvp' | 'win-run' | 'active-run';

export interface LeaderEntry {
  id: string;
  name: string;
  value: number;
  /** 1, 2 or 3. Shared by everyone level on `value`. */
  rank: number;
}

export interface Leaderboard {
  key: BoardKey;
  icon: string;
  /** What was counted, said as the count it is — never as what it proves. */
  title: string;
  /** The unit, for the line under each number. Singular; the UI pluralises. */
  unit: string;
  /** Wins carry halves (§2.8); everything else is whole. */
  half: boolean;
  entries: LeaderEntry[];
}

/**
 * Rank a set of scores, keeping only the top {@link TOP_RANKS} ranks.
 *
 * Zero is dropped before ranking rather than after. A board reading "0 · 0 · 0"
 * is not a podium with nobody on it, it is three people being told publicly
 * that they have none of something — and on a young club, or a count like MVP
 * picks that most players will never have, that would be most of the roster.
 */
function podium(
  scores: { id: string; name: string; value: number }[],
): LeaderEntry[] {
  const ranked = scores
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'he'));

  const out: LeaderEntry[] = [];
  let rank = 0;
  let previous: number | null = null;
  for (const s of ranked) {
    // Standard competition ranking: a rank is one more than the number of
    // players strictly above, so a tie consumes the ranks beneath it.
    if (previous === null || s.value < previous) rank = out.length + 1;
    if (rank > TOP_RANKS) break;
    out.push({ id: s.id, name: s.name, value: s.value, rank });
    previous = s.value;
  }
  return out;
}

/**
 * Every podium that has somebody on it, in the order they are drawn.
 *
 * **A board with no entries is dropped rather than drawn empty**, which is the
 * only gate left. `podium` already discards a zero — nobody is on a podium for
 * never having won one — so a club with no football yet produces six boards
 * with nothing in them, and six empty headings is the state `fitnessRings`
 * (§2.35) exists to avoid: "not yet" is one thing to say, not six. It also
 * covers the narrower case that outlives the early weeks, which is a single
 * board nobody has scored on — a season where no run ever reached two, say.
 */
export function leaderboards(history: FixtureRecord[]): Leaderboard[] {
  const recorded = [...history]
    .filter((fx) => hasResult(fx.wins))
    .sort((a, b) => a.date.localeCompare(b.date));

  const standings = playerStandings(history);
  const mvps = new Map(mvpCounts(history).map((m) => [m.id, m.count]));

  // One walk per player, reused by three of the six boards below.
  const apps = new Map(standings.map((s) => [s.id, appearances(s.id, recorded)]));
  const of = (id: string) => apps.get(id) ?? [];

  const board = (
    key: BoardKey,
    icon: string,
    title: string,
    unit: string,
    half: boolean,
    value: (s: (typeof standings)[number]) => number,
  ): Leaderboard => ({
    key,
    icon,
    title,
    unit,
    half,
    entries: podium(standings.map((s) => ({ id: s.id, name: s.name, value: value(s) }))),
  });

  return [
    board('wins', '🥇', 'Most match wins', 'win', true, (s) => s.wins),
    board('nights-won', '🏅', 'Most nights won outright', 'night', false, (s) =>
      of(s.id).filter((a) => a.won).length,
    ),
    board('nights', '🎽', 'Most nights played', 'night', false, (s) => s.nights),
    board('mvp', '🌟', 'Most MVP picks', 'pick', false, (s) => mvps.get(s.id) ?? 0),
    board('win-run', '📈', 'Longest winning run', 'night', false, (s) =>
      longestWinRun(of(s.id)),
    ),
    // The only board that is about *right now* rather than about a career, so
    // it is the only one that can empty out from one bad Thursday. That is the
    // point of it: a run nobody is on is a run nobody should be wearing.
    board('active-run', '🔥', 'On a run right now', 'night', false, (s) =>
      activeWinRun(of(s.id)),
    ),
  ].filter((b) => b.entries.length > 0);
}
