import { describe, expect, it } from 'vitest';
import {
  isValidFixtures,
  isValidPlayers,
  publicPlayer,
  safeEqual,
  staleVersion,
} from './roster-worker.js';

const player = (over = {}) => ({ id: 'p1', name: 'אופק', rating: 4, attack: 50, ...over });

const fixture = (over = {}) => ({
  id: 'f1',
  date: '2026-08-06',
  teams: { black: ['p1'], white: ['p2'], blue: [] },
  players: [
    { id: 'p1', name: 'אופק', rating: 4 },
    { id: 'p2', name: 'ירין', rating: 5 },
  ],
  wins: { black: 3, white: 1, blue: 0 },
  ...over,
});

describe('publicPlayer', () => {
  it('strips the fields that are statements about people, keeps the football ones', () => {
    const clean = publicPlayer(
      player({ avoid: ['p2'], chemistry: ['p3'], aliases: ['חזום'], isGk: true, number: 55 }),
    );
    expect(clean).toEqual({
      id: 'p1',
      name: 'אופק',
      rating: 4,
      attack: 50,
      isGk: true,
      number: 55,
    });
  });

  it('leaves a player who has no private fields untouched', () => {
    expect(publicPlayer(player())).toEqual(player());
  });

  it('does not mutate the stored player it was handed', () => {
    const stored = player({ avoid: ['p2'] });
    publicPlayer(stored);
    expect(stored.avoid).toEqual(['p2']);
  });
});

describe('isValidPlayers', () => {
  it('accepts an ordinary roster', () => {
    expect(isValidPlayers([player(), player({ id: 'p2', name: 'ירין', aliases: ['חזום'] })])).toBe(
      true,
    );
  });

  it('rejects a name that is an object — truthy, but not a name', () => {
    // the old check was `p?.id && p?.name`, which this passes. React throws on
    // an object child, so publishing it whitescreened every device in the club.
    expect(isValidPlayers([player({ name: { toString: 'gotcha' } })])).toBe(false);
  });

  it('rejects a name long enough to bloat the copy everyone downloads', () => {
    expect(isValidPlayers([player({ name: 'x'.repeat(61) })])).toBe(false);
  });

  it('rejects an id that is a number rather than a string', () => {
    expect(isValidPlayers([player({ id: 12 })])).toBe(false);
  });

  it('rejects a rating that is a string', () => {
    expect(isValidPlayers([player({ rating: '4' })])).toBe(false);
  });

  it('rejects chemistry/avoid entries that are not ids', () => {
    expect(isValidPlayers([player({ avoid: [{ id: 'p2' }] })])).toBe(false);
    expect(isValidPlayers([player({ chemistry: [null] })])).toBe(false);
  });

  it('rejects more players than any roster could hold', () => {
    expect(isValidPlayers(Array.from({ length: 201 }, (_, i) => player({ id: `p${i}` })))).toBe(
      false,
    );
  });

  it('rejects a non-array', () => {
    expect(isValidPlayers(null)).toBe(false);
    expect(isValidPlayers({ 0: player() })).toBe(false);
  });

  it('accepts an empty roster — that is a clear, not a corruption', () => {
    expect(isValidPlayers([])).toBe(true);
  });
});

describe('isValidFixtures', () => {
  it('accepts an ordinary night, with or without an MVP', () => {
    expect(isValidFixtures([fixture()])).toBe(true);
    expect(isValidFixtures([fixture({ mvpId: 'p1' })])).toBe(true);
  });

  it('rejects team entries that are not ids', () => {
    // the old check only counted them: `Array.isArray(t) && t.length <= 60`
    expect(
      isValidFixtures([fixture({ teams: { black: [{ id: 'p1' }], white: [], blue: [] } })]),
    ).toBe(false);
  });

  it('rejects an mvpId that is not a string', () => {
    expect(isValidFixtures([fixture({ mvpId: 7 })])).toBe(false);
  });

  it('rejects a fixture player with a non-string name', () => {
    expect(
      isValidFixtures([fixture({ players: [{ id: 'p1', name: ['אופק'], rating: 4 }] })]),
    ).toBe(false);
  });

  it('rejects a missing win tally, and a non-numeric one', () => {
    expect(isValidFixtures([fixture({ wins: { black: 3, white: 1 } })])).toBe(false);
    expect(isValidFixtures([fixture({ wins: { black: '3', white: 1, blue: 0 } })])).toBe(false);
  });

  it('accepts half-win tallies — a shootout is worth half, by house rule', () => {
    expect(isValidFixtures([fixture({ wins: { black: 4.5, white: 5, blue: 2 } })])).toBe(true);
  });

  it('accepts an empty history — that is how the season is cleared', () => {
    expect(isValidFixtures([])).toBe(true);
  });
});

describe('staleVersion', () => {
  const current = { value: { version: 1787151556621, fixtures: [] } };

  it('lets a publish through when it is replacing the version it actually read', () => {
    expect(staleVersion({ baseVersion: 1787151556621 }, current)).toBeNull();
  });

  it('turns away a device publishing over a version it never saw', () => {
    // the exact shape of the incident this guards: a device holding version 0
    // (fresh, or seeded with test data) replacing a live season
    expect(staleVersion({ baseVersion: 0 }, current)).toBe(1787151556621);
  });

  it('treats an empty store as version 0', () => {
    expect(staleVersion({ baseVersion: 0 }, null)).toBeNull();
    expect(staleVersion({ baseVersion: 5 }, null)).toBe(0);
  });

  it('stays out of the way of a client too old to send a base version', () => {
    expect(staleVersion({}, current)).toBeNull();
    expect(staleVersion({ baseVersion: 'nope' }, current)).toBeNull();
  });
});

describe('safeEqual', () => {
  it('matches an identical word and nothing else', () => {
    expect(safeEqual('update_roster', 'update_roster')).toBe(true);
    expect(safeEqual('update_rostet', 'update_roster')).toBe(false);
    expect(safeEqual('update_roste', 'update_roster')).toBe(false);
  });

  it('refuses non-strings rather than coercing them', () => {
    expect(safeEqual(undefined, 'x')).toBe(false);
    expect(safeEqual({}, 'x')).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
  });
});
