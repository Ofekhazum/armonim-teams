import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { playerGradeSeries, type AllMarks } from '../gradeHistory';
import type { FixtureRecord } from '../types';
import GradeGraph from './GradeGraph';

// The form graph (§2.39). The windowing arithmetic is tested in
// gradeHistory.test.ts; what matters here is what a reader actually gets — that
// the default really is the short window, that a single night draws something
// rather than nothing, and that the y-axis does not quietly rescale itself to
// flatter whoever is being looked at.

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

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

const series = (spec: { id: string; days: number; grade: number }[]) => {
  const history = spec.map((s) => fx(s.id, daysAgo(s.days)));
  const marks: AllMarks = {};
  for (const s of spec) marks[s.id] = { a: s.grade };
  return playerGradeSeries(history, marks, 'a');
};

const RECENT_AND_OLD = [
  { id: 'now', days: 2, grade: 8 },
  { id: 'alsoNow', days: 9, grade: 6 },
  { id: 'old', days: 200, grade: 4 },
];

describe('GradeGraph', () => {
  it('opens on the one-month window, not the whole career', () => {
    // The requirement that a full history is too cluttered to be the default.
    render(<GradeGraph points={series(RECENT_AND_OLD)} />);
    expect(screen.getByRole('button', { name: '1M' })).toHaveAttribute('aria-pressed', 'true');
    // Two of the three nights are inside a month, and the label says so.
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Grades over time: 2 nights');
  });

  it('widens when a longer range is chosen', () => {
    render(<GradeGraph points={series(RECENT_AND_OLD)} />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Grades over time: 3 nights');
  });

  it('offers every range asked for', () => {
    render(<GradeGraph points={series(RECENT_AND_OLD)} />);
    for (const label of ['1M', '3M', '6M', '1Y', 'All']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('draws a single night as a point rather than nothing', () => {
    // The club's real state on the day this shipped: one published night. A
    // line needs two, so this must not come out blank.
    render(<GradeGraph points={series([{ id: 'only', days: 1, grade: 7 }])} />);
    expect(document.querySelectorAll('circle')).toHaveLength(1);
    expect(document.querySelector('polyline')).toBeNull();
  });

  it('joins two or more nights with a line', () => {
    render(<GradeGraph points={series([{ id: 'x', days: 1, grade: 7 }, { id: 'y', days: 5, grade: 4 }])} />);
    expect(document.querySelector('polyline')).not.toBeNull();
  });

  it('says the window is empty rather than looking broken', () => {
    render(<GradeGraph points={series([{ id: 'old', days: 200, grade: 6 }])} />);
    expect(screen.getByText(/No graded nights in this window/)).toBeInTheDocument();
    // …and points the way out, since there is something to find further back.
    expect(screen.getByText(/Try a longer one/)).toBeInTheDocument();
  });

  it('pins the axis to the full scale, so a flat run looks flat', () => {
    // The decision this component exists to get right. Two marks half a point
    // apart must not fill the plot the way a collapse would: their vertical
    // gap has to stay a small fraction of the chart's height.
    const flat = series([{ id: 'x', days: 1, grade: 6 }, { id: 'y', days: 8, grade: 6.5 }]);
    render(<GradeGraph points={flat} />);
    const ys = [...document.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cy')));
    const spread = Math.abs(ys[0] - ys[1]);
    // half a mark out of nine, across a ~104px plot — single digits of pixels
    expect(spread).toBeGreaterThan(0);
    expect(spread).toBeLessThan(12);
  });

  // The readout mixes an element and bare text (`<b>6</b> on 18/8`), and
  // getByText joins only an element's *direct* text children — so it sees
  // "on 18/8" rather than the whole line. Reading textContent off the span is
  // both what a person actually sees and less brittle than matching a fragment.
  const readout = () => document.querySelector('span.ms-auto')?.textContent ?? '';

  it('shows the average of what is on screen until a night is picked', () => {
    render(<GradeGraph points={series([{ id: 'x', days: 1, grade: 8 }, { id: 'y', days: 8, grade: 6 }])} />);
    expect(readout()).toBe('average 7');
  });

  it('reads out the night under the pointer, then lets it go again', () => {
    render(<GradeGraph points={series([{ id: 'x', days: 1, grade: 8 }, { id: 'y', days: 8, grade: 6 }])} />);
    const targets = document.querySelectorAll('rect');
    fireEvent.pointerDown(targets[0]);
    expect(readout()).toMatch(/^6 on \d+\/\d+$/); // oldest first, so the 6
    // tapping the same night again clears it, rather than trapping the readout
    fireEvent.pointerDown(targets[0]);
    expect(readout()).toBe('average 7');
  });

  it('gives every night a hit target far larger than its dot', () => {
    // Fifty nights across 300px puts the dots closer together than a
    // fingertip, so the column is the target rather than the circle.
    render(<GradeGraph points={series([{ id: 'x', days: 1, grade: 8 }, { id: 'y', days: 8, grade: 6 }])} />);
    const rects = [...document.querySelectorAll('rect')];
    expect(rects).toHaveLength(2);
    for (const r of rects) expect(Number(r.getAttribute('width'))).toBeGreaterThan(20);
  });
});
