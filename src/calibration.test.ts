// Behaviour tests for the rating-suggestion engine (src/calibration.ts).
//
// This logic is the riskiest code in the app — a ridge-regression estimator,
// an asymmetric confidence bar, half-win scoring — and every property here was
// originally checked by hand-run scripts during development, not by anything
// that runs in CI. Promoted into the repo so a future change to LAMBDA,
// RATING_BIAS, or the estimator itself gets caught before it ships, not
// discovered from a confused screenshot.
//
// Most of these tests are statistical: they run many synthetic seasons with a
// known ground truth (a player secretly better or worse than their rating) and
// assert on the *rate* of correct/incorrect suggestions, not a single outcome
// — a single run of a probabilistic function proves nothing. Seeds are fixed
// so a failure is reproducible.
//
// The league itself lives in `calibration.sim.ts`, shared with the tuning
// reports under `scripts/` so both measure the same thing.

import { describe, expect, it } from 'vitest';
import {
  barFor,
  hasResult,
  playerForm,
  playerStandings,
  ratingErrors,
  suggestRatings,
  totalWins,
} from './calibration';
import {
  flat as base,
  mis,
  mkPlayers,
  season,
  setSeed,
  shuffle,
  spread,
  withError,
} from './calibration.sim';
import type { FixtureRecord } from './types';

// Guards the simulator itself. Every tuning table in calibration.ts was once
// measured through `sort(() => rnd() - 0.5)`, which is not a shuffle: it barely
// disturbs the array, so the first name in the list kept landing on black and
// the numbers described a league nobody plays in. If this ever goes back to a
// sort-based shuffle, the estimator's documented behaviour becomes fiction.
describe('the simulator', () => {
  it('deals each player to each shirt equally often', () => {
    setSeed(99);
    const per = new Map<number, number[]>();
    const runs = 3000;
    for (let r = 0; r < runs; r++) {
      const order = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
      for (const id of [0, 7, 14]) {
        const slot = Math.floor(order.indexOf(id) / 5); // 0 black, 1 white, 2 blue
        const counts = per.get(id) ?? [0, 0, 0];
        counts[slot]++;
        per.set(id, counts);
      }
    }
    for (const counts of per.values()) {
      for (const c of counts) {
        // a third each, give or take sampling noise
        expect(Math.abs(c / runs - 1 / 3)).toBeLessThan(0.03);
      }
    }
  });
});

describe('win-tally results & standings', () => {
  it('a night with no wins recorded counts for nobody', () => {
    expect(hasResult({ black: 0, white: 0, blue: 0 })).toBe(false);
    expect(hasResult({ black: 0, white: 2, blue: 0 })).toBe(true);
  });

  it('half-wins carry through to the standings', () => {
    const players = [{ id: 'x', name: 'X', rating: 3 }];
    const hist: FixtureRecord[] = [
      {
        id: 'f',
        date: '2026-01-01',
        teams: { black: ['x'], white: [], blue: [] },
        players,
        wins: { black: 3.5, white: 1, blue: 1 },
      },
    ];
    const st = playerStandings(hist).find((s) => s.id === 'x')!;
    expect(st.wins).toBe(3.5);
    expect(st.nights).toBe(1);
    expect(totalWins(hist[0].wins)).toBe(5.5);
  });

  it('wins accumulate across nights, per night is the rate', () => {
    const players = [{ id: 'x', name: 'X', rating: 3 }];
    const mk = (w: number): FixtureRecord => ({
      id: `f${w}`,
      date: '2026-01-01',
      teams: { black: ['x'], white: [], blue: [] },
      players,
      wins: { black: w, white: 1, blue: 1 },
    });
    const st = playerStandings([mk(3), mk(2)]).find((s) => s.id === 'x')!;
    expect(st.wins).toBe(5);
    expect(st.nights).toBe(2);
    expect(st.perNight).toBe(2.5);
  });
});

