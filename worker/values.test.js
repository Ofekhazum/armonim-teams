import { describe, expect, it } from 'vitest';
import worker from './roster-worker.js';

// `GET /values` (§2.31) — the one public endpoint that reads ratings.
//
// The formula has its own tests in `src/marketValue.test.ts`. What is tested
// here is the wire: that a price goes out and nothing else does, that the
// endpoint needs no password, and that a missing store is an empty answer
// rather than a five hundred.

const SQUAD = ['a', 'b', 'c', 'd', 'e', 'f'];

const player = (id, rating) => ({
  id,
  name: id,
  rating,
  attack: 50,
  chemistry: [],
  avoid: [id === 'a' ? 'f' : 'a'],
  aliases: [id.toUpperCase()],
});

const night = (date) => ({
  id: date,
  date,
  teams: { black: ['a', 'b'], white: ['c', 'd'], blue: ['e', 'f'] },
  players: SQUAD.map((id) => ({ id, name: id, rating: 3 })),
  wins: { black: 4, white: 2, blue: 1 },
});

const season = (n) =>
  Array.from({ length: n }, (_, i) => night(new Date(Date.UTC(2026, 0, 1 + i * 7)).toISOString().slice(0, 10)));

// The store as the Worker reads it: `readRecord` parses whatever is under the
// key, so the seed has to be the same JSON the publish path writes.
const fakeEnv = ({ nights = 12, ratings = {}, awards = null } = {}) => {
  const store = new Map();
  store.set(
    'roster',
    JSON.stringify({ version: 3, players: SQUAD.map((id) => player(id, ratings[id] ?? 3)) }),
  );
  store.set('history', JSON.stringify({ version: 3, fixtures: season(nights) }));
  if (awards) store.set('totm', JSON.stringify(awards));
  return {
    ROSTER_KV: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => store.set(k, v),
    },
  };
};

const get = async (env) => {
  const res = await worker.fetch(new Request('https://w/values'), env, {
    waitUntil: () => {},
  });
  return { res, body: await res.json() };
};

describe('GET /values', () => {
  it('answers without a password', async () => {
    const { res, body } = await get(fakeEnv());
    expect(res.status).toBe(200);
    expect(Object.keys(body.values).length).toBe(SQUAD.length);
  });

  it('sends the price and nothing the price was made of', async () => {
    // The point of the whole endpoint. Five multipliers on the wire are five
    // equations, and five equations solve back to the rating.
    const { body } = await get(fakeEnv());
    for (const id of SQUAD) {
      expect(Object.keys(body.values[id]).sort()).toEqual(['previous', 'value']);
    }
  });

  it('never puts a rating, a keep-apart list or an alias on the wire', async () => {
    // Belt and braces against the shape drifting: this route touches the one
    // copy of the roster that still has private fields on it.
    const { body } = await get(fakeEnv());
    const text = JSON.stringify(body);
    for (const field of ['rating', 'attack', 'chemistry', 'avoid', 'aliases']) {
      expect(text).not.toContain(field);
    }
  });

  it('says nothing at all until the club has a history to hide a tier in', async () => {
    const { body } = await get(fakeEnv({ nights: 3 }));
    expect(body.values).toEqual({});
  });

  it('treats an unpublished club as empty rather than as an error', async () => {
    const empty = { ROSTER_KV: { get: async () => null, put: async () => {} } };
    const { res, body } = await get(empty);
    expect(res.status).toBe(200);
    expect(body.values).toEqual({});
  });

  it('counts months in the registered five toward the price', async () => {
    const plain = await get(fakeEnv());
    const decorated = await get(
      fakeEnv({ awards: { '2026-01': { ids: ['a'] }, '2026-02': { ids: ['a'] } } }),
    );
    expect(decorated.body.values.a.value).toBeGreaterThan(plain.body.values.a.value);
    // and nobody else moves because of somebody else's shirt
    expect(decorated.body.values.c.value).toBe(plain.body.values.c.value);
  });

  it('prices a higher-rated player above an identical lower-rated one', async () => {
    // The tier does something — it is quiet, not absent.
    const { body } = await get(fakeEnv({ ratings: { a: 5, b: 2 } }));
    expect(body.values.a.value).toBeGreaterThan(body.values.b.value);
  });
});
