import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClockNotifier } from './clock-notifier.js';

// Exercises the Durable Object itself — subscribing, the alarm chain, and what
// happens to a subscription a push service says is dead. The alarm is the part
// that cannot be checked by reading the code: it is the whole reason this runs
// on a server rather than in a page, and a mistake in it means silence.

const SENDER_JWK = {
  kty: 'EC',
  crv: 'P-256',
  d: 'u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s',
  x: 'dgoGyFjcF-XFNt6BH3EHv6JNT-451kr9kVjuuqs88ls',
  y: 'xO3PNMLAjRaw3NuIHYRwFLhAKusNb8UweMqU884c5M4',
  ext: true,
};

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function fakeState() {
  const map = new Map();
  let alarm = null;
  return {
    alarmAt: () => alarm,
    storage: {
      get: async (k) => map.get(k),
      put: async (k, v) => void map.set(k, v),
      delete: async (k) => void map.delete(k),
      setAlarm: async (t) => void (alarm = t),
      getAlarm: async () => alarm,
      deleteAlarm: async () => void (alarm = null),
    },
  };
}

const subscription = (n) => ({
  endpoint: `https://push.example.com/device-${n}`,
  keys: {
    p256dh:
      'BDgBTGA8idqXEkJjIO5TqUx5Xdo7kLtbB5Guj120hrfbJeOqNo7eN7llZvZlkPieoqyDS81hVBuQc4y8gpRwbJY',
    auth: 'MDEyMzQ1Njc4OWFiY2RlZg',
  },
});

const post = (notifier, path, body) =>
  notifier.fetch(
    new Request(`https://notifier${path}`, { method: 'POST', body: JSON.stringify(body) }),
  );

