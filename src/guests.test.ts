import { describe, expect, it } from 'vitest';
import type { FixtureRecord } from './types';
import { guestIdentities, guestKey, knownGuests, mergeGuestIdentities } from './guests';

// A guest is created with a fresh id on the night they turn up, because at
// that moment there is nothing to match them against. Across a season that
// makes one person look like three, which is what this undoes — carefully,
// because welding two genuinely different people together is a far worse
// failure than leaving a duplicate row on screen.

let seq = 0;

const night = (
  black: string[],
  white: string[],
  names: Record<string, string>,
  over: Partial<FixtureRecord> = {},
): FixtureRecord => {
  seq++;
  return {
    id: `f${seq}`,
    date: `2026-04-${String(seq).padStart(2, '0')}`,
    teams: { black, white, blue: [] },
    players: [...black, ...white].map((id) => ({ id, name: names[id] ?? id, rating: 3 })),
    wins: { black: 3, white: 1, blue: 0 },
    ...over,
  };
};

const roster = (...ids: string[]) => new Set(ids);

describe('guestKey', () => {
  it('ignores the ways one name gets typed differently', () => {
    expect(guestKey('  זרקא ')).toBe(guestKey('זרקא'));
    expect(guestKey('Yarin  Cohen')).toBe(guestKey('yarin cohen'));
  });

  it('is empty for a blank name, which can never be a key', () => {
    expect(guestKey('   ')).toBe('');
  });
});

describe('guestIdentities', () => {
  it('points a returning guest at the id from their first night', () => {
    const history = [
      night(['g1'], ['r1'], { g1: 'זרקא', r1: 'ניב' }),
      night(['g2'], ['r1'], { g2: 'זרקא', r1: 'ניב' }),
    ];
    const map = guestIdentities(history, roster('r1'));
    expect(map.get('g2')).toBe('g1');
    expect(map.has('g1')).toBe(false);
  });

  it('takes the earliest night, not the order records were filed in', () => {
    const later = night(['g2'], ['r1'], { g2: 'זרקא', r1: 'ניב' });
    const earlier = { ...night(['g1'], ['r1'], { g1: 'זרקא', r1: 'ניב' }), date: '2025-01-01' };
    // filed the other way round on purpose
    const map = guestIdentities([later, earlier], roster('r1'));
    expect(map.get('g2')).toBe('g1');
  });

  it('never merges two roster players who share a name', () => {
    // the whole reason roster ids are excluded: two squad members called ניב
    // are two people, and the roster is where that is already settled
    const history = [
      night(['r1'], ['r2'], { r1: 'ניב', r2: 'ניב' }),
      night(['r1'], ['r2'], { r1: 'ניב', r2: 'ניב' }),
    ];
    expect(guestIdentities(history, roster('r1', 'r2')).size).toBe(0);
  });

  it('leaves a guest who has only ever played once alone', () => {
    const history = [night(['g1'], ['r1'], { g1: 'זרקא', r1: 'ניב' })];
    expect(guestIdentities(history, roster('r1')).size).toBe(0);
  });

  it('keeps two differently-named guests apart', () => {
    const history = [
      night(['g1'], ['r1'], { g1: 'זרקא', r1: 'ניב' }),
      night(['g2'], ['r1'], { g2: 'ארטיום', r1: 'ניב' }),
    ];
    expect(guestIdentities(history, roster('r1')).size).toBe(0);
  });
});

describe('mergeGuestIdentities', () => {
  it('rewrites the team sheets so the guest is one person across nights', () => {
    const history = [
      night(['g1'], ['r1'], { g1: 'זרקא', r1: 'ניב' }),
      night(['g2'], ['r1'], { g2: 'זרקא', r1: 'ניב' }),
    ];
    const merged = mergeGuestIdentities(history, roster('r1'));
    expect(merged[1].teams.black).toEqual(['g1']);
    expect(merged[1].players.map((p) => p.id)).toEqual(['g1', 'r1']);
    // and the name they played that night under is kept
    expect(merged[1].players[0].name).toBe('זרקא');
  });

  it('follows the MVP pick to the merged id', () => {
    const history = [
      night(['g1'], ['r1'], { g1: 'זרקא', r1: 'ניב' }),
      night(['g2'], ['r1'], { g2: 'זרקא', r1: 'ניב' }, { mvpId: 'g2' }),
    ];
    expect(mergeGuestIdentities(history, roster('r1'))[1].mvpId).toBe('g1');
  });

  it('never lists the same person twice on one night', () => {
    // both ids on one sheet is malformed, but it is exactly what a merge can
    // create, and a duplicate would double-count that night
    const odd = night(['g1', 'g2'], ['r1'], { g1: 'זרקא', g2: 'זרקא', r1: 'ניב' });
    const merged = mergeGuestIdentities([odd], roster('r1'));
    expect(merged[0].teams.black).toEqual(['g1', 'g1']);
    expect(merged[0].players.filter((p) => p.id === 'g1')).toHaveLength(1);
  });

  it('hands back the very same array when nothing needs merging', () => {
    // this runs on every render of everything that reads history
    const history = [night(['r1'], ['r2'], { r1: 'ניב', r2: 'ירין' })];
    expect(mergeGuestIdentities(history, roster('r1', 'r2'))).toBe(history);
  });

  it('leaves the records it was given untouched', () => {
    const history = [
      night(['g1'], ['r1'], { g1: 'זרקא', r1: 'ניב' }),
      night(['g2'], ['r1'], { g2: 'זרקא', r1: 'ניב' }),
    ];
    mergeGuestIdentities(history, roster('r1'));
    expect(history[1].teams.black).toEqual(['g2']);
  });
});

describe('knownGuests', () => {
  it('lists each returning guest once, under the id they will be counted as', () => {
    const history = [
      night(['g1'], ['r1'], { g1: 'זרקא', r1: 'ניב' }),
      night(['g2'], ['r1'], { g2: 'זרקא', r1: 'ניב' }),
      night(['g3'], ['r1'], { g3: 'ארטיום', r1: 'ניב' }),
    ];
    const guests = knownGuests(history, roster('r1'));
    expect(guests.map((g) => g.name).sort()).toEqual(['ארטיום', 'זרקא']);
  });

  it('does not offer roster players as guests', () => {
    const history = [night(['r1'], ['r2'], { r1: 'ניב', r2: 'ירין' })];
    expect(knownGuests(history, roster('r1', 'r2'))).toEqual([]);
  });
});
