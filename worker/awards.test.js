import { describe, expect, it } from 'vitest';
import { announceMonth, clearMonth, isPeriod, readAwards, registerAwards } from './awards.js';

// The registrar. What is being tested is not the scoring — that has its own
// tests in src/totm.test.ts, and the whole point of the extraction is that
// there is only one of it — but *when* a month gets written down, and what
// happens to one that already was.

const fixture = (date, over = {}) => ({
  id: date,
  date,
  teams: { black: ['a', 'b'], white: ['c', 'd'], blue: ['e', 'f'] },
  players: [
    { id: 'a', name: 'Aviv', rating: 4 },
    { id: 'b', name: 'Ben', rating: 4 },
    { id: 'c', name: 'Chen', rating: 4 },
    { id: 'd', name: 'Dan', rating: 4 },
    { id: 'e', name: 'Eli', rating: 4 },
    { id: 'f', name: 'Fadi', rating: 4 },
  ],
  wins: { black: 4, white: 2, blue: 1 },
  ...over,
});

// A KV stand-in: a Map, and a count of how many times it was written to, which
// is how "never overwrites" is checked rather than inferred.
const fakeEnv = (seed = {}) => {
  const store = new Map(Object.entries(seed));
  let writes = 0;
  return {
    writes: () => writes,
    ROSTER_KV: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => {
        writes++;
        store.set(k, v);
      },
    },
  };
};

const withHistory = (fixtures, awards) =>
  fakeEnv({
    history: JSON.stringify({ version: 1, fixtures }),
    ...(awards ? { totm: JSON.stringify(awards) } : {}),
  });

const SEP_1 = Date.parse('2026-09-01T05:00:00Z');

describe('registerAwards', () => {
  it('registers a month that is over', async () => {
    const env = withHistory([fixture('2026-08-06'), fixture('2026-08-13')]);
    const { added, awards } = await registerAwards(env, SEP_1);
    expect(added).toBe(1);
    expect(awards['2026-08'].ids).toHaveLength(5);
    // the names travel too, so an award still renders after somebody leaves
    expect(awards['2026-08'].names).toHaveLength(5);
    expect(awards['2026-08'].at).toBe(SEP_1);
  });

  it('leaves the month still being played alone', async () => {
    // the cron fires *inside* September, and September is not over
    const env = withHistory([fixture('2026-08-06'), fixture('2026-09-01')]);
    const { awards } = await registerAwards(env, SEP_1);
    expect(Object.keys(awards)).toEqual(['2026-08']);
  });

  it('backfills every finished month, not only the last one', async () => {
    // the first run after deploying meets an archive, not one month
    const env = withHistory([
      fixture('2026-06-04'),
      fixture('2026-07-02'),
      fixture('2026-08-06'),
    ]);
    const { added, awards } = await registerAwards(env, SEP_1);
    expect(added).toBe(3);
    expect(Object.keys(awards).sort()).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('never overwrites a month already registered', async () => {
    // the correction path: somebody set August by hand, and the scheduler must
    // not quietly put its own answer back next time it runs
    const byHand = { '2026-08': { ids: ['z'], names: ['Zohar'], at: 1 } };
    const env = withHistory([fixture('2026-08-06')], byHand);
    const { added, awards } = await registerAwards(env, SEP_1);
    expect(added).toBe(0);
    expect(awards['2026-08'].ids).toEqual(['z']);
    expect(env.writes()).toBe(0);
  });

  it('is idempotent — running it twice writes once', async () => {
    const env = withHistory([fixture('2026-08-06')]);
    await registerAwards(env, SEP_1);
    const second = await registerAwards(env, SEP_1);
    expect(second.added).toBe(0);
    expect(env.writes()).toBe(1);
  });

  it('says nothing about a month with no result recorded', async () => {
    const env = withHistory([fixture('2026-08-06', { wins: { black: 0, white: 0, blue: 0 } })]);
    const { added, awards } = await registerAwards(env, SEP_1);
    expect(added).toBe(0);
    expect(awards).toEqual({});
  });

  it('survives an empty store and a corrupt one', async () => {
    expect((await registerAwards(fakeEnv(), SEP_1)).added).toBe(0);
    const broken = fakeEnv({ history: '{oh no', totm: 'not json' });
    expect((await registerAwards(broken, SEP_1)).added).toBe(0);
  });
});

describe('announceMonth', () => {
  it('writes a month the cron has not reached, and overwrites one it has', async () => {
    const env = withHistory([fixture('2026-08-06')], {
      '2026-08': { ids: ['z'], names: ['Zohar'], at: 1 },
    });
    const registered = await announceMonth(env, '2026-08', 999);
    expect(registered.ids).not.toEqual(['z']);
    expect(registered.at).toBe(999);
  });

  it('refuses a month with nothing played in it', async () => {
    const env = withHistory([fixture('2026-08-06')]);
    expect(await announceMonth(env, '2026-01')).toBeNull();
  });
});

describe('clearMonth', () => {
  it('forgets one month and leaves the rest', async () => {
    const env = withHistory(
      [],
      { '2026-07': { ids: [], names: [], at: 1 }, '2026-08': { ids: [], names: [], at: 2 } },
    );
    const left = await clearMonth(env, '2026-07');
    expect(Object.keys(left)).toEqual(['2026-08']);
  });

  it('does not write when there was nothing to forget', async () => {
    const env = withHistory([], { '2026-08': { ids: [], names: [], at: 2 } });
    await clearMonth(env, '2026-01');
    expect(env.writes()).toBe(0);
  });
});

describe('isPeriod', () => {
  it('takes YYYY-MM and nothing else', () => {
    expect(isPeriod('2026-08')).toBe(true);
    expect(isPeriod('2026-8')).toBe(false);
    expect(isPeriod('2026-08-06')).toBe(false);
    expect(isPeriod('')).toBe(false);
    expect(isPeriod(null)).toBe(false);
  });
});

describe('readAwards', () => {
  it('is an empty object when nothing has been registered', async () => {
    expect(await readAwards(fakeEnv())).toEqual({});
  });
});
