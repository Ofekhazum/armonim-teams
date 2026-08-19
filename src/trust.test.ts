import { describe, expect, it } from 'vitest';
import { MIN_TRUST_NIGHTS, trustCorrelation, trustPoints, type TrustPoint } from './trust';
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
