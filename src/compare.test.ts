import { describe, expect, it } from 'vitest';
import type { FixtureRecord, MatchLogEntry } from './types';
import { comparePlayers } from './compare';

// Two records side by side (§2.37). The counts themselves are `profileCounts`'
// and `matchups`' jobs and are tested there; what matters here is that the
// right two players are picked out, that the shared half is read from the
// right side, and that "no football between them" is a state rather than a
// crash.

let seq = 0;

const night = (
  black: string[],
  white: string[],
  blue: string[],
  wins: { black: number; white: number; blue: number },
  extra: { mvpId?: string; matchLog?: MatchLogEntry[] } = {},
): FixtureRecord => {
  seq++;
  return {
    id: `f${seq}`,
    date: `2026-01-${String(seq).padStart(2, '0')}`,
    teams: { black, white, blue },
    players: [...black, ...white, ...blue].map((id) => ({ id, name: id, rating: 3 })),
    wins,
    ...extra,
  };
};

const bw = (winner: 'black' | 'white'): MatchLogEntry => ({
  a: 'black',
  b: 'white',
  winner,
  viaPenalties: false,
});

describe('comparePlayers', () => {
  it('refuses to compare somebody with themselves', () => {
    const history = [night(['a'], ['b'], [], { black: 3, white: 1, blue: 0 })];
    expect(comparePlayers(history, 'a', 'a')).toBeNull();
  });

  it('refuses a player with nothing on record', () => {
    const history = [night(['a'], ['b'], [], { black: 3, white: 1, blue: 0 })];
    expect(comparePlayers(history, 'a', 'ghost')).toBeNull();
  });

  it('counts each side over their own nights, not the pair’s', () => {
    // 'a' plays three nights, 'b' only the first two — so the totals must not
    // be over some shared subset.
    const history = [
      night(['a'], ['b'], [], { black: 3, white: 1, blue: 0 }),
      night(['a'], ['b'], [], { black: 3, white: 1, blue: 0 }),
      night(['a'], ['x'], [], { black: 3, white: 1, blue: 0 }),
    ];
    const c = comparePlayers(history, 'a', 'b')!;
    expect(c.a.nights).toBe(3);
    expect(c.a.nightsWon).toBe(3);
    expect(c.a.wins).toBe(9);
    expect(c.b.nights).toBe(2);
    expect(c.b.nightsWon).toBe(0);
    expect(c.b.wins).toBe(2);
  });

  it('reads the head-to-head from the first player’s side', () => {
    // black takes 3 matches, white takes 1. 'a' is black, 'b' is white — so
    // aWon must be 3 whichever way round the ids happen to sort.
    const log = [bw('black'), bw('black'), bw('black'), bw('white')];
    const history = [night(['a'], ['b'], [], { black: 3, white: 1, blue: 0 }, { matchLog: log })];
    const c = comparePlayers(history, 'a', 'b')!;
    expect(c.shared.faced).toBe(4);
    expect(c.shared.aWon).toBe(3);
    expect(c.shared.bWon).toBe(1);

    // and asked the other way round, it mirrors rather than repeating itself
    const flipped = comparePlayers(history, 'b', 'a')!;
    expect(flipped.shared.aWon).toBe(1);
    expect(flipped.shared.bWon).toBe(3);
  });

  it('counts nights alongside separately from matches against', () => {
    const history = [
      // same team, and that team takes the night
      night(['a', 'b'], ['x'], [], { black: 3, white: 1, blue: 0 }),
      // opposite teams, logged
      night(['a'], ['b'], [], { black: 2, white: 1, blue: 0 }, { matchLog: [bw('black'), bw('white')] }),
    ];
    const c = comparePlayers(history, 'a', 'b')!;
    expect(c.shared.together).toBe(1);
    expect(c.shared.togetherWon).toBe(1);
    expect(c.shared.against).toBe(1);
    expect(c.shared.faced).toBe(2);
  });

  it('reports no head-to-head for a night that was only tallied', () => {
    // Opponents all evening, but nobody wrote the matches down — so there is
    // an `against` night and no `faced` matches (§2.17). The two numbers
    // disagreeing is the correct answer, not a bug.
    const history = [night(['a'], ['b'], [], { black: 3, white: 1, blue: 0 })];
    const c = comparePlayers(history, 'a', 'b')!;
    expect(c.shared.against).toBe(1);
    expect(c.shared.faced).toBe(0);
  });

  it('handles two players who have never shared a sheet', () => {
    const history = [
      night(['a'], ['x'], [], { black: 3, white: 1, blue: 0 }),
      night(['b'], ['y'], [], { black: 3, white: 1, blue: 0 }),
    ];
    const c = comparePlayers(history, 'a', 'b')!;
    expect(c.shared).toEqual({
      together: 0,
      togetherWon: 0,
      against: 0,
      faced: 0,
      aWon: 0,
      bWon: 0,
    });
    // both still have their own records
    expect(c.a.nights).toBe(1);
    expect(c.b.nights).toBe(1);
  });

  it('carries MVP picks and both runs', () => {
    const history = [
      night(['a'], ['b'], [], { black: 3, white: 1, blue: 0 }, { mvpId: 'a' }),
      night(['a'], ['b'], [], { black: 3, white: 1, blue: 0 }, { mvpId: 'a' }),
    ];
    const c = comparePlayers(history, 'a', 'b')!;
    expect(c.a.mvps).toBe(2);
    expect(c.b.mvps).toBe(0);
    expect(c.a.currentRun).toBe(2);
    expect(c.a.bestRun).toBe(2);
    expect(c.b.currentRun).toBe(0);
  });

  it('uses the most recent name a player went by', () => {
    const history = [
      night(['a'], ['b'], [], { black: 3, white: 1, blue: 0 }),
      { ...night(['a'], ['b'], [], { black: 3, white: 1, blue: 0 }),
        players: [
          { id: 'a', name: 'renamed', rating: 3 },
          { id: 'b', name: 'b', rating: 3 },
        ] },
    ];
    expect(comparePlayers(history, 'a', 'b')!.a.name).toBe('renamed');
  });
});
