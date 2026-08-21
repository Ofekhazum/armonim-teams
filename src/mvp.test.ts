import { describe, expect, it } from 'vitest';
import { mvpCounts, preserveMvp } from './mvp';
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

describe('preserveMvp', () => {
  it('keeps a pick made in History when the night is filed again', () => {
    const filed = night('a', ['a', 'b']);
    // the fixture page rebuilds the record from the session, which has no MVP
    const resaved = { ...filed, mvpId: undefined, wins: { black: 4, white: 1, blue: 0 } };
    const merged = preserveMvp(filed, resaved);
    expect(merged.mvpId).toBe('a');
    // and the fields the fixture page *does* own still overwrite
    expect(merged.wins.black).toBe(4);
  });

  it('leaves a night that never had a pick without one', () => {
    const filed = night(undefined, ['a']);
    expect(preserveMvp(filed, { ...filed })).not.toHaveProperty('mvpId', 'a');
    expect(preserveMvp(filed, { ...filed }).mvpId).toBeUndefined();
  });

  it('does not invent a pick for a night being filed for the first time', () => {
    const fresh = night(undefined, ['a']);
    expect(preserveMvp(undefined, fresh).mvpId).toBeUndefined();
  });

  it('lets an incoming pick win, so History can correct one', () => {
    const filed = night('a', ['a', 'b']);
    expect(preserveMvp(filed, { ...filed, mvpId: 'b' }).mvpId).toBe('b');
  });
});
