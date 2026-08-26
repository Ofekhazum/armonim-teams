import { describe, expect, it } from 'vitest';
import type { FixtureRecord } from './types';
import {
  DEFAULT_RANGE,
  RANGES,
  inRange,
  meanGrade,
  playerGradeSeries,
  rangeCounts,
  type AllMarks,
} from './gradeHistory';

// A player's marks as a series (§2.39). The windowing is the part worth
// testing without a DOM: what counts as "in the last month", what happens to a
// night nobody graded, and whether the default view can be trusted to be the
// short one.

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-26');
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

const fx = (id: string, date: string): FixtureRecord => ({
  id,
  date,
  teams: { black: ['a'], white: ['b'], blue: [] },
  players: [
    { id: 'a', name: 'a', rating: 3 },
    { id: 'b', name: 'b', rating: 3 },
  ],
  wins: { black: 4, white: 2, blue: 0 },
});

describe('playerGradeSeries', () => {
  it('returns a point per graded night, oldest first', () => {
    const history = [fx('f2', '2026-08-20'), fx('f1', '2026-08-06'), fx('f3', '2026-08-13')];
    const marks: AllMarks = { f1: { a: 5 }, f2: { a: 8 }, f3: { a: 6.5 } };
    const series = playerGradeSeries(history, marks, 'a');
    expect(series.map((p) => p.date)).toEqual(['2026-08-06', '2026-08-13', '2026-08-20']);
    expect(series.map((p) => p.grade)).toEqual([5, 6.5, 8]);
  });

  it('leaves out a night that was played but never graded', () => {
    // Not a zero and not a gap in the line's arithmetic — a night with no
    // published mark is a night with no data, and plotting it at zero would
    // read as the worst evening of somebody's career.
    const history = [fx('f1', '2026-08-06'), fx('f2', '2026-08-13')];
    const series = playerGradeSeries(history, { f1: { a: 5 } }, 'a');
    expect(series).toHaveLength(1);
    expect(series[0].fixtureId).toBe('f1');
  });

  it('leaves out a night somebody else was graded for', () => {
    const history = [fx('f1', '2026-08-06')];
    expect(playerGradeSeries(history, { f1: { b: 7 } }, 'a')).toEqual([]);
  });

  it('is empty rather than throwing when nothing is published at all', () => {
    expect(playerGradeSeries([fx('f1', '2026-08-06')], {}, 'a')).toEqual([]);
  });

  it('ignores a mark that is not a number', () => {
    const marks = { f1: { a: 'great' } } as unknown as AllMarks;
    expect(playerGradeSeries([fx('f1', '2026-08-06')], marks, 'a')).toEqual([]);
  });
});

describe('inRange', () => {
  const history = [
    fx('recent', daysAgo(3)),
    fx('lastMonth', daysAgo(20)),
    fx('twoMonths', daysAgo(60)),
    fx('halfYear', daysAgo(150)),
    fx('ages', daysAgo(400)),
  ];
  const marks: AllMarks = {
    recent: { a: 8 },
    lastMonth: { a: 6 },
    twoMonths: { a: 5 },
    halfYear: { a: 7 },
    ages: { a: 4 },
  };
  const series = playerGradeSeries(history, marks, 'a');

  it('keeps only the nights inside the window', () => {
    expect(inRange(series, '1M', NOW).map((p) => p.fixtureId)).toEqual(['lastMonth', 'recent']);
    expect(inRange(series, '3M', NOW).map((p) => p.fixtureId)).toEqual([
      'twoMonths',
      'lastMonth',
      'recent',
    ]);
  });

  it('widens as the range widens, never narrowing', () => {
    const sizes = RANGES.map((r) => inRange(series, r.id, NOW).length);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
  });

  it('keeps everything on All', () => {
    expect(inRange(series, 'ALL', NOW)).toHaveLength(5);
  });

  it('is anchored to now, so a player who stopped turning up has an empty month', () => {
    // The deliberate consequence of a window that means what it says — and
    // the reason the empty state points at a longer range rather than
    // pretending the graph is broken.
    const stale = playerGradeSeries([fx('old', daysAgo(90))], { old: { a: 7 } }, 'a');
    expect(inRange(stale, '1M', NOW)).toEqual([]);
    expect(inRange(stale, '6M', NOW)).toHaveLength(1);
  });

  it('includes a night exactly on the boundary', () => {
    const edge = playerGradeSeries([fx('edge', daysAgo(30))], { edge: { a: 7 } }, 'a');
    expect(inRange(edge, '1M', NOW)).toHaveLength(1);
  });
});

describe('the default range', () => {
  it('is the shortest one on offer', () => {
    // A season drawn across a phone is a line with no shape in it; the point
    // of opening a profile is current form. Asserted rather than trusted,
    // because this is a product decision that a later tidy-up could undo.
    expect(DEFAULT_RANGE).toBe('1M');
    expect(RANGES[0].id).toBe(DEFAULT_RANGE);
    const days = RANGES.map((r) => r.days ?? Infinity);
    expect(Math.min(...days)).toBe(RANGES[0].days);
  });
});

describe('meanGrade and rangeCounts', () => {
  it('averages what is on screen', () => {
    const series = playerGradeSeries(
      [fx('f1', daysAgo(1)), fx('f2', daysAgo(2))],
      { f1: { a: 8 }, f2: { a: 6 } },
      'a',
    );
    expect(meanGrade(series)).toBe(7);
  });

  it('has no average for nothing', () => {
    expect(meanGrade([])).toBeNull();
  });

  it('counts every range, so the controls can show which are empty', () => {
    const series = playerGradeSeries([fx('old', daysAgo(200))], { old: { a: 7 } }, 'a');
    const counts = rangeCounts(series, NOW);
    expect(counts['1M']).toBe(0);
    expect(counts['3M']).toBe(0);
    expect(counts['1Y']).toBe(1);
    expect(counts.ALL).toBe(1);
  });
});
