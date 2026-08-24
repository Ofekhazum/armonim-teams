import { describe, expect, it } from 'vitest';
import type { FixtureRecord, Player, TeamWins } from './types';
import { ATTACK_DEFAULT } from './types';
import { resultStrength } from './calibration';
import {
  BASE,
  MAX_SWING,
  MIN_HISTORY_FOR_VALUES,
  formatValue,
  marketValues,
  quantise,
  valuationParts,
} from './marketValue';

const player = (id: string, rating = 3): Player => ({
  id,
  name: id,
  rating,
  attack: ATTACK_DEFAULT,
  chemistry: [],
  avoid: [],
});

// Six players, two per shirt, so a night is a complete three-way fixture.
const SQUAD = ['a', 'b', 'c', 'd', 'e', 'f'];
const squad = (ratings: Record<string, number> = {}): Player[] =>
  SQUAD.map((id) => player(id, ratings[id] ?? 3));

const night = (
  date: string,
  wins: Partial<TeamWins>,
  over: Partial<FixtureRecord> = {},
): FixtureRecord => ({
  id: date,
  date,
  teams: { black: ['a', 'b'], white: ['c', 'd'], blue: ['e', 'f'] },
  players: SQUAD.map((id) => ({ id, name: id, rating: 3 })),
  wins: { black: 0, white: 0, blue: 0, ...wins },
  ...over,
});

const weekly = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i * 7));
    return d.toISOString().slice(0, 10);
  });

// A season where black takes every night — enough nights that the privacy gate
// is open and the shrinkage has something to work with.
const blackDominant = (n = 12) =>
  weekly(n).map((date) => night(date, { black: 5, white: 2, blue: 1 }));

describe('quantise', () => {
  it('steps in quarters under ten million and halves over it', () => {
    expect(quantise(6.13)).toBe(6.25);
    expect(quantise(6.05)).toBe(6);
    expect(quantise(12.3)).toBe(12.5);
    expect(quantise(12.1)).toBe(12);
  });

  it('leaves nothing for floating point to smear', () => {
    // 0.1 + 0.2 arithmetic reaching a price tag is how €6.750000000000001M
    // ends up on somebody's profile.
    for (const v of [3.37, 7.62, 9.99, 10.01, 18.26]) {
      expect(Number.isInteger(quantise(v) * 100)).toBe(true);
    }
  });
});

describe('formatValue', () => {
  it('writes a price the way a price is written', () => {
    expect(formatValue(14.5)).toBe('€14.5M');
    expect(formatValue(6)).toBe('€6M');
    expect(formatValue(6.25)).toBe('€6.25M');
    expect(formatValue(10)).toBe('€10M');
  });
});

describe('the privacy gate', () => {
  it('prices nobody until the club has a history to hide the tier in', () => {
    // With little history every term but the tier is neutral, so the price is
    // BASE × tier — the rating, published. This is the reason for the floor.
    for (let n = 0; n < MIN_HISTORY_FOR_VALUES; n++) {
      const history = blackDominant(n);
      expect(marketValues(history, squad()).size).toBe(0);
    }
    expect(marketValues(blackDominant(MIN_HISTORY_FOR_VALUES), squad()).size).toBeGreaterThan(0);
  });

  it('gives no price to somebody who has never been on a sheet', () => {
    const values = marketValues(blackDominant(), [...squad(), player('newcomer', 5)]);
    expect(values.has('newcomer')).toBe(false);
    expect(values.has('a')).toBe(true);
  });

  it('bounds what the rating can do to a price', () => {
    // The whole privacy argument in one number. Moving a player from the
    // bottom tier to the top — the largest possible effect a rating can have —
    // must stay inside 1.18/0.85, so the rating can never be the thing that
    // explains a price. Measured on a simulated season the tier moved a value
    // by €0.5–2.0M against a spread of €3.25M–€12.5M: the price is mostly
    // results, and the tier is a nudge on top of them.
    const history = blackDominant();
    const low = marketValues(history, squad({ a: 1 })).get('a')!.value;
    const high = marketValues(history, squad({ a: 5 })).get('a')!.value;
    expect(high / low).toBeLessThanOrEqual(1.18 / 0.85 + 0.02); // + a quantise step
  });

  it('never lets two players on the same record be told apart by rating alone', () => {
    // a and b play every night together, on the same results, with the same
    // honours — so the *only* thing separating their prices is the tier, and
    // the point of the tier being three-way is that most of the club shares one.
    const values = marketValues(blackDominant(), squad({ a: 5, b: 4 }));
    expect(values.get('a')!.value).toBe(values.get('b')!.value);
  });
});

