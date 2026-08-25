import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FixtureRecord, MatchLogEntry } from '../types';
import PlayerCompare from './PlayerCompare';

// The comparison panel (§2.37). The arithmetic is `compare.ts`'s and is tested
// there; here it is the empty state, the two pickers, and the one thing this
// screen must never do — declare a winner between two named friends.

let seq = 0;
const night = (
  black: string[],
  white: string[],
  wins: { black: number; white: number; blue: number },
  matchLog?: MatchLogEntry[],
): FixtureRecord => {
  seq++;
  return {
    id: `f${seq}`,
    date: `2026-01-${String(seq).padStart(2, '0')}`,
    teams: { black, white, blue: [] },
    players: [...black, ...white].map((id) => ({ id, name: id, rating: 3 })),
    wins,
    ...(matchLog ? { matchLog } : {}),
  };
};

const bw = (winner: 'black' | 'white'): MatchLogEntry => ({ a: 'black', b: 'white', winner, viaPenalties: false });

const HISTORY = [
  night(['אופק'], ['ניב'], { black: 3, white: 1, blue: 0 }, [bw('black'), bw('black'), bw('white')]),
  night(['אופק'], ['ניב'], { black: 3, white: 1, blue: 0 }),
];

const OPTIONS = [
  { id: 'אופק', name: 'אופק' },
  { id: 'ניב', name: 'ניב' },
];

const panel = () => render(<PlayerCompare history={HISTORY} options={OPTIONS} />);

const pick = (label: string, id: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value: id } });

describe('PlayerCompare', () => {
  it('starts empty, and says what to do', () => {
    // No arbitrary default pair: the app has no idea who is holding the phone.
    panel();
    expect(screen.getByText(/Pick two players to put their records side by side/)).toBeInTheDocument();
    expect(screen.queryByText('Nights played')).not.toBeInTheDocument();
  });

  it('needs both halves before it compares anything', () => {
    panel();
    pick('Pick a player…', 'אופק');
    expect(screen.queryByText('Nights played')).not.toBeInTheDocument();
  });

  it('refuses to compare somebody with themselves, and says so', () => {
    panel();
    pick('Pick a player…', 'אופק');
    pick('Pick another…', 'אופק');
    expect(screen.getByText('Pick two different players.')).toBeInTheDocument();
  });

  it('lines both records up once two are picked', () => {
    panel();
    pick('Pick a player…', 'אופק');
    pick('Pick another…', 'ניב');
    expect(screen.getByText('Nights played')).toBeInTheDocument();
    expect(screen.getByText('Match wins')).toBeInTheDocument();
    expect(screen.getByText('Per night')).toBeInTheDocument();
  });

  it('never declares a winner', () => {
    // The one rule this screen has. A tick, a crown or the word "leads" would
    // turn a comparison of two friends into a verdict the counts cannot carry.
    panel();
    pick('Pick a player…', 'אופק');
    pick('Pick another…', 'ניב');
    const text = document.body.textContent ?? '';
    for (const word of ['leads', 'winner', 'better', 'best', 'wins the', '👑', '✅']) {
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it('says teams beat teams, not people', () => {
    // §2.8 — the app has never recorded an individual beating anybody.
    panel();
    pick('Pick a player…', 'אופק');
    pick('Pick another…', 'ניב');
    expect(screen.getByText(/'s team has beaten/)).toBeInTheDocument();
    expect(screen.getByText(/of/)).toBeInTheDocument();
  });

  it('says when a night was never written down match by match', () => {
    const tallied = [night(['אופק'], ['ניב'], { black: 3, white: 1, blue: 0 })];
    render(<PlayerCompare history={tallied} options={OPTIONS} />);
    pick('Pick a player…', 'אופק');
    pick('Pick another…', 'ניב');
    expect(screen.getByText(/no head-to-head to read/)).toBeInTheDocument();
  });

  it('handles two players who have never shared a sheet', () => {
    const apart = [
      night(['אופק'], ['x'], { black: 3, white: 1, blue: 0 }),
      night(['ניב'], ['y'], { black: 3, white: 1, blue: 0 }),
    ];
    render(<PlayerCompare history={apart} options={OPTIONS} />);
    pick('Pick a player…', 'אופק');
    pick('Pick another…', 'ניב');
    expect(screen.getByText(/never been on the same team sheet/)).toBeInTheDocument();
    // and their own records still show
    expect(screen.getByText('Nights played')).toBeInTheDocument();
  });

  it('leaves the bar empty when both sides are zero', () => {
    // "0 against 0" is not a dead heat, it is nothing to compare — so the
    // track must not be split half and half.
    const { container } = render(<PlayerCompare history={HISTORY} options={OPTIONS} />);
    pick('Pick a player…', 'אופק');
    pick('Pick another…', 'ניב');
    const bars = [...container.querySelectorAll('div[dir="ltr"]')];
    const mvpBar = bars[4]; // rows: nights, nights won, match wins, per night, MVP picks
    expect(mvpBar.children).toHaveLength(0);
  });
});
