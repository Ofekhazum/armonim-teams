import { describe, expect, it } from 'vitest';
import { mvpCounts } from './mvp';
import type { FixtureRecord } from './types';

let seq = 0;

function night(mvpId: string | undefined, ids: string[]): FixtureRecord {
  const fx: FixtureRecord = {
    id: `f${seq}`,
    date: new Date(Date.UTC(2026, 0, 1 + seq)).toISOString().slice(0, 10),
    teams: { black: ids, white: [], blue: [] },
    players: ids.map((id) => ({ id, name: id, rating: 3 })),
    wins: { black: 3, white: 1, blue: 0 },
    mvpId,
  };
  seq++;
  return fx;
}

describe('mvpCounts', () => {
  it('counts how many nights each player was picked, ranked most first', () => {
    const history = [
      night('a', ['a', 'b']),
      night('a', ['a', 'b']),
      night('b', ['a', 'b']),
    ];
    expect(mvpCounts(history)).toEqual([
      { id: 'a', name: 'a', count: 2 },
      { id: 'b', name: 'b', count: 1 },
    ]);
  });

  it('ignores nights with no MVP recorded', () => {
    const history = [night(undefined, ['a']), night(undefined, ['a'])];
    expect(mvpCounts(history)).toEqual([]);
  });

  it('does not crash on a malformed record whose mvpId is not in players', () => {
    const bad = night('ghost', ['a']);
    expect(mvpCounts([bad])).toEqual([]);
  });

  it('returns an empty list for no history', () => {
    expect(mvpCounts([])).toEqual([]);
  });
});
