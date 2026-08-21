import { describe, expect, it } from 'vitest';
import { mvpCandidates, mvpCounts, preserveMvp, winningTeams } from './mvp';
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

describe('winningTeams', () => {
  it('names the one team that topped the night', () => {
    expect(winningTeams({ black: 3, white: 1, blue: 0 })).toEqual(['black']);
  });

  it('names both teams level at the top', () => {
    expect(winningTeams({ black: 4, white: 4, blue: 2 })).toEqual(['black', 'white']);
  });

  it('names all three when nothing separates them', () => {
    expect(winningTeams({ black: 2, white: 2, blue: 2 })).toEqual(['black', 'white', 'blue']);
    // a night with no tally entered yet is level at zero, not a black win
    expect(winningTeams({ black: null, white: null, blue: null })).toEqual([
      'black',
      'white',
      'blue',
    ]);
  });

  it('counts a half-win as the win it is', () => {
    expect(winningTeams({ black: 3, white: 3.5, blue: 1 })).toEqual(['white']);
  });
});

describe('mvpCandidates', () => {
  const played = (): FixtureRecord => ({
    id: 'fx',
    date: '2026-08-21',
    teams: { black: ['b1', 'b2'], white: ['w1'], blue: ['u1'] },
    players: [
      { id: 'b1', name: 'ירין', rating: 4 },
      { id: 'b2', name: 'ניב', rating: 3 },
      { id: 'w1', name: 'טום', rating: 4 },
      { id: 'u1', name: 'דור', rating: 5 },
    ],
    wins: { black: 5, white: 2, blue: 1 },
  });

  const ids = (fx: FixtureRecord, wins?: FixtureRecord['wins']) =>
    mvpCandidates(fx, wins).map((p) => p.id);

  it('offers only the winning team', () => {
    expect(ids(played())).toEqual(['b1', 'b2']);
  });

  it('offers both teams when the night is level at the top', () => {
    expect(ids(played(), { black: 4, white: 4, blue: 1 })).toEqual(['b1', 'b2', 'w1']);
  });

  it('offers everyone when all three finish level', () => {
    expect(ids(played(), { black: 3, white: 3, blue: 3 })).toEqual(['b1', 'b2', 'w1', 'u1']);
  });

  it('keeps a pick already on file even after a correction makes their team lose', () => {
    // otherwise the dropdown's value matches no option, shows blank, and the
    // next save silently clears a real pick
    const fx = { ...played(), mvpId: 'u1' };
    expect(ids(fx)).toEqual(['b1', 'b2', 'u1']);
  });

  it('returns the players in roster order, not team order', () => {
    const fx = played();
    expect(mvpCandidates(fx, { black: 1, white: 1, blue: 1 })).toEqual(fx.players);
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
