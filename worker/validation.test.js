import { describe, expect, it } from 'vitest';
import {
  isValidClock,
  isValidSubscription,
  isValidFixtures,
  isValidLive,
  isValidPlayers,
  publicPlayer,
  safeEqual,
  staleVersion,
} from './roster-worker.js';
import { isLogStep } from './clock-notifier.js';

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

const match = (over = {}) => ({ a: 'black', b: 'white', winner: 'black', viaPenalties: false, ...over });

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

  // The log is what head-to-head and every other per-match statistic will be
  // counted from, so it has to survive the trip out to KV and back intact —
  // and it has to be refused rather than stored when it is nonsense.
  it('accepts a night carrying its match log', () => {
    expect(isValidFixtures([fixture({ matchLog: [match(), match({ winner: 'white' })] })])).toBe(
      true,
    );
  });

  it('accepts a night with no log — every night before the feature existed', () => {
    expect(isValidFixtures([fixture()])).toBe(true);
    expect(isValidFixtures([fixture({ matchLog: [] })])).toBe(true);
  });

  it('rejects a log whose winner was not on the pitch', () => {
    expect(isValidFixtures([fixture({ matchLog: [match({ winner: 'blue' })] })])).toBe(false);
  });

  it('rejects a match a team played against itself', () => {
    expect(isValidFixtures([fixture({ matchLog: [match({ b: 'black' })] })])).toBe(false);
  });

  it('rejects a shirt colour that is not one of the three', () => {
    expect(isValidFixtures([fixture({ matchLog: [match({ b: 'red' })] })])).toBe(false);
  });

  it('rejects a missing or non-boolean penalties flag', () => {
    expect(isValidFixtures([fixture({ matchLog: [match({ viaPenalties: undefined })] })])).toBe(
      false,
    );
    expect(isValidFixtures([fixture({ matchLog: [match({ viaPenalties: 'yes' })] })])).toBe(false);
  });

  it('rejects a log that is not an array, or is absurdly long', () => {
    expect(isValidFixtures([fixture({ matchLog: { a: 'black' } })])).toBe(false);
    expect(
      isValidFixtures([fixture({ matchLog: Array.from({ length: 101 }, () => match()) })]),
    ).toBe(false);
  });
});

describe('isValidLive', () => {
  const live = (over = {}) => ({
    id: 'live-1787156380422',
    startedAt: 1787156380422,
    players: [
      { id: 'p1', name: 'אופק', isGk: true },
      { id: 'p2', name: 'ירין', isGuest: true },
    ],
    teams: { black: ['p1'], white: ['p2'], blue: [] },
    gkIds: ['p1'],
    clock: { period: 'regulation', endsAt: null, remaining: 480000, ended: false },
    ...over,
  });

  it('accepts a fixture that has just kicked off', () => {
    expect(isValidLive(live())).toBe(true);
  });

  it('accepts a running clock, where endsAt is an absolute time', () => {
    expect(
      isValidLive(live({ clock: { period: 'added', endsAt: 1787156500000, remaining: 0, ended: false } })),
    ).toBe(true);
  });

  it('accepts null — that is how the night is ended', () => {
    expect(isValidLive(null)).toBe(true);
  });

  it('rejects a clock period that is not one of the two the rules have', () => {
    expect(
      isValidLive(live({ clock: { period: 'extra-time', endsAt: null, remaining: 0, ended: false } })),
    ).toBe(false);
  });

  it('rejects a clock missing its ended flag, rather than treating it as false', () => {
    expect(isValidLive(live({ clock: { period: 'regulation', endsAt: null, remaining: 0 } }))).toBe(
      false,
    );
  });

  it('rejects a non-numeric endsAt, which would render as NaN on every phone', () => {
    expect(
      isValidLive(live({ clock: { period: 'regulation', endsAt: 'soon', remaining: 0, ended: false } })),
    ).toBe(false);
  });

  it('rejects team entries that are not player ids', () => {
    expect(isValidLive(live({ teams: { black: [{ id: 'p1' }], white: [], blue: [] } }))).toBe(false);
  });

  it('rejects a missing team colour', () => {
    expect(isValidLive(live({ teams: { black: ['p1'], white: ['p2'] } }))).toBe(false);
  });

  it('rejects a player with no usable name', () => {
    expect(isValidLive(live({ players: [{ id: 'p1', name: '' }] }))).toBe(false);
    expect(isValidLive(live({ players: [{ id: 'p1', name: { first: 'x' } }] }))).toBe(false);
  });

  it('rejects a squad larger than any fixture', () => {
    const players = Array.from({ length: 61 }, (_, i) => ({ id: `p${i}`, name: `n${i}` }));
    expect(isValidLive(live({ players }))).toBe(false);
  });

  it('rejects a missing kickoff time', () => {
    expect(isValidLive(live({ startedAt: 'tonight' }))).toBe(false);
  });
});

