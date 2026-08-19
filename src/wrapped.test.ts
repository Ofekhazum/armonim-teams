import { describe, expect, it } from 'vitest';
import { buildWrapped, periodLabel, wrappedPeriods } from './wrapped';
import type { FixtureRecord } from './types';

let seq = 0;

function night(
  date: string,
  black: string[],
  white: string[],
  wins: { black: number; white: number; blue: number },
): FixtureRecord {
  const fx: FixtureRecord = {
    id: `f${seq}`,
    date,
    teams: { black, white, blue: [] },
    players: [...black, ...white].map((id) => ({ id, name: id, rating: 3 })),
    wins,
  };
  seq++;
  return fx;
}

describe('wrappedPeriods', () => {
  it('lists months with a recorded result, newest first, and skips unrecorded ones', () => {
    const history = [
      night('2026-06-10', ['a'], ['b'], { black: 0, white: 0, blue: 0 }), // no result
      night('2026-07-03', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-14', ['a'], ['b'], { black: 1, white: 3, blue: 0 }),
      night('2026-07-17', ['a'], ['b'], { black: 2, white: 2, blue: 0 }),
    ];
    expect(wrappedPeriods(history)).toEqual(['2026-08', '2026-07']);
  });
});

describe('periodLabel', () => {
  it('formats a YYYY-MM key as a month name and year', () => {
    expect(periodLabel('2026-08')).toBe('August 2026');
  });
});

describe('buildWrapped', () => {
  it('only counts nights within the requested month', () => {
    const history = [
      night('2026-07-31', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    const stats = buildWrapped(history, '2026-08');
    expect(stats.nightsRecorded).toBe(2);
  });

  it('sums total wins across the month', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 2, white: 2, blue: 0 }),
    ];
    expect(buildWrapped(history, '2026-08').totalWins).toBe(8);
  });

  it('counts each match once, not once per player on the winning team', () => {
    // a 5-a-side team banking a 3-0 win is one "3 wins" fact, not fifteen —
    // regression for a bug where this summed every player's personal credit
    const history = [
      night('2026-08-01', ['a', 'b', 'c', 'd', 'e'], ['f', 'g', 'h', 'i', 'j'], {
        black: 3,
        white: 1,
        blue: 0,
      }),
    ];
    expect(buildWrapped(history, '2026-08').totalWins).toBe(4);
  });

  it('finds who played the most nights and who banked the most wins', () => {
    const history = [
      night('2026-08-01', ['a', 'c'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-15', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    const stats = buildWrapped(history, '2026-08');
    expect(stats.mostNights).toEqual({ name: 'a', nights: 3 });
    expect(stats.topScorer).toEqual({ name: 'a', wins: 9 });
  });

  it('reports the longest win streak in the month, gated the same as MIN_WIN_STREAK', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-15', ['a'], ['b'], { black: 1, white: 3, blue: 0 }),
    ];
    // only 2 in a row — below MIN_WIN_STREAK, so no streak is reported
    expect(buildWrapped(history, '2026-08').longestStreak).toBeNull();
  });

  it('says nothing about a duo below MIN_TOGETHER, same as tonight’s duo facts', () => {
    const history = [
      night('2026-08-01', ['a', 'b'], ['c', 'd'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a', 'b'], ['c', 'd'], { black: 3, white: 1, blue: 0 }),
    ];
    expect(buildWrapped(history, '2026-08').bestDuo).toBeNull();
  });

  it('finds who banked the fewest wins, but only once they have at least 2 nights', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 1, white: 3, blue: 0 }),
      // z only ever plays this one night with zero wins — a lower total than
      // a's 4, but a single night is a mercy exemption, not a record
      night('2026-08-15', ['z'], ['b'], { black: 0, white: 4, blue: 0 }),
    ];
    const stats = buildWrapped(history, '2026-08');
    expect(stats.bottomScorer).toEqual({ name: 'a', wins: 4, nights: 2 });
  });

  it('reports the longest winless run in the month, gated the same as MIN_WINLESS_RUN', () => {
    const four = Array.from({ length: 4 }, (_, i) =>
      night(`2026-08-0${i + 1}`, ['a'], ['b'], { black: 1, white: 3, blue: 0 }),
    );
    expect(buildWrapped(four, '2026-08').longestWinless).toBeNull();

    const five = [
      ...four,
      night('2026-08-05', ['a'], ['b'], { black: 1, white: 3, blue: 0 }),
    ];
    expect(buildWrapped(five, '2026-08').longestWinless).toEqual({ name: 'a', nights: 5 });
  });

  it('reports a worst duo alongside the best one', () => {
    const history = Array.from({ length: 20 }, (_, i) =>
      night(
        `2026-08-${String(i + 1).padStart(2, '0')}`,
        ['a', 'b'],
        ['c', 'd'],
        i < 15 ? { black: 3, white: 1, blue: 0 } : { black: 1, white: 3, blue: 0 },
      ),
    );
    const stats = buildWrapped(history, '2026-08');
    expect(stats.bestDuo).toMatchObject({ kind: 'together-better', aName: 'a', bName: 'b' });
    expect(stats.worstDuo).toMatchObject({ kind: 'together-worse', aName: 'c', bName: 'd' });
  });

  it('returns zeros and nulls for a month with nothing recorded', () => {
    const stats = buildWrapped([], '2026-08');
    expect(stats).toMatchObject({
      nightsRecorded: 0,
      totalWins: 0,
      mostNights: null,
      topScorer: null,
      bottomScorer: null,
      longestStreak: null,
      longestWinless: null,
      bestDuo: null,
      worstDuo: null,
    });
  });
});
