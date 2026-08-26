import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FixtureRecord, MatchLogEntry, Player } from '../types';
import { winsFromLog } from '../matchLog';
import NightPage from './NightPage';

// Smoke test only: the marks panel (§2.39) has its own suite in
// NightGrades.dom.test.tsx. This just confirms it is actually mounted on the
// page it was built for, since a component that is never imported anywhere
// passes every test written about it and ships nothing.

const roster: Player[] = ['a', 'b', 'c'].map((id) => ({
  id,
  name: id,
  rating: 3,
  attack: 50,
  chemistry: [],
}));

const log: MatchLogEntry[] = [
  { a: 'black', b: 'white', winner: 'black', viaPenalties: false },
  { a: 'black', b: 'blue', winner: 'black', viaPenalties: false },
];

const fixture: FixtureRecord = {
  id: 'f1',
  date: '2026-05-04',
  teams: { black: ['a'], white: ['b'], blue: ['c'] },
  players: roster.map((p) => ({ id: p.id, name: p.name, rating: p.rating })),
  wins: winsFromLog(log),
  matchLog: log,
};

describe('NightPage', () => {
  it('mounts the marks panel below the report', () => {
    render(
      <NightPage
        fixture={fixture}
        history={[fixture]}
        players={roster}
        adminWord="word"
        older={null}
        newer={null}
        onGo={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('📋 The marks')).toBeInTheDocument();
    expect(screen.getByText('✍️ Write the marks')).toBeInTheDocument();
  });
});