// POST /live/clock is the one unauthenticated write in the Worker, so what it
// accepts is the whole of its attack surface.
describe('isValidClock', () => {
  const clock = (over = {}) => ({
    period: 'regulation',
    endsAt: null,
    remaining: 480000,
    ended: false,
    ...over,
  });

  it('accepts a stopped clock and a running one', () => {
    expect(isValidClock(clock())).toBe(true);
    expect(isValidClock(clock({ endsAt: 1787156500000, remaining: 0 }))).toBe(true);
  });

  it('accepts added time, the only other period the rules have', () => {
    expect(isValidClock(clock({ period: 'added', remaining: 120000 }))).toBe(true);
  });

  it('rejects an invented period', () => {
    expect(isValidClock(clock({ period: 'extra-time' }))).toBe(false);
    expect(isValidClock(clock({ period: null }))).toBe(false);
  });

  it('rejects an endsAt that would render as NaN on every phone at once', () => {
    expect(isValidClock(clock({ endsAt: 'soon' }))).toBe(false);
    expect(isValidClock(clock({ endsAt: NaN }))).toBe(false);
    expect(isValidClock(clock({ remaining: 'lots' }))).toBe(false);
  });

  it('rejects a missing ended flag rather than assuming false', () => {
    const { ended, ...rest } = clock();
    expect(isValidClock(rest)).toBe(false);
    expect(isValidClock(clock({ ended: 'yes' }))).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isValidClock(null)).toBe(false);
    expect(isValidClock('regulation')).toBe(false);
    expect(isValidClock([])).toBe(false);
  });

  it('ignores extra keys rather than letting them through as a payload', () => {
    // a hostile POST can't smuggle teams or a secret in alongside the clock —
    // the handler only ever copies the validated clock onto the stored fixture
    expect(isValidClock(clock({ teams: { black: ['x'] }, secret: 'guess' }))).toBe(true);
  });
});

describe('isValidSubscription', () => {
  const sub = (over = {}) => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    keys: { p256dh: 'BDgBTGA8idqXEkJjIO5TqUx5Xdo7kLtbB5Guj120hrfbJeOqNo7e', auth: 'MDEyMzQ1Njc4OWFiY2Rl' },
    ...over,
  });

  it('accepts what a browser actually hands over', () => {
    expect(isValidSubscription(sub())).toBe(true);
  });

  it('refuses a non-https endpoint', () => {
    // the worker POSTs to this URL; http would send the push in the clear, and
    // anything else is not a push service at all
    expect(isValidSubscription(sub({ endpoint: 'http://example.com/push' }))).toBe(false);
    expect(isValidSubscription(sub({ endpoint: 'file:///etc/passwd' }))).toBe(false);
  });

  it('refuses an endpoint that is not a URL', () => {
    expect(isValidSubscription(sub({ endpoint: 'not a url' }))).toBe(false);
    expect(isValidSubscription(sub({ endpoint: '' }))).toBe(false);
  });

  it('refuses missing or malformed keys', () => {
    expect(isValidSubscription(sub({ keys: undefined }))).toBe(false);
    expect(isValidSubscription(sub({ keys: { p256dh: 'x' } }))).toBe(false);
    expect(isValidSubscription(sub({ keys: { p256dh: 1, auth: 2 } }))).toBe(false);
  });

  it('refuses an endpoint long enough to be a payload rather than a URL', () => {
    expect(isValidSubscription(sub({ endpoint: `https://a.com/${'x'.repeat(1100)}` }))).toBe(false);
  });

  it('refuses non-objects', () => {
    expect(isValidSubscription(null)).toBe(false);
    expect(isValidSubscription('subscribe me')).toBe(false);
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

// The guard that makes a log anyone can write to safe. The endpoint takes a
// whole list, so without this a phone three seconds out of date appends to an
// old base and erases a match somebody else just recorded.
describe('isLogStep', () => {
  const m = (winner, over = {}) => ({ a: 'black', b: 'white', winner, viaPenalties: false, ...over });
  const one = [m('black')];
  const two = [m('black'), { a: 'black', b: 'blue', winner: 'blue', viaPenalties: false }];

  it('accepts a match being written down', () => {
    expect(isLogStep([], one)).toBe(true);
    expect(isLogStep(one, two)).toBe(true);
  });

  it('accepts a match being undone', () => {
    expect(isLogStep(two, one)).toBe(true);
    expect(isLogStep(one, [])).toBe(true);
  });

  it('accepts the identical list — a retry, or two people recording the same result', () => {
    expect(isLogStep(two, two)).toBe(true);
    expect(isLogStep([], [])).toBe(true);
  });

  it('refuses a stale device that would erase a match it never saw', () => {
    // it saw [], someone else recorded, and now it appends its own first match
    expect(isLogStep(one, [m('white')])).toBe(false);
  });

  it('refuses a rewrite of history that keeps the same length', () => {
    expect(isLogStep(one, [m('white')])).toBe(false);
    expect(isLogStep(two, [two[0], { ...two[1], winner: 'black' }])).toBe(false);
  });

  it('refuses more than one step at a time, in either direction', () => {
    expect(isLogStep([], two)).toBe(false);
    expect(isLogStep(two, [])).toBe(false);
  });

  it('refuses an append onto a base that differs earlier on', () => {
    expect(isLogStep(one, [m('white'), m('black')])).toBe(false);
  });

  it('counts the penalties flag as part of the match', () => {
    expect(isLogStep(one, [m('black', { viaPenalties: true })])).toBe(false);
  });
});
