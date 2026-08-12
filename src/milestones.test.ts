import { describe, expect, it } from 'vitest';
import { isMilestoneNight, tonightsMilestones } from './milestones';
import type { FixtureRecord, Player } from './types';

function player(id: string, name: string, extra: Partial<Player> = {}): Player {
  return { id, name, rating: 3, attack: 50, chemistry: [], ...extra };
}

// A night that `ids` played in. Only `players` matters for counting.
function fixture(id: string, ids: string[]): FixtureRecord {
  return {
    id,
    date: '2026-01-01',
    teams: { black: ids, white: [], blue: [] },
    players: ids.map((x) => ({ id: x, name: x, rating: 3 })),
    wins: { black: 1, white: 0, blue: 0 },
  };
}

const nights = (n: number, ids: string[]) =>
  Array.from({ length: n }, (_, i) => fixture(`f${i}`, ids));

describe('isMilestoneNight', () => {
  it('fires on 10, 25 and every 50 after', () => {
    expect([10, 25, 50, 100, 150, 200].every(isMilestoneNight)).toBe(true);
  });

  it('stays quiet on ordinary numbers', () => {
    expect([1, 9, 11, 24, 26, 49, 51, 75, 99].some(isMilestoneNight)).toBe(false);
  });
});

describe('tonightsMilestones', () => {
  it('calls a player with no history a debut, once there is history to be absent from', () => {
    const out = tonightsMilestones([player('a', 'דור')], nights(5, ['someone-else']));
    expect(out).toEqual([{ id: 'a', name: 'דור', kind: 'debut' }]);
  });

  it('counts tonight towards the total', () => {
    // 49 nights behind them → tonight is the 50th
    const out = tonightsMilestones([player('a', 'דור')], nights(49, ['a']));
    expect(out).toEqual([{ id: 'a', name: 'דור', kind: 'nth-night', nights: 50 }]);
  });

  it('says nothing on an ordinary night', () => {
    expect(tonightsMilestones([player('a', 'דור')], nights(5, ['a']))).toEqual([]);
  });

  it('ignores guests entirely — their ids are one-off, so every visit would look like a debut', () => {
    const out = tonightsMilestones([player('g', 'אורח', { isGuest: true })], nights(9, ['x']));
    expect(out).toEqual([]);
  });

  // Regression: on a fresh install every player is trivially absent from an
  // empty history, which tagged the whole squad as debutants.
  it('claims no debuts at all until the history is deep enough to mean something', () => {
    const squad = [player('a', 'דור'), player('b', 'עומרי')];
    expect(tonightsMilestones(squad, [])).toEqual([]);
    expect(tonightsMilestones(squad, nights(4, ['x']))).toEqual([]);
    expect(tonightsMilestones(squad, nights(5, ['x']))).toHaveLength(2);
  });

  it('collapses more than three first-timers into one line', () => {
    const squad = ['a', 'b', 'c', 'd'].map((id) => player(id, id.toUpperCase()));
    expect(tonightsMilestones(squad, nights(5, ['x']))).toEqual([
      { kind: 'debut-group', count: 4 },
    ]);
  });

  it('still names a real milestone alongside a collapsed debut group', () => {
    const squad = [
      player('vet', 'ותיק'),
      ...['a', 'b', 'c', 'd'].map((id) => player(id, id.toUpperCase())),
    ];
    const out = tonightsMilestones(squad, nights(24, ['vet']));
    expect(out).toEqual([
      { kind: 'nth-night', id: 'vet', name: 'ותיק', nights: 25 },
      { kind: 'debut-group', count: 4 },
    ]);
  });

  it('counts a fixture once even if a player somehow appears twice on the sheet', () => {
    const dupe = fixture('f', ['a']);
    dupe.players.push({ id: 'a', name: 'a', rating: 3 });
    // 9 clean nights + 1 duplicated one = 10 nights, so tonight is the 11th
    expect(tonightsMilestones([player('a', 'דור')], [...nights(9, ['a']), dupe])).toEqual([]);
  });

  it('only counts the nights a player was actually on the sheet', () => {
    const history = [...nights(9, ['a']), ...nights(40, ['b'])];
    // tonight is a's 10th, and only b's 41st
    const out = tonightsMilestones([player('a', 'דור'), player('b', 'עומרי')], history);
    expect(out).toEqual([{ id: 'a', name: 'דור', kind: 'nth-night', nights: 10 }]);
  });

  it('puts the bigger milestone first and debuts last', () => {
    const history = [...nights(24, ['a']), ...nights(49, ['b'])];
    const out = tonightsMilestones(
      [player('a', 'דור'), player('b', 'עומרי'), player('c', 'חדש')],
      history,
    );
    expect(out).toEqual([
      { kind: 'nth-night', id: 'b', name: 'עומרי', nights: 50 },
      { kind: 'nth-night', id: 'a', name: 'דור', nights: 25 },
      { kind: 'debut', id: 'c', name: 'חדש' },
    ]);
  });
});
