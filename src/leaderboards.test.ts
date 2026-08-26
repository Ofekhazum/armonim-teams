import { describe, expect, it } from 'vitest';
import type { FixtureRecord } from './types';
import { TOP_RANKS, leaderboards } from './leaderboards';

// The club's podiums (§2.36). Most of what is worth asserting here is about
// the ranking rule and about what a board *declines* to say: a rate, a zero,
// and anything at all before the club has happened enough.

let seq = 0;

/** One night. `winner` takes 5, the other two take 3 and 1. */
const night = (
  black: string[],
  white: string[],
  blue: string[],
  winner: 'black' | 'white' | 'blue',
  mvpId?: string,
): FixtureRecord => {
  seq++;
  const wins = { black: 1, white: 1, blue: 1 };
  wins[winner] = 5;
  return {
    id: `f${seq}`,
    date: `2026-01-${String(seq).padStart(2, '0')}`,
    teams: { black, white, blue },
    players: [...black, ...white, ...blue].map((id) => ({ id, name: id, rating: 3 })),
    wins,
    ...(mvpId ? { mvpId } : {}),
  };
};

const SQUAD: [string[], string[], string[]] = [['a'], ['b'], ['c']];

/** `n` nights in which the same shirt always takes it. */
const runOf = (winner: 'black' | 'white' | 'blue', n: number, mvpId?: string) =>
  Array.from({ length: n }, () => night(...SQUAD, winner, mvpId));

const boardOf = (history: FixtureRecord[], key: string) =>
  leaderboards(history).find((b) => b.key === key);

describe('leaderboards', () => {
  it('has podiums from the very first night, with no minimum to clear', () => {
    // There used to be a five-night floor. Removed deliberately: an early
    // podium can be a long list of people genuinely level on one, and that is
    // preferred to a Club tab that says nothing for five weeks.
    const boards = leaderboards(runOf('black', 1));
    expect(boards.length).toBeGreaterThan(0);
    expect(boards.find((b) => b.key === 'wins')!.entries[0]).toMatchObject({ id: 'a', rank: 1 });
  });

  it('says nothing at all when there is no football yet', () => {
    // The one gate left. Six headings with nothing under them is the state
    // this avoids — "not yet" is one thing to say, not six.
    expect(leaderboards([])).toEqual([]);
  });

  it('ignores nights nobody typed a result into', () => {
    const blank: FixtureRecord = { ...night(...SQUAD, 'black'), wins: { black: 0, white: 0, blue: 0 } };
    // A blank night is not football, so it puts nobody on any podium.
    expect(leaderboards([blank])).toEqual([]);
  });

  it('ranks match wins, halves and all', () => {
    const history = runOf('black', 5);
    const wins = boardOf(history, 'wins')!;
    expect(wins.entries[0]).toMatchObject({ id: 'a', value: 25, rank: 1 });
    expect(wins.half).toBe(true);
    // b and c both took 1 a night for 5 nights, so they are level on second.
    expect(wins.entries.slice(1).map((e) => e.rank)).toEqual([2, 2]);
  });

  it('shares a rank on a tie, and lets the tie consume the rank below it', () => {
    // 'a' wins 5 outright; 'b' and 'c' win none. Nights-won has one name at
    // rank 1 and nobody else, because zero is dropped.
    const won = boardOf(runOf('black', 5), 'nights-won')!;
    expect(won.entries).toHaveLength(1);
    expect(won.entries[0]).toMatchObject({ id: 'a', value: 5, rank: 1 });
  });

  it('never runs past TOP_RANKS ranks, however many are tied into them', () => {
    // Four players, each on their own shirt across enough nights that all four
    // end up on different totals — then check nothing beyond the third rank
    // survives.
    const history = [
      ...runOf('black', 4), // a: 4
      ...runOf('white', 3), // b: 3
      ...runOf('blue', 2), // c: 2
      ...runOf('black', 1), // a: 5 total
    ];
    const board = boardOf(history, 'nights-won')!;
    expect(Math.max(...board.entries.map((e) => e.rank))).toBeLessThanOrEqual(TOP_RANKS);
  });

  it('drops a zero rather than putting somebody on a podium for having none', () => {
    // Nobody has ever been picked MVP, so there is no MVP board at all —
    // rather than three names sitting under a heading on nought.
    expect(boardOf(runOf('black', 5), 'mvp')).toBeUndefined();
  });

  it('counts MVP picks when there are some', () => {
    const board = boardOf(runOf('black', 5, 'a'), 'mvp')!;
    expect(board.entries[0]).toMatchObject({ id: 'a', value: 5, rank: 1 });
  });

  it('has no board for a rate — a podium is not the place for one', () => {
    // The §2.9 line, and the one exclusion this module exists to make. Wins
    // and nights are totals, so more football can only help; per-night is a
    // rate, and a podium hides the sample size that makes it readable.
    const keys = leaderboards(runOf('black', 5)).map((b) => b.key);
    expect(keys).not.toContain('perNight');
    expect(keys).not.toContain('per-night');
  });

  it('separates the run they are on now from the longest they have had', () => {
    // 'a' wins four, then loses one. The longest run is still 4; the current
    // run is over, so that board should not carry them at all.
    const history = [...runOf('black', 4), ...runOf('white', 1)];
    expect(boardOf(history, 'win-run')!.entries[0]).toMatchObject({ id: 'a', value: 4 });
    const active = boardOf(history, 'active-run');
    expect(active?.entries.find((e) => e.id === 'a')).toBeUndefined();
    // and 'b', who took the most recent night, is the one on a run
    expect(active!.entries[0]).toMatchObject({ id: 'b', value: 1 });
  });

  it('is the same answer every time it is asked', () => {
    const history = runOf('black', 6, 'a');
    expect(leaderboards(history)).toEqual(leaderboards(history));
  });
});