describe('rating suggestions', () => {
  it('is silent until a player has four nights behind them', () => {
    for (const nights of [1, 2, 3]) {
      for (let r = 0; r < 25; r++) {
        setSeed(7 + r * 7919);
        expect(suggestRatings(season(mis, nights), mkPlayers(mis))).toHaveLength(0);
      }
    }
  });

  it('never judges a player who only turns up occasionally', () => {
    // 12 nights of football, but p0 plays only the first three
    setSeed(4242);
    const full = season(mis, 12);
    const thinned = full.map((fx, i) =>
      i < 3
        ? fx
        : {
            ...fx,
            teams: Object.fromEntries(
              Object.entries(fx.teams).map(([c, ids]) => [c, ids.filter((id) => id !== 'p0')]),
            ) as typeof fx.teams,
          },
    );
    expect(suggestRatings(thinned, mkPlayers(mis)).some((x) => x.id === 'p0')).toBe(false);
  });

  it('leaves most players with no suggestion at all', () => {
    let totalSuggested = 0;
    for (let r = 0; r < 20; r++) {
      setSeed(900 + r * 7919);
      totalSuggested += suggestRatings(season(mis, 10), mkPlayers(mis)).length;
    }
    // out of 15 players per run — most should get nothing
    expect(totalSuggested / 20).toBeLessThanOrEqual(5);
  });

  it('can speak from four nights when someone looks far out', () => {
    let spoke = 0;
    for (let r = 0; r < 60; r++) {
      setSeed(31 + r * 7919);
      if (suggestRatings(season(mis, 4), mkPlayers(mis)).length > 0) spoke++;
    }
    expect(spoke).toBeGreaterThan(0);
  });

  it('over a longer run, finds genuinely mis-rated players the right way round', () => {
    let right = 0;
    let wrong = 0;
    for (let r = 0; r < 40; r++) {
      setSeed(500 + r * 7919);
      for (const s of suggestRatings(season(mis, 20), mkPlayers(mis))) {
        if (s.id === 'p0') s.direction === 'up' ? right++ : wrong++;
        if (s.id === 'p1') s.direction === 'down' ? right++ : wrong++;
      }
    }
    expect(right).toBeGreaterThan(0);
    // roughly 3+ correct suggestions for every wrong one
    expect(right).toBeGreaterThan(wrong * 3);
  });

  it('reports a maxed-out 5-star as a ceiling note, never an out-of-range rating', () => {
    // Whenever it does speak about a player already at the top of the scale, it
    // must be a note rather than an impossible rating. How *often* it speaks is
    // a separate matter, and currently the answer is "hardly ever" — see the
    // deafness test in "known faults" below.
    const ceiling = base.map((sp) => (sp.id === 'p0' ? { ...sp, rated: 5, truth: 9 } : sp));
    for (let r = 0; r < 40; r++) {
      setSeed(616 + r * 7919);
      for (const s of suggestRatings(season(ceiling, 20), mkPlayers(ceiling))) {
        if (s.id !== 'p0') continue;
        expect(s.suggested).toBeLessThanOrEqual(5);
        expect(s.atLimit).toBe(true);
        expect(s.direction).toBe('up');
      }
    }
  });

  it('never offers a rating below 1 for a floored player', () => {
    const floor = base.map((sp) => (sp.id === 'p1' ? { ...sp, rated: 1, truth: -3 } : sp));
    for (let r = 0; r < 20; r++) {
      setSeed(707 + r * 7919);
      for (const s of suggestRatings(season(floor, 20), mkPlayers(floor))) {
        if (s.id !== 'p1') continue;
        expect(s.suggested).toBeGreaterThanOrEqual(1);
        expect(s.atLimit).toBe(true);
      }
    }
  });

  it('sorts actionable suggestions before ceiling notes', () => {
    const mixed = base.map((sp) =>
      sp.id === 'p0' ? { ...sp, rated: 5, truth: 9 } : sp.id === 'p1' ? { ...sp, truth: 1 } : sp,
    );
    for (let r = 0; r < 30; r++) {
      setSeed(808 + r * 7919);
      const list = suggestRatings(season(mixed, 20), mkPlayers(mixed));
      const firstNote = list.findIndex((x) => x.atLimit);
      const lastAction = list.map((x) => x.atLimit).lastIndexOf(false);
      if (firstNote >= 0 && lastAction >= 0) {
        expect(firstNote).toBeGreaterThan(lastAction);
      }
    }
  });

  it('moves an actionable suggestion by exactly half a star, within 1-5', () => {
    setSeed(11);
    for (const s of suggestRatings(season(mis, 20), mkPlayers(mis))) {
      if (s.atLimit) continue;
      expect(Math.abs(s.suggested - s.current)).toBe(0.5);
      expect(s.suggested).toBeGreaterThanOrEqual(1);
      expect(s.suggested).toBeLessThanOrEqual(5);
    }
  });

  it('is self-cancelling: accepting a suggestion weakens the case for repeating it', () => {
    for (let r = 0; r < 30; r++) {
      setSeed(2024 + r * 7919);
      const hist = season(mis, 20);
      const before = suggestRatings(hist, mkPlayers(mis)).find((x) => x.id === 'p0');
      if (!before) continue;
      const applied = mkPlayers(mis).map((p) =>
        p.id === 'p0' ? { ...p, rating: before.suggested } : p,
      );
      const after = suggestRatings(hist, applied).find((x) => x.id === 'p0');
      expect(!after || Math.abs(after.impliedDelta) < Math.abs(before.impliedDelta)).toBe(true);
      return; // one real instance is enough
    }
  });

  it('never suggests a change for someone not on the roster', () => {
    setSeed(5);
    const hist = season(mis, 20);
    const without = mkPlayers(mis).filter((p) => p.id !== 'p0');
    expect(suggestRatings(hist, without).some((x) => x.id === 'p0')).toBe(false);
  });
});

