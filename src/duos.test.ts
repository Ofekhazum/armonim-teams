import { describe, expect, it } from 'vitest';
import { duoFacts, MIN_TOGETHER, SHRINK_K } from './duos';
import type { FixtureRecord, Player } from './types';

function player(id: string, name: string, extra: Partial<Player> = {}): Player {
  return { id, name, rating: 3, attack: 50, chemistry: [], ...extra };
}

let seq = 0;
// `black` takes the night 3–1 unless `blackWins` is false.
function night(black: string[], white: string[], blackWins = true): FixtureRecord {
  const fx: FixtureRecord = {
    id: `f${seq}`,
    date: new Date(Date.UTC(2026, 0, 1 + seq)).toISOString().slice(0, 10),
    teams: { black, white, blue: [] },
    players: [...black, ...white].map((x) => ({ id: x, name: x, rating: 3 })),
    wins: blackWins ? { black: 3, white: 1, blue: 0 } : { black: 1, white: 3, blue: 0 },
  };
  seq++;
  return fx;
}

const A = player('a', 'אופק');
const B = player('b', 'דור');
const C = player('c', 'ניב');
const D = player('d', 'טום');

describe('duoFacts', () => {
  it('says nothing below the minimum nights together', () => {
    const history = Array.from({ length: MIN_TOGETHER - 1 }, () =>
      night(['a', 'b'], ['c', 'd']),
    );
    expect(duoFacts([A, B, C, D], history)).toEqual([]);
  });

  it('reports a strong pairing with its actual record, not a verdict', () => {
    const history = Array.from({ length: 12 }, () => night(['a', 'b'], ['c', 'd']));
    const out = duoFacts([A, B, C, D], history);
    const better = out.find((f) => f.kind === 'together-better');
    expect(better).toMatchObject({ aName: 'אופק', bName: 'דור', together: 12, won: 12 });
  });

  it('reports the losing pairing too', () => {
    const history = Array.from({ length: 12 }, () => night(['a', 'b'], ['c', 'd']));
    const worse = duoFacts([A, B, C, D], history).find((f) => f.kind === 'together-worse');
    expect(worse).toMatchObject({ aName: 'ניב', bName: 'טום', together: 12, won: 0 });
  });

  it('does not pair players who were on opposite teams', () => {
    const history = Array.from({ length: 12 }, () => night(['a', 'c'], ['b', 'd']));
    const out = duoFacts([A, B, C, D], history);
    // a&b were never teammates, so neither can be the reported pair
    for (const f of out) {
      expect([f.aName, f.bName].sort()).not.toEqual(['אופק', 'דור'].sort());
    }
  });

  // The point of the shrink: a tiny perfect record must not outrank a long
  // strong one, because four nights is not evidence of anything on its own.
  // At a ~2-in-3 base rate, 4-from-4 happens by chance about one time in five.
  it('does not let a 4-from-4 pair outrank a long, well-established one', () => {
    // E and F are the opposition throughout, which keeps the base rate at a
    // neutral 50% — without them, a&b would be most of the data and so define
    // the very average they'd need to beat.
    const history = [
      // a&b: 24 from 30 together
      ...Array.from({ length: 24 }, () => night(['a', 'b'], ['e', 'f'], true)),
      ...Array.from({ length: 6 }, () => night(['a', 'b'], ['e', 'f'], false)),
      // c&d: a perfect but tiny 4 from 4
      ...Array.from({ length: MIN_TOGETHER }, () => night(['c', 'd'], ['e', 'f'], true)),
    ];
    const squad = [A, B, C, D, player('e', 'ניר'), player('f', 'שגב')];
    const better = duoFacts(squad, history).find((f) => f.kind === 'together-better');
    expect(better).toMatchObject({ aName: 'אופק', bName: 'דור', together: 30, won: 24 });
  });

  // The flip side of the shrink, stated as a test so it can't drift silently:
  // clearing MIN_TOGETHER is not enough on its own to be reported.
  it('reports nothing for a pair that only just clears the minimum', () => {
    const history = Array.from({ length: MIN_TOGETHER }, () => night(['a', 'b'], ['c', 'd']));
    expect(duoFacts([A, B, C, D], history)).toEqual([]);
  });

  it('ignores guests, whose ids change every visit', () => {
    const guest = player('g', 'אורח', { isGuest: true });
    const history = Array.from({ length: 12 }, () => night(['a', 'g'], ['c', 'd']));
    const out = duoFacts([A, guest, C, D], history);
    for (const f of out) expect([f.aName, f.bName]).not.toContain('אורח');
  });

  it("leaves tonight's own saved result out of the record coming in", () => {
    const past = Array.from({ length: 12 }, () => night(['a', 'b'], ['c', 'd']));
    const tonight = night(['a', 'b'], ['c', 'd'], false);
    tonight.id = 'tonight';
    const withTonight = duoFacts([A, B, C, D], [...past, tonight], 'tonight');
    const better = withTonight.find((f) => f.kind === 'together-better');
    expect(better).toMatchObject({ together: 12, won: 12 });
  });

  it('shrinks toward the measured base rate rather than assuming a third', () => {
    // every night here has a clear winner, so the base rate is 1/2 among the
    // four players present (two win, two lose) — not 1/3
    const history = Array.from({ length: 12 }, () => night(['a', 'b'], ['c', 'd']));
    const out = duoFacts([A, B, C, D], history);
    expect(out).toHaveLength(2);
    expect(SHRINK_K).toBeGreaterThan(0);
  });
});