let sent;
let nextStatus;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sent = [];
  nextStatus = () => 201;
  vi.stubGlobal('fetch', async (url, init) => {
    sent.push({ url, headers: init.headers, body: init.body });
    return new Response(null, { status: nextStatus(url) });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function notifier() {
  const state = fakeState();
  return {
    state,
    obj: new ClockNotifier(state, {
      VAPID_JWK: JSON.stringify(SENDER_JWK),
      VAPID_SUBJECT: 'mailto:armonim@example.com',
    }),
  };
}

const running = (over = {}) => ({
  period: 'regulation',
  endsAt: NOW + 8 * MIN,
  remaining: 0,
  ended: false,
  ...over,
});

describe('subscriptions', () => {
  it('adds a device and keeps it', async () => {
    const { obj, state } = notifier();
    await post(obj, '/subscribe', { subscription: subscription(1) });
    expect(await state.storage.get('subs')).toHaveLength(1);
  });

  it('replaces rather than duplicates when the same device re-subscribes', async () => {
    // browsers hand out a fresh subscription object fairly often; without this
    // one phone would be buzzed once per time it ever opened the app
    const { obj, state } = notifier();
    await post(obj, '/subscribe', { subscription: subscription(1) });
    await post(obj, '/subscribe', { subscription: subscription(1) });
    expect(await state.storage.get('subs')).toHaveLength(1);
  });

  it('removes a device that opts out', async () => {
    const { obj, state } = notifier();
    await post(obj, '/subscribe', { subscription: subscription(1) });
    await post(obj, '/subscribe', { subscription: subscription(2) });
    await post(obj, '/unsubscribe', { endpoint: subscription(1).endpoint });
    const subs = await state.storage.get('subs');
    expect(subs.map((s) => s.endpoint)).toEqual([subscription(2).endpoint]);
  });
});

// Alerts are asked for one night at a time, and the server is what makes that
// true: a phone that was switched off when the night ended must not be able to
// be buzzed next week, whatever its own settings still say.
describe('a subscription lasts one fixture', () => {
  it('forgets everyone when the night ends', async () => {
    const { obj, state } = notifier();
    await post(obj, '/fixture', { id: 'live-1' });
    await post(obj, '/subscribe', { subscription: subscription(1) });
    await post(obj, '/subscribe', { subscription: subscription(2) });

    await post(obj, '/fixture', { id: null });
    expect(await state.storage.get('subs')).toBeUndefined();
  });

  it('forgets everyone when a different fixture starts', async () => {
    // the organiser who never pressed End fixture: the record expired on its
    // own and the next night is simply a new id
    const { obj, state } = notifier();
    await post(obj, '/fixture', { id: 'live-1' });
    await post(obj, '/subscribe', { subscription: subscription(1) });

    await post(obj, '/fixture', { id: 'live-2' });
    expect(await state.storage.get('subs')).toBeUndefined();
  });

  it('keeps them through the many writes of one night', async () => {
    // teams change, the MVP is picked, the result is entered — /live is written
    // repeatedly with the same id, and none of that is a new night
    const { obj, state } = notifier();
    await post(obj, '/fixture', { id: 'live-1' });
    await post(obj, '/subscribe', { subscription: subscription(1) });

    await post(obj, '/fixture', { id: 'live-1' });
    await post(obj, '/fixture', { id: 'live-1' });
    expect(await state.storage.get('subs')).toHaveLength(1);
  });

  it('does not buzz a squad that has been forgotten', async () => {
    const { obj } = notifier();
    await post(obj, '/fixture', { id: 'live-1' });
    await post(obj, '/subscribe', { subscription: subscription(1) });
    await post(obj, '/fixture', { id: null });

    await post(obj, '/schedule', { clock: running() });
    vi.setSystemTime(NOW + 7 * MIN);
    await obj.alarm();
    expect(sent).toHaveLength(0);
  });
});

// The live record moved out of KV and in here, because KV's reads are
// edge-cached and a clock paused a minute ago was being read as still running.
// What it buys is strong consistency, so these check the one property that
// matters — a read after a write sees the write — plus the 12-hour expiry that
// KV used to provide for free and now has to be enforced on read.
describe('the live fixture', () => {
  const fixture = (over = {}) => ({
    id: 'live-1',
    startedAt: NOW,
    players: [{ id: 'p1', name: 'Tester' }],
    teams: { black: ['p1'], white: [], blue: [] },
    gkIds: [],
    clock: running({ endsAt: null, remaining: 8 * MIN }),
    ...over,
  });
  const read = async (obj) => (await post(obj, '/live', {})).json();

  it('reads back exactly what was just written', async () => {
    const { obj } = notifier();
    await post(obj, '/live/put', { fixture: fixture() });
    expect((await read(obj)).fixture.id).toBe('live-1');
  });

  it('says nothing is live before a night starts', async () => {
    expect(await read(notifier().obj)).toEqual({ version: 0, fixture: null });
  });

  it('clears the night when handed null', async () => {
    const { obj } = notifier();
    await post(obj, '/live/put', { fixture: fixture() });
    await post(obj, '/live/put', { fixture: null });
    expect((await read(obj)).fixture).toBeNull();
  });

  it('replaces only the clock, leaving the teams alone', async () => {
    const { obj } = notifier();
    await post(obj, '/live/put', { fixture: fixture() });
    const paused = { period: 'regulation', endsAt: null, remaining: 90_000, ended: false };
    await post(obj, '/live/clock', { clock: paused });

    const after = (await read(obj)).fixture;
    expect(after.clock).toEqual(paused);
    expect(after.teams.black).toEqual(['p1']);
    expect(after.id).toBe('live-1');
  });

  it('refuses a clock when no fixture is live, rather than conjuring one', async () => {
    // the whole reason this endpoint can be left unauthenticated
    const res = await post(notifier().obj, '/live/clock', { clock: running() });
    expect(res.status).toBe(404);
  });

  it('stops reading as live twelve hours on', async () => {
    // KV expired the key; a Durable Object has no TTL, so an organiser who
    // closed the tab mid-night must not leave a fixture live until someone
    // notices it the next morning
    const { obj } = notifier();
    await post(obj, '/live/put', { fixture: fixture() });
    vi.setSystemTime(NOW + 13 * 60 * MIN);
    expect((await read(obj)).fixture).toBeNull();
  });

  describe('scheduled ahead of kickoff (§2.7.2)', () => {
    const DAY = 24 * 60 * 60 * MIN;

    it('reads back a fixture whose kickoff is still days away', async () => {
      const { obj } = notifier();
      await post(obj, '/live/put', { fixture: fixture({ startedAt: NOW + 3 * DAY }) });
      expect((await read(obj)).fixture.startedAt).toBe(NOW + 3 * DAY);
    });

    it('expires twelve hours after kickoff, not twelve hours after scheduling', async () => {
      const { obj } = notifier();
      await post(obj, '/live/put', { fixture: fixture({ startedAt: NOW + 3 * DAY }) });

      vi.setSystemTime(NOW + 3 * DAY + 11 * 60 * MIN);
      expect((await read(obj)).fixture).not.toBeNull();

      vi.setSystemTime(NOW + 3 * DAY + 13 * 60 * MIN);
      expect((await read(obj)).fixture).toBeNull();
    });

    it('arms no announcements before kickoff', async () => {
      // the clock hasn't started — schedule() is driven by clock.endsAt, which
      // a freshly-scheduled fixture doesn't have, regardless of how far off
      // startedAt is
      const { obj, state } = notifier();
      await post(obj, '/live/put', { fixture: fixture({ startedAt: NOW + 3 * DAY }) });
      expect(state.alarmAt()).toBeNull();
    });
  });

  it('arms the announcements from the same call that stores the clock', async () => {
    // they used to be two best-effort trips, which could half-happen
    const { obj, state } = notifier();
    await post(obj, '/live/put', { fixture: fixture() });
    expect(state.alarmAt()).toBeNull(); // clock not started yet

    await post(obj, '/live/clock', { clock: running() });
    expect(state.alarmAt()).toBe(NOW + 7 * MIN);
  });

  it('drops the subscriptions when a different night starts', async () => {
    const { obj, state } = notifier();
    await post(obj, '/live/put', { fixture: fixture() });
    await post(obj, '/subscribe', { subscription: subscription(1) });
    await post(obj, '/live/put', { fixture: fixture({ id: 'live-2' }) });
    expect(await state.storage.get('subs')).toBeUndefined();
  });

  it('keeps them through the many writes of one night', async () => {
    const { obj, state } = notifier();
    await post(obj, '/live/put', { fixture: fixture() });
    await post(obj, '/subscribe', { subscription: subscription(1) });
    await post(obj, '/live/put', { fixture: fixture({ gkIds: ['p1'] }) });
    await post(obj, '/live/clock', { clock: running() });
    expect(await state.storage.get('subs')).toHaveLength(1);
  });

  // Writing down a match is a read-then-write that depends on what was read.
  // Done across KV it was a race with a stale read in the middle, which
  // rejected matches people really had logged; here the object is the lock.
  describe('the match log', () => {
    const first = { a: 'black', b: 'white', winner: 'black', viaPenalties: false };
    const second = { a: 'black', b: 'blue', winner: 'blue', viaPenalties: true };
    const log = async (obj, matchLog) => post(obj, '/live/log', { matchLog });

    it('stores a match and reads it straight back', async () => {
      const { obj } = notifier();
      await post(obj, '/live/put', { fixture: fixture() });
      const res = await log(obj, [first]);
      expect(res.status).toBe(200);
      expect((await read(obj)).fixture.matchLog).toEqual([first]);
    });

    it('accepts a second match, and an undo of it', async () => {
      const { obj } = notifier();
      await post(obj, '/live/put', { fixture: fixture() });
      await log(obj, [first]);
      expect((await log(obj, [first, second])).status).toBe(200);
      expect((await log(obj, [first])).status).toBe(200);
      expect((await read(obj)).fixture.matchLog).toEqual([first]);
    });

    it('accepts the same match twice — two people recording one result', async () => {
      const { obj } = notifier();
      await post(obj, '/live/put', { fixture: fixture() });
      await log(obj, [first]);
      expect((await log(obj, [first])).status).toBe(200);
      // and it stays one match, rather than becoming two
      expect((await read(obj)).fixture.matchLog).toEqual([first]);
    });

    it('refuses a stale phone, and hands back the real log', async () => {
      const { obj } = notifier();
      await post(obj, '/live/put', { fixture: fixture() });
      await log(obj, [first]);
      // this device still thinks nothing has been played, and records its own
      const res = await log(obj, [{ ...first, winner: 'white' }]);
      expect(res.status).toBe(409);
      expect((await res.json()).matchLog).toEqual([first]);
      expect((await read(obj)).fixture.matchLog).toEqual([first]);
    });

    it('leaves the teams and the clock alone', async () => {
      const { obj } = notifier();
      await post(obj, '/live/put', { fixture: fixture() });
      const paused = { period: 'regulation', endsAt: null, remaining: 90_000, ended: false };
      await post(obj, '/live/clock', { clock: paused });
      await log(obj, [first]);

      const after = (await read(obj)).fixture;
      expect(after.clock).toEqual(paused);
      expect(after.teams.black).toEqual(['p1']);
    });

    it('refuses a log when no fixture is live, rather than conjuring one', async () => {
      expect((await log(notifier().obj, [first])).status).toBe(404);
    });
  });
});

describe('scheduling', () => {
  it('arms the alarm for the one-minute warning first', async () => {
    const { obj, state } = notifier();
    await post(obj, '/schedule', { clock: running() });
    expect(state.alarmAt()).toBe(NOW + 7 * MIN);
  });

  it('clears the alarm when the clock is paused', async () => {
    const { obj, state } = notifier();
    await post(obj, '/schedule', { clock: running() });
    await post(obj, '/schedule', { clock: running({ endsAt: null }) });
    expect(state.alarmAt()).toBeNull();
  });

  it('clears the alarm when the night ends', async () => {
    const { obj, state } = notifier();
    await post(obj, '/schedule', { clock: running() });
    await post(obj, '/schedule', { clock: null });
    expect(state.alarmAt()).toBeNull();
  });
});

describe('the alarm chain', () => {
  it('announces one minute left, then re-arms itself for the whistle', async () => {
    const { obj, state } = notifier();
    await post(obj, '/subscribe', { subscription: subscription(1) });
    await post(obj, '/schedule', { clock: running() });

    vi.setSystemTime(NOW + 7 * MIN);
    await obj.alarm();

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(subscription(1).endpoint);
    // a DO holds one alarm at a time, so the second trigger has to be armed by
    // the first one firing — miss this and full time is never announced
    expect(state.alarmAt()).toBe(NOW + 8 * MIN);

    vi.setSystemTime(NOW + 8 * MIN);
    await obj.alarm();
    expect(sent).toHaveLength(2);
    expect(state.alarmAt()).toBe(NOW + 8 * MIN); // nothing further to arm
    expect(await state.storage.get('pending')).toEqual([]);
  });

  it('sends to every subscribed device', async () => {
    const { obj } = notifier();
    for (const n of [1, 2, 3]) await post(obj, '/subscribe', { subscription: subscription(n) });
    await post(obj, '/schedule', { clock: running() });
    vi.setSystemTime(NOW + 7 * MIN);
    await obj.alarm();
    expect(sent.map((s) => s.url).sort()).toEqual([1, 2, 3].map((n) => subscription(n).endpoint));
  });

  it('sends a VAPID-authenticated, encrypted push', async () => {
    const { obj } = notifier();
    await post(obj, '/subscribe', { subscription: subscription(1) });
    await post(obj, '/schedule', { clock: running() });
    vi.setSystemTime(NOW + 7 * MIN);
    await obj.alarm();

    expect(sent[0].headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(sent[0].headers['Content-Encoding']).toBe('aes128gcm');
    // worthless after the match — must not linger in a push queue
    expect(sent[0].headers.TTL).toBe('120');
    expect(sent[0].body.byteLength).toBeGreaterThan(86);
  });

  it('fires both triggers at once if the alarm wakes up late', async () => {
    // a Durable Object alarm is not a hard realtime guarantee; waking after
    // both moments must not strand either in the pending list forever
    const { obj, state } = notifier();
    await post(obj, '/subscribe', { subscription: subscription(1) });
    await post(obj, '/schedule', { clock: running() });
    vi.setSystemTime(NOW + 9 * MIN);
    await obj.alarm();
    expect(sent).toHaveLength(2);
    expect(await state.storage.get('pending')).toEqual([]);
  });

  it('says nothing at all when nobody has opted in', async () => {
    const { obj } = notifier();
    await post(obj, '/schedule', { clock: running() });
    vi.setSystemTime(NOW + 7 * MIN);
    await obj.alarm();
    expect(sent).toHaveLength(0);
  });

  it('stays quiet on a deployment with no VAPID key configured', async () => {
    const state = fakeState();
    const obj = new ClockNotifier(state, {});
    await post(obj, '/subscribe', { subscription: subscription(1) });
    await post(obj, '/schedule', { clock: running() });
    vi.setSystemTime(NOW + 7 * MIN);
    await obj.alarm();
    expect(sent).toHaveLength(0);
  });
});

// The feature's whole failure mode is silence, so the thing that explains the
// silence has to be trustworthy — including the part where it refuses to buzz
// fourteen other people to answer a question about the phone in your hand.
describe('the test report', () => {
  const report = (res) => res.json();

  it('buzzes only the device that asked', async () => {
    const { obj } = notifier();
    for (const n of [1, 2, 3]) await post(obj, '/subscribe', { subscription: subscription(n) });
    const res = await report(await post(obj, '/test', { endpoint: subscription(2).endpoint }));
    expect(sent.map((s) => s.url)).toEqual([subscription(2).endpoint]);
    expect(res).toMatchObject({ subscribers: 3, known: true, configured: true });
    expect(res.sent).toEqual([{ host: 'push.example.com', status: 201, detail: '' }]);
  });

  it('buzzes nobody at all when the asking device never subscribed', async () => {
    // the common case of "why don't I get these" — answering it must not set
    // off every other phone at the pitch
    const { obj } = notifier();
    await post(obj, '/subscribe', { subscription: subscription(1) });
    const res = await report(await post(obj, '/test', { endpoint: null }));
    expect(sent).toHaveLength(0);
    expect(res.known).toBe(false);
    expect(res.sent).toEqual([]);
  });

  it('reports what the push service said when it refuses', async () => {
    const { obj } = notifier();
    await post(obj, '/subscribe', { subscription: subscription(1) });
    nextStatus = () => 403;
    const res = await report(await post(obj, '/test', { endpoint: subscription(1).endpoint }));
    expect(res.sent[0].status).toBe(403);
  });

  it('shows what is still due, so a silent match can be told from a silent phone', async () => {
    const { obj } = notifier();
    await post(obj, '/schedule', { clock: running() });
    const res = await report(await post(obj, '/test', {}));
    expect(res.pending.map((t) => t.kind)).toEqual(['one-minute', 'time-up']);
    expect(res.alarmAt).toBe(NOW + 7 * MIN);
  });

  it('says so plainly on a deployment with no key', async () => {
    const obj = new ClockNotifier(fakeState(), {});
    expect((await report(await post(obj, '/test', {}))).configured).toBe(false);
  });
});

describe('pruning dead subscriptions', () => {
  it('drops a device the push service reports as gone', async () => {
    const { obj, state } = notifier();
    await post(obj, '/subscribe', { subscription: subscription(1) });
    await post(obj, '/subscribe', { subscription: subscription(2) });
    await post(obj, '/schedule', { clock: running() });

    nextStatus = (url) => (url === subscription(1).endpoint ? 410 : 201);
    vi.setSystemTime(NOW + 7 * MIN);
    await obj.alarm();

    const subs = await state.storage.get('subs');
    expect(subs.map((s) => s.endpoint)).toEqual([subscription(2).endpoint]);
  });

  it('keeps a device whose push service merely had a bad day', async () => {
    // pruning on a 500 would quietly unsubscribe real people over an outage
    const { obj, state } = notifier();
    await post(obj, '/subscribe', { subscription: subscription(1) });
    await post(obj, '/schedule', { clock: running() });

    nextStatus = () => 500;
    vi.setSystemTime(NOW + 7 * MIN);
    await obj.alarm();

    expect(await state.storage.get('subs')).toHaveLength(1);
  });
});
