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

import { describe, expect, it } from 'vitest';
import {
  barFor,
  hasResult,
  playerForm,
  playerStandings,
  suggestRatings,
  totalWins,
} from './calibration';
import type { FixtureRecord, Player, TeamColor, TeamWins } from './types';

let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

interface Spec {
  id: string;
  name: string;
  rated: number;
  truth: number;
}

const mkPlayers = (specs: Spec[]): Player[] =>
  specs.map((s) => ({ id: s.id, name: s.name, rating: s.rated, attack: 50, chemistry: [] }));

const PAIRS: [TeamColor, TeamColor][] = [
  ['black', 'white'],
  ['blue', 'black'],
  ['white', 'blue'],
];

// Simulates `nights` fixtures for a 15-player league whose *true* ability
// (`truth`) may differ from the rating on their profile (`rated`) — the gap
// between the two is exactly what suggestRatings is supposed to detect.
function season(specs: Spec[], nights: number): FixtureRecord[] {
  const truthOf = new Map(specs.map((s) => [s.id, s.truth]));
  return Array.from({ length: nights }, (_, n) => {
    const ids = specs.map((s) => s.id).sort(() => rnd() - 0.5);
    const per = Math.floor(ids.length / 3);
    const teams = {
      black: ids.slice(0, per),
      white: ids.slice(per, per * 2),
      blue: ids.slice(per * 2, per * 3),
    } as Record<TeamColor, string[]>;
    const avg = (c: TeamColor) =>
      teams[c].reduce((t, id) => t + truthOf.get(id)!, 0) / teams[c].length;
    const wins: TeamWins = { black: 0, white: 0, blue: 0 };
    for (const [c, d] of PAIRS) {
      for (let m = 0; m < 2; m++) {
        const p = 1 / (1 + 10 ** ((avg(d) - avg(c)) / 2));
        wins[rnd() < p ? c : d] += rnd() < 0.2 ? 0.5 : 1; // ~1 in 5 goes to penalties
      }
    }
    return {
      id: `fx${n}`,
      date: `2026-01-0${(n % 9) + 1}`,
      teams,
      players: specs.map((s) => ({ id: s.id, name: s.name, rating: s.rated })),
      wins,
    };
  });
}

const base: Spec[] = Array.from({ length: 15 }, (_, i) => ({
  id: `p${i}`,
  name: `P${i}`,
  rated: 3,
  truth: 3,
}));
// p0 is secretly a 5, p1 secretly a 1 — everyone else is exactly as rated
const mis = base.map((s) =>
  s.id === 'p0' ? { ...s, truth: 5 } : s.id === 'p1' ? { ...s, truth: 1 } : s,
);

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
        seed = 7 + r * 7919;
        expect(suggestRatings(season(mis, nights), mkPlayers(mis))).toHaveLength(0);
      }
    }
  });

  it('never judges a player who only turns up occasionally', () => {
    // 12 nights of football, but p0 plays only the first three
    seed = 4242;
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
      seed = 900 + r * 7919;
      totalSuggested += suggestRatings(season(mis, 10), mkPlayers(mis)).length;
    }
    // out of 15 players per run — most should get nothing
    expect(totalSuggested / 20).toBeLessThanOrEqual(5);
  });

  it('can speak from four nights when someone looks far out', () => {
    let spoke = 0;
    for (let r = 0; r < 60; r++) {
      seed = 31 + r * 7919;
      if (suggestRatings(season(mis, 4), mkPlayers(mis)).length > 0) spoke++;
    }
    expect(spoke).toBeGreaterThan(0);
  });

  it('over a longer run, finds genuinely mis-rated players the right way round', () => {
    let right = 0;
    let wrong = 0;
    for (let r = 0; r < 40; r++) {
      seed = 500 + r * 7919;
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
    const ceiling = base.map((sp) => (sp.id === 'p0' ? { ...sp, rated: 5, truth: 9 } : sp));
    let notes = 0;
    for (let r = 0; r < 40; r++) {
      seed = 616 + r * 7919;
      for (const s of suggestRatings(season(ceiling, 20), mkPlayers(ceiling))) {
        if (s.id !== 'p0') continue;
        expect(s.suggested).toBeLessThanOrEqual(5);
        expect(s.atLimit).toBe(true);
        expect(s.direction).toBe('up');
        notes++;
      }
    }
    expect(notes).toBeGreaterThan(0);
  });

  it('never offers a rating below 1 for a floored player', () => {
    const floor = base.map((sp) => (sp.id === 'p1' ? { ...sp, rated: 1, truth: -3 } : sp));
    for (let r = 0; r < 20; r++) {
      seed = 707 + r * 7919;
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
      seed = 808 + r * 7919;
      const list = suggestRatings(season(mixed, 20), mkPlayers(mixed));
      const firstNote = list.findIndex((x) => x.atLimit);
      const lastAction = list.map((x) => x.atLimit).lastIndexOf(false);
      if (firstNote >= 0 && lastAction >= 0) {
        expect(firstNote).toBeGreaterThan(lastAction);
      }
    }
  });

  it('moves an actionable suggestion by exactly half a star, within 1-5', () => {
    seed = 11;
    for (const s of suggestRatings(season(mis, 20), mkPlayers(mis))) {
      if (s.atLimit) continue;
      expect(Math.abs(s.suggested - s.current)).toBe(0.5);
      expect(s.suggested).toBeGreaterThanOrEqual(1);
      expect(s.suggested).toBeLessThanOrEqual(5);
    }
  });

  it('is self-cancelling: accepting a suggestion weakens the case for repeating it', () => {
    for (let r = 0; r < 30; r++) {
      seed = 2024 + r * 7919;
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
    seed = 5;
    const hist = season(mis, 20);
    const without = mkPlayers(mis).filter((p) => p.id !== 'p0');
    expect(suggestRatings(hist, without).some((x) => x.id === 'p0')).toBe(false);
  });
});

describe('playerForm', () => {
  it('covers everyone who played, sorted by how they are doing', () => {
    seed = 3;
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
        expect(b).toBeGreaterThanOrEqual(1.0);
        expect(b).toBeLessThanOrEqual(2.5);
      }
    }
  });
});