const HOUSE = { teams: 'balanced', matchesPerPairing: 4 } as const;

// What the rebuild has already bought. These assert the *fixed* behaviour and
// should stay passing.
describe('the error bars', () => {
  it('does not claim confidence about a league where nobody is mis-rated', () => {
    // Every player is rated exactly right, so |z| ought to look like a standard
    // normal — median around 0.67. It used to sit at 4.0, four-sigma confidence
    // in pure noise, which is what let the panel name innocent players.
    const byId = new Map(mkPlayers(spread).map((p) => [p.id, p]));
    const zs: number[] = [];
    for (let r = 0; r < 30; r++) {
      setSeed(5000 + r * 7919);
      const hist = season(spread, 5, HOUSE);
      for (const e of ratingErrors(hist, (id) => byId.get(id)?.rating ?? null).values())
        zs.push(Math.abs(e.z));
    }
    zs.sort((a, b) => a - b);
    // Still a little overconfident on five nights — the three rows of a night
    // share a team's win total, and five clusters is too few to correct for
    // properly — so this is an honest bound rather than a tight one.
    expect(zs[Math.floor(zs.length / 2)]).toBeLessThan(1.5);
  });

  it('gets more trustworthy the more football it is given', () => {
    // The old gate did the opposite: false flags peaked at eight nights. The
    // interval gate has to fall away monotonically instead.
    const ps = mkPlayers(spread);
    const flagsAt = (nights: number) => {
      let n = 0;
      for (let r = 0; r < 40; r++) {
        setSeed(3000 + r * 7919);
        n += suggestRatings(season(spread, nights, HOUSE), ps).length;
      }
      return n / 40;
    };
    const [five, twelve, twenty] = [flagsAt(5), flagsAt(12), flagsAt(20)];
    expect(twelve).toBeLessThan(five);
    expect(twenty).toBeLessThan(twelve);
    expect(twenty).toBeLessThan(0.15); // near-silence on a fairly-rated club
  });
});

