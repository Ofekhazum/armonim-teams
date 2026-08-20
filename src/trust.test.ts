import { describe, expect, it } from 'vitest';
import {
  closeRate,
  MIN_TRUST_NIGHTS,
  trustCorrelation,
  trustPoints,
  trustSummary,
  trustVerdict,
  type TrustPoint,
} from './trust';
import type { FixtureRecord } from './types';

function fx(
  id: string,
  date: string,
  teams: { black: [string, number][]; white: [string, number][]; blue: [string, number][] },
  wins: { black: number; white: number; blue: number },
): FixtureRecord {
  const all = [...teams.black, ...teams.white, ...teams.blue];
  return {
    id,
    date,
    teams: {
      black: teams.black.map(([pid]) => pid),
      white: teams.white.map(([pid]) => pid),
      blue: teams.blue.map(([pid]) => pid),
    },
    players: all.map(([pid, rating]) => ({ id: pid, name: pid, rating })),
    wins,
  };
}

describe('trustPoints', () => {
  it('computes the predicted gap from team-average ratings and the actual gap from win share', () => {
    const history = [
      fx(
        'f1',
        '2026-08-01',
        {
          black: [
            ['a', 5],
            ['b', 5],
          ],
          white: [
            ['c', 3],
            ['d', 3],
          ],
          blue: [
            ['e', 4],
            ['f', 4],
          ],
        },
        { black: 3, white: 1, blue: 0 },
      ),
    ];
    const points = trustPoints(history);
    expect(points).toHaveLength(1);
    expect(points[0].predictedGap).toBeCloseTo(2); // 5 - 3
    expect(points[0].actualGap).toBeCloseTo(0.75); // 3/4 - 0/4
  });

  it('skips nights with no result recorded', () => {
    const history = [
      fx(
        'f1',
        '2026-08-01',
        { black: [['a', 5]], white: [['b', 3]], blue: [['c', 4]] },
        { black: 0, white: 0, blue: 0 },
      ),
    ];
    expect(trustPoints(history)).toEqual([]);
  });

  it('sorts points chronologically regardless of history order', () => {
    const history = [
      fx(
        'f2',
        '2026-08-08',
        { black: [['a', 5]], white: [['b', 3]], blue: [['c', 4]] },
        { black: 3, white: 1, blue: 0 },
      ),
      fx(
        'f1',
        '2026-08-01',
        { black: [['a', 5]], white: [['b', 3]], blue: [['c', 4]] },
        { black: 3, white: 1, blue: 0 },
      ),
    ];
    expect(trustPoints(history).map((p) => p.fixtureId)).toEqual(['f1', 'f2']);
  });
});

describe('trustCorrelation', () => {
  it('says nothing below MIN_TRUST_NIGHTS', () => {
    const points: TrustPoint[] = Array.from({ length: MIN_TRUST_NIGHTS - 1 }, (_, i) => ({
      fixtureId: `f${i}`,
      date: `2026-08-0${i + 1}`,
      predictedGap: i,
      actualGap: i / 10,
    }));
    expect(trustCorrelation(points)).toBeNull();
  });

  it('reports a strong positive correlation when predicted and actual gaps move together', () => {
    const points: TrustPoint[] = Array.from({ length: 10 }, (_, i) => ({
      fixtureId: `f${i}`,
      date: `d${i}`,
      predictedGap: i,
      actualGap: i * 0.1,
    }));
    expect(trustCorrelation(points)!).toBeCloseTo(1, 5);
  });

  it('returns null when one axis never varies — a correlation is undefined, not zero', () => {
    const points: TrustPoint[] = Array.from({ length: 10 }, (_, i) => ({
      fixtureId: `f${i}`,
      date: `d${i}`,
      predictedGap: 1,
      actualGap: i * 0.1,
    }));
    expect(trustCorrelation(points)).toBeNull();
  });
});

// --- The same question, asked as a count -----------------------------------
// The panel this backs used to answer "can I trust these teams" with a scatter
// plot and a correlation coefficient. The rest of this file covers the count
// version — the one an organiser can read — and mostly guards the places where
// a count would lie: an empty group, a sample too small to mean anything, and
// the case where the two groups are indistinguishable and the honest answer is
// "no signal".

