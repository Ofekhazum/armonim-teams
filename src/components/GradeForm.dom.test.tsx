import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { playerGradeSeries, type AllMarks } from '../gradeHistory';
import type { FixtureRecord } from '../types';
import GradeForm from './GradeForm';

// The form panel (§2.40). The windowing is tested in gradeHistory.test.ts;
// what matters here is what a reader gets — that the default really is the
// short window, that the strip shows the last five and no more, and that the
// columns stay inside what a night in this app actually records.

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

interface Spec {
  id: string;
  days: number;
  grade: number;
  wins?: number;
  mvp?: boolean;
  shirt?: 'black' | 'white' | 'blue';
}

const build = (spec: Spec[]) => {
  const history: FixtureRecord[] = spec.map((s) => {
    const shirt = s.shirt ?? 'black';
    const teams = { black: [] as string[], white: [] as string[], blue: [] as string[] };
    teams[shirt] = ['a'];
    // somebody on each other shirt, so a place can be worked out at all
    if (shirt !== 'white') teams.white.push('x');
    if (shirt !== 'blue') teams.blue.push('y');
    if (shirt !== 'black') teams.black.push('z');
    return {
      id: s.id,
      date: daysAgo(s.days),
      teams,
      players: ['a', 'x', 'y', 'z'].map((id) => ({ id, name: id, rating: 3 })),
      wins: { black: 1, white: 1, blue: 1, [shirt]: s.wins ?? 5 } as FixtureRecord['wins'],
      ...(s.mvp ? { mvpId: 'a' } : {}),
    };
  });
  const marks: AllMarks = {};
  for (const s of spec) marks[s.id] = { a: s.grade };
  return playerGradeSeries(history, marks, 'a');
};

const SEVEN = Array.from({ length: 7 }, (_, i) => ({
  id: `n${i}`,
  days: 2 + i * 3,
  grade: 4 + i * 0.5,
}));

describe('GradeForm', () => {
  it('opens on the one-month window', () => {
    render(<GradeForm points={build([{ id: 'a', days: 2, grade: 8 }, { id: 'b', days: 200, grade: 5 }])} />);
    expect(screen.getByRole('button', { name: '1M' })).toHaveAttribute('aria-pressed', 'true');
    // only the recent night is in the table
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + one night
  });

  it('offers every range asked for, and widens on tap', () => {
    render(<GradeForm points={build([{ id: 'a', days: 2, grade: 8 }, { id: 'b', days: 200, grade: 5 }])} />);
    for (const label of ['1M', '3M', '6M', '1Y', 'All']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + two nights
  });

  it('shows at most five squares, however long the window', () => {
    // The strip is "recent form", not the whole season — seven nights in
    // range must still draw five blocks.
    render(<GradeForm points={build(SEVEN)} />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    const blocks = document.querySelectorAll('span.h-7.w-7');
    expect(blocks).toHaveLength(5);
  });

  it('colours the squares by the mark rather than painting them all alike', () => {
    render(<GradeForm points={build([
      { id: 'good', days: 2, grade: 9 },
      { id: 'bad', days: 5, grade: 3 },
    ])} />);
    const classes = [...document.querySelectorAll('span.h-7.w-7')].map((b) => b.className);
    expect(classes.some((c) => c.includes('emerald'))).toBe(true);
    expect(classes.some((c) => c.includes('rose'))).toBe(true);
  });

  it('puts the newest night at the top of the table', () => {
    render(<GradeForm points={build([
      { id: 'older', days: 20, grade: 4 },
      { id: 'newest', days: 1, grade: 9 },
    ])} />);
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('9')).toBeInTheDocument();
  });

  it('summarises the last five: nights won and MVPs', () => {
    render(<GradeForm points={build([
      { id: 'a', days: 2, grade: 9, wins: 5, mvp: true },
      { id: 'b', days: 6, grade: 4, wins: 0 },
    ])} />);
    expect(screen.getByText(/won of last 2/)).toBeInTheDocument();
    expect(screen.getByText(/MVP of last 2/)).toBeInTheDocument();
  });

  it('never shows a column this app does not record', () => {
    // §2.24 — no goals, no assists, no xG, no minutes. The screens this is
    // modelled on have all four, and inventing them here is the same offence
    // as inventing them in the banter.
    render(<GradeForm points={build(SEVEN)} />);
    const text = (document.body.textContent ?? '').toLowerCase();
    for (const word of ['xg', 'goal', 'assist', 'minute', ' gls', ' ast']) {
      expect(text).not.toContain(word);
    }
  });

  it('folds a long table and opens it again', () => {
    render(<GradeForm points={build(Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      days: 1 + i * 2,
      grade: 6,
    })))} />);
    expect(screen.getAllByRole('row')).toHaveLength(9); // header + PAGE
    fireEvent.click(screen.getByRole('button', { name: /All 12 nights/ }));
    expect(screen.getAllByRole('row')).toHaveLength(13);
    fireEvent.click(screen.getByRole('button', { name: /Show fewer/ }));
    expect(screen.getAllByRole('row')).toHaveLength(9);
  });

  it('marks a shared placing, so a gold 1 never contradicts "0 won"', () => {
    // Both teams level at the top: §2.6 says nobody took the night, so the
    // summary reads 0 won while the medal still says first. "=1" is what
    // stops that looking like a bug.
    const history: FixtureRecord[] = [
      {
        id: 'tie',
        date: daysAgo(2),
        teams: { black: ['a'], white: ['x'], blue: ['y'] },
        players: ['a', 'x', 'y'].map((id) => ({ id, name: id, rating: 3 })),
        wins: { black: 4, white: 4, blue: 1 },
      },
    ];
    render(<GradeForm points={playerGradeSeries(history, { tie: { a: 7 } }, 'a')} />);
    expect(screen.getByText('=1')).toBeInTheDocument();
    // The summary sits beside its label, so read the pair rather than a bare
    // "0" — both the won and MVP tiles show one.
    const wonLabel = screen.getByText(/won of last 1/);
    expect(wonLabel.parentElement?.textContent).toMatch(/^0/);
  });

  it('says the window is empty rather than looking broken', () => {
    render(<GradeForm points={build([{ id: 'old', days: 200, grade: 6 }])} />);
    expect(screen.getByText(/No graded nights in this window/)).toBeInTheDocument();
    expect(screen.getByText(/Try a longer one/)).toBeInTheDocument();
  });

  it('works for a player with exactly one graded night', () => {
    // The club's real state the day this shipped.
    render(<GradeForm points={build([{ id: 'only', days: 1, grade: 7 }])} />);
    expect(document.querySelectorAll('span.h-7.w-7')).toHaveLength(1);
    expect(screen.getByText(/last 1 night$/)).toBeInTheDocument();
  });
});