// What a win tally costs, pinned so the day it is paid it shows up in CI rather
// than in a screenshot. These assert the *limited* behaviour on purpose: when
// they start failing, the night data has got richer and the panel may be worth
// switching back on. See fault 4 in the header of calibration.ts.
//
// Both of these are the same fact. A fixture records each team's *total* wins,
// and `buildRows` reads black-over-white as if it were a head-to-head share
// when black's total also contains wins over blue. Re-run on synthetic nights
// that genuinely are head-to-head, the estimator recovers 1.40 of a true 1.5
// and its error bars fall as 1/√n; on three-team totals both stall.
describe('what a win tally cannot tell you', () => {
  it('attenuates a known error to about two-thirds of its real size', () => {
    // p9 is an ordinary 3★ who is secretly 1.5 stars better. Given a great deal
    // of football the estimate should settle on 1.5; it settles near 1.0.
    const specs = withError('p9', 1.5);
    const byId = new Map(mkPlayers(specs).map((p) => [p.id, p]));
    let sum = 0;
    const runs = 40;
    for (let r = 0; r < runs; r++) {
      setSeed(2000 + r * 7919);
      const hist = season(specs, 60, HOUSE);
      sum += ratingErrors(hist, (id) => byId.get(id)?.rating ?? null).get('p9')!.delta;
    }
    const settled = sum / runs;
    expect(settled).toBeGreaterThan(0.7); // it does point the right way
    expect(settled).toBeLessThan(1.3); // ...but well short of the true 1.5
  });

  it('is too deaf to report even a four-star error at the ceiling', () => {
    // Rated 5, genuinely a 9, twenty nights of football: the panel should be
    // shouting. Reading the local slope rather than the 50/50 one lifted this
    // estimate from ~0.9 stars to ~1.55, which is most of the way to clearing
    // the bar — but the error bars stay near 0.8 however long the club plays,
    // for the reason above, so it still speaks about one time in twelve.
    const ceiling = base.map((s) => (s.id === 'p0' ? { ...s, rated: 5, truth: 9 } : s));
    const ps = mkPlayers(ceiling);
    let spoke = 0;
    for (let r = 0; r < 100; r++) {
      setSeed(616 + r * 7919);
      if (suggestRatings(season(ceiling, 20, HOUSE), ps).some((s) => s.id === 'p0')) spoke++;
    }
    expect(spoke).toBeLessThan(15);
  });
});

describe('playerForm', () => {
  it('covers everyone who played, sorted by how they are doing', () => {
    setSeed(3);
    const f = playerForm(season(mis, 10), mkPlayers(mis));
    expect(f).toHaveLength(15);
    for (let i = 1; i < f.length; i++) {
      expect(f[i - 1].delta).toBeGreaterThanOrEqual(f[i].delta);
    }
  });
});

describe('barFor — the anchored confidence bar', () => {
  it('makes a high rating harder to climb and easier to lose', () => {
    expect(barFor(5, 'up')).toBeGreaterThan(barFor(5, 'down'));
    expect(barFor(2, 'down')).toBeGreaterThan(barFor(2, 'up'));
    expect(barFor(4, 'up')).toBeGreaterThan(barFor(3, 'up'));
    expect(barFor(4, 'down')).toBeLessThan(barFor(3, 'down'));
  });

  it('is symmetric at the anchor and never collapses or balloons', () => {
    expect(barFor(2.5, 'up')).toBe(barFor(2.5, 'down'));
    for (const r of [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
      for (const dir of ['up', 'down'] as const) {
        const b = barFor(r, dir);
        // Never below the smallest change the organiser could actually make,
        // and never so high that only an absurd error could clear it.
        expect(b).toBeGreaterThanOrEqual(0.35);
        expect(b).toBeLessThanOrEqual(1.0);
      }
    }
  });
});