const night = (predictedGap: number, actualGap: number, i = 0): TrustPoint => ({
  fixtureId: `fx${i}`,
  date: `2026-01-${String(i + 1).padStart(2, '0')}`,
  predictedGap,
  actualGap,
});

// `even` = the ratings called it close (gap ≤ 0.35); `close` = it finished with
// the wins shared around (share gap ≤ 0.34)
const evenClose = (i: number) => night(0.1, 0.2, i);
const evenLopsided = (i: number) => night(0.1, 0.8, i);
const unevenClose = (i: number) => night(0.9, 0.2, i);
const unevenLopsided = (i: number) => night(0.9, 0.8, i);

const many = (make: (i: number) => TrustPoint, n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => make(from + i));

describe('trustSummary', () => {
  it('sorts nights by what the ratings predicted, not by how they went', () => {
    const s = trustSummary([evenClose(0), evenLopsided(1), unevenClose(2)]);
    expect(s.even.nights).toBe(2);
    expect(s.uneven.nights).toBe(1);
  });

  it('counts how each group actually finished', () => {
    const s = trustSummary([evenClose(0), evenClose(1), evenLopsided(2)]);
    expect(s.even).toEqual({ nights: 3, close: 2 });
  });

  it('puts a night right on the threshold in the even group', () => {
    // 0.35 is what the teams board paints green, so it has to mean the same
    // thing here as it did on the night
    expect(trustSummary([night(0.35, 0.1)]).even.nights).toBe(1);
    expect(trustSummary([night(0.36, 0.1)]).uneven.nights).toBe(1);
  });

  it('knows when there is not enough history to say anything', () => {
    expect(trustSummary(many(evenClose, MIN_TRUST_NIGHTS - 1)).enough).toBe(false);
    expect(trustSummary(many(evenClose, MIN_TRUST_NIGHTS)).enough).toBe(true);
  });
});

describe('closeRate', () => {
  it('is null for a group with no nights in it, rather than zero', () => {
    // "0% of no nights finished close" is a sentence that would read as an
    // indictment of something that never happened
    expect(closeRate({ nights: 0, close: 0 })).toBeNull();
    expect(closeRate({ nights: 4, close: 1 })).toBe(0.25);
  });
});

describe('trustVerdict', () => {
  it('says it is too early before the minimum number of nights', () => {
    const points = [...many(evenClose, 3), ...many(unevenLopsided, 3, 3)];
    expect(trustVerdict(trustSummary(points))).toBe('too-early');
  });

  it('says it is too early when every night fell in one group', () => {
    // the common early case: the balancer called all of them even, so there is
    // nothing to compare against
    expect(trustVerdict(trustSummary(many(evenClose, 12)))).toBe('too-early');
  });

  it('reports that the ratings track when the even nights do finish closer', () => {
    const points = [...many(evenClose, 8), ...many(unevenLopsided, 6, 8)];
    expect(trustVerdict(trustSummary(points))).toBe('tracks');
  });

  it('reports no signal when both groups finish much the same', () => {
    // the honest answer, and the one a correlation near zero was trying to give
    const points = [
      ...many(evenClose, 4),
      ...many(evenLopsided, 4, 4),
      ...many(unevenClose, 4, 8),
      ...many(unevenLopsided, 4, 12),
    ];
    expect(trustVerdict(trustSummary(points))).toBe('no-signal');
  });

  it('reports backwards when the nights called even are the lopsided ones', () => {
    const points = [...many(evenLopsided, 8), ...many(unevenClose, 6, 8)];
    expect(trustVerdict(trustSummary(points))).toBe('backwards');
  });

  it('does not call a one-night difference a finding', () => {
    // 5/8 vs 4/8 is twelve points apart and well inside the noise of a sample
    // this size; only a clear gap gets to claim anything
    const points = [
      ...many(evenClose, 5),
      ...many(evenLopsided, 3, 5),
      ...many(unevenClose, 4, 8),
      ...many(unevenLopsided, 4, 12),
    ];
    expect(trustVerdict(trustSummary(points))).toBe('no-signal');
  });
});