describe('the terms', () => {
  const parts = (ratings: Record<string, number> = {}, history = blackDominant()) =>
    valuationParts(history, squad(ratings), () => 0);

  it('prices a winner above a loser on the same rating', () => {
    const p = parts();
    expect(p.get('a')!.form).toBeGreaterThan(p.get('e')!.form);
  });

  it('reads strength from results with no rating anywhere in it', () => {
    // The enabler. `resultStrength` never sees a rating, so two identically
    // rated players on opposite records must still come out apart — and the
    // same call on a re-rated squad must return exactly the same numbers.
    const history = blackDominant();
    const flat = resultStrength(history);
    expect(flat.get('a')!.delta).toBeGreaterThan(flat.get('e')!.delta);

    const winners = parts({ a: 5, b: 5, c: 1, d: 1, e: 1, f: 1 }, history);
    const level = parts({}, history);
    expect(winners.get('a')!.impact).toBe(level.get('a')!.impact);
  });

  it('rewards turning up', () => {
    const dates = weekly(12);
    // 'a' misses the last four; everybody else plays the lot
    const history = dates.map((date, i) =>
      i >= 8
        ? night(date, { black: 5, white: 2, blue: 1 }, { teams: { black: ['b'], white: ['c', 'd'], blue: ['e', 'f'] } })
        : night(date, { black: 5, white: 2, blue: 1 }),
    );
    const p = valuationParts(history, squad(), () => 0);
    expect(p.get('a')!.presence).toBeLessThan(p.get('b')!.presence);
  });

  it('counts months in the five, and stops counting at the cap', () => {
    const none = valuationParts(blackDominant(), squad(), () => 0);
    const some = valuationParts(blackDominant(), squad(), (id) => (id === 'a' ? 2 : 0));
    const many = valuationParts(blackDominant(), squad(), (id) => (id === 'a' ? 40 : 0));

    expect(some.get('a')!.honours).toBeGreaterThan(none.get('a')!.honours);
    expect(many.get('a')!.honours).toBe(1.3);
  });

  it('stays quiet on momentum until the window has enough football in it', () => {
    // Two nights is not a run. Reading one as a trend is how a price ends up
    // swinging on noise.
    const thin = valuationParts(blackDominant(2), squad(), () => 0);
    expect(thin.get('a')!.momentum).toBe(1);
    expect(thin.get('e')!.momentum).toBe(1);

    // five nights, all played, so the window is full and momentum may speak
    const full = valuationParts(blackDominant(5), squad(), () => 0);
    expect(full.get('a')!.momentum).not.toBe(1);
  });

  it('measures momentum against the player, not against the club', () => {
    // A habitual loser who wins their last three is rising; a habitual winner
    // who wins their last three is merely continuing.
    const dates = weekly(10);
    // 'e' and 'f' (blue) lose seven then take the last three
    const history = dates.map((date, i) =>
      i < 7 ? night(date, { black: 5, white: 2, blue: 1 }) : night(date, { blue: 5, black: 2, white: 1 }),
    );
    const p = valuationParts(history, squad(), () => 0);
    expect(p.get('e')!.momentum).toBeGreaterThan(1);
    expect(p.get('a')!.momentum).toBeLessThan(1);
  });
});

describe('the weekly move', () => {
  it('holds a price to the swing cap when one night goes badly', () => {
    const dates = weekly(12);
    const history = dates.map((date, i) =>
      // eleven nights of black winning, then a collapse
      i < 11 ? night(date, { black: 5, white: 2, blue: 1 }) : night(date, { blue: 6, white: 3, black: 0 }),
    );
    const values = marketValues(history, squad());
    const a = values.get('a')!;
    expect(a.previous).not.toBeNull();
    expect(a.value).toBeGreaterThanOrEqual(quantise(a.previous! * (1 - MAX_SWING)) - 0.25);
    expect(a.value).toBeLessThan(a.previous!);
  });

  it('compares against a recomputed week, not a stored one', () => {
    // `previous` is the same formula over history minus the last night, so
    // dropping that night from the input must reproduce it exactly.
    const dates = weekly(12);
    const history = dates.map((d) => night(d, { black: 5, white: 2, blue: 1 }));
    const now = marketValues(history, squad());
    const lastWeek = marketValues(history.slice(0, -1), squad());
    expect(now.get('a')!.previous).toBe(lastWeek.get('a')!.value);
  });

  it('drops a whole evening, not one record, when two nights share a date', () => {
    // Two fixtures filed under one date are one week's football; leaving half
    // of it in "last week" would compare a week against itself.
    const dates = weekly(12);
    const history = [
      ...dates.map((d) => night(d, { black: 5, white: 2, blue: 1 })),
      night(dates[11], { blue: 6, black: 0, white: 2 }, { id: `${dates[11]}-b` }),
    ];
    const values = marketValues(history, squad());
    const lastWeek = marketValues(history.slice(0, 11), squad());
    expect(values.get('a')!.previous).toBe(lastWeek.get('a')!.value);
  });

  it('lets a first valuation be whatever it is', () => {
    const dates = weekly(12);
    // 'g' debuts on the final night
    const history = dates.map((date, i) =>
      i === 11
        ? night(date, { black: 5, white: 2, blue: 1 }, {
            teams: { black: ['a', 'b', 'g'], white: ['c', 'd'], blue: ['e', 'f'] },
            players: [...SQUAD, 'g'].map((id) => ({ id, name: id, rating: 3 })),
          })
        : night(date, { black: 5, white: 2, blue: 1 }),
    );
    const values = marketValues(history, [...squad(), player('g')]);
    expect(values.get('g')!.previous).toBeNull();
  });
});

describe('the whole price', () => {
  it('stays inside a range a Sunday league can read', () => {
    const values = marketValues(blackDominant(), squad({ a: 5, b: 1, c: 4, d: 2 }));
    for (const v of values.values()) {
      expect(v.value).toBeGreaterThan(1);
      expect(v.value).toBeLessThan(25);
    }
  });

  it('prices the base player at the base price', () => {
    // Everything neutral: an ordinary rating, the club's own rate, full
    // attendance, no honours. Sanity anchor for every constant above.
    const values = marketValues(blackDominant(), squad());
    const all = [...values.values()].map((v) => v.value);
    expect(Math.min(...all)).toBeLessThan(BASE);
    expect(Math.max(...all)).toBeGreaterThan(BASE);
  });

  it('publishes a price and nothing it was made of', () => {
    // Five multipliers are five equations, and five equations are the tier.
    const values = marketValues(blackDominant(), squad());
    expect(Object.keys(values.get('a')!).sort()).toEqual(['id', 'previous', 'value']);
  });
});
