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
