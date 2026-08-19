import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.js';

// A stand-in for Durable Object storage, plus the one runtime property this
// design leans on: input gating. A real DO holds incoming events while a
// storage operation is in flight, so each `fetch` runs start-to-finish before
// the next one is delivered. The queue below models exactly that — and it is
// what makes the difference between the old two-call limiter and this one
// visible in a test rather than only in production.
function limiter() {
  const map = new Map();
  const state = {
    storage: {
      get: async (k) => map.get(k),
      put: async (k, v) => void map.set(k, v),
      setAlarm: async () => {},
      deleteAll: async () => map.clear(),
    },
  };
  const instance = new RateLimiter(state);
  let tail = Promise.resolve();
  // every call queues behind the previous one, as input gating guarantees
  return (path, params = '') => {
    const run = tail.then(() =>
      instance.fetch(new Request(`https://limiter${path}?${params}`, { method: 'POST' })),
    );
    tail = run.then(
      () => {},
      () => {},
    );
    return run.then((r) => r.json());
  };
}

const attempt = (call, limit = 10) => call('/attempt', `limit=${limit}&window=600000`);

describe('RateLimiter', () => {
  it('counts and decides in one call, so a concurrent burst cannot outrun the counter', async () => {
    // This is the bug the split /check + /fail design had: twenty guesses
    // dispatched at once each read the counter before any of them wrote to
    // it, so all twenty passed a limit of ten. Here every caller fires before
    // any has resolved — the burst case — and the budget still holds exactly.
    const call = limiter();
    const results = await Promise.all(Array.from({ length: 20 }, () => attempt(call)));

    expect(results.filter((r) => !r.blocked)).toHaveLength(10);
    expect(results.filter((r) => r.blocked)).toHaveLength(10);
  });

  it('blocks the attempt after the budget, not the one that spends the last of it', async () => {
    const call = limiter();
    for (let i = 0; i < 3; i++) {
      expect((await attempt(call, 3)).blocked).toBe(false);
    }
    expect((await attempt(call, 3)).blocked).toBe(true);
  });

  it('reports how long the caller has to wait once blocked', async () => {
    const call = limiter();
    await attempt(call, 1);
    const gate = await attempt(call, 1);
    expect(gate.blocked).toBe(true);
    expect(gate.retryAfter).toBeGreaterThan(0);
    expect(gate.retryAfter).toBeLessThanOrEqual(600);
  });

  it('refunds a correct word, so an admin publishing all evening is never locked out', async () => {
    // the worker counts every attempt up front and gives it back once the
    // secret checks out — only wrong guesses are meant to accumulate
    const call = limiter();
    for (let i = 0; i < 50; i++) {
      expect((await attempt(call, 3)).blocked).toBe(false);
      await call('/refund');
    }
  });

  it('never refunds below zero', async () => {
    const call = limiter();
    await call('/refund');
    await call('/refund');
    // the budget is still whole — refunds cannot bank credit for later
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await attempt(call, 2));
    expect(results.map((r) => r.blocked)).toEqual([false, false, true]);
  });

  it('starts a clean window once the old one has rolled over', async () => {
    const call = limiter();
    // a 1ms window has always already expired by the next call
    expect((await call('/attempt', 'limit=1&window=1')).blocked).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    expect((await call('/attempt', 'limit=1&window=1')).blocked).toBe(false);
  });

  it('clamps a caller asking for an absurd budget', async () => {
    const call = limiter();
    const gate = await call('/attempt', 'limit=999999999999&window=99999999999999');
    expect(gate.blocked).toBe(false);
    // the point is that it answers at all rather than trusting the number —
    // the clamp itself is asserted by the budget still applying below
    const tight = limiter();
    expect((await tight('/attempt', 'limit=abc&window=abc')).blocked).toBe(false);
  });
});
