import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Leaderboard } from '../leaderboards';
import Leaderboards from './Leaderboards';

// The podium cards (§2.36). The ranking rule is `leaderboards.ts`'s job and
// has its own tests; what matters here is that a rank, a name and the count
// behind it are all on screen together — a podium that showed a name without
// its number would be asserting a ranking rather than reporting a count.

const board = (over: Partial<Leaderboard> = {}): Leaderboard => ({
  key: 'wins',
  icon: '🥇',
  title: 'Most match wins',
  unit: 'win',
  half: true,
  entries: [
    { id: 'a', name: 'אופק', value: 123, rank: 1 },
    { id: 'b', name: 'ניב', value: 98.5, rank: 2 },
    { id: 'c', name: 'טום', value: 90, rank: 3 },
  ],
  ...over,
});

describe('Leaderboards', () => {
  it('renders nothing at all when there are no boards', () => {
    // The young-club state. Said once by the page, not six times over.
    const { container } = render(<Leaderboards boards={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows every name with the count that earned it', () => {
    render(<Leaderboards boards={[board()]} />);
    expect(screen.getByText('Most match wins', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('אופק')).toBeInTheDocument();
    expect(screen.getByText('123')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
  });

  it('prints a half win as a half, not as a rounded whole', () => {
    // A match taken on penalties is worth half (§2.8), so the total can carry
    // one — and 98.5 rounded to 99 would be a different claim.
    render(<Leaderboards boards={[board()]} />);
    expect(screen.getByText('98.5')).toBeInTheDocument();
  });

  it('draws whole counts without a decimal point', () => {
    render(
      <Leaderboards
        boards={[board({ key: 'mvp', half: false, unit: 'pick', entries: [{ id: 'a', name: 'אופק', value: 7, rank: 1 }] })]}
      />,
    );
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByText('7.0')).not.toBeInTheDocument();
  });

  it('pluralises the unit, and leaves a single one alone', () => {
    render(
      <Leaderboards
        boards={[
          board({
            key: 'active-run',
            half: false,
            unit: 'night',
            entries: [
              { id: 'a', name: 'אופק', value: 3, rank: 1 },
              { id: 'b', name: 'ניב', value: 1, rank: 2 },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText('nights')).toBeInTheDocument();
    expect(screen.getByText('night')).toBeInTheDocument();
  });

  it('draws more than three names when a tie earns it', () => {
    // Ties share a rank, so a board can be longer than its three ranks. Both
    // players level on second must appear — printing one and hiding the other
    // would need a rule the data does not supply.
    render(
      <Leaderboards
        boards={[
          board({
            entries: [
              { id: 'a', name: 'אופק', value: 10, rank: 1 },
              { id: 'b', name: 'ניב', value: 8, rank: 2 },
              { id: 'c', name: 'טום', value: 8, rank: 2 },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText('ניב')).toBeInTheDocument();
    expect(screen.getByText('טום')).toBeInTheDocument();
    expect(screen.getAllByText('2')).toHaveLength(2);
  });

  it('draws each board it is given', () => {
    const { container } = render(
      <Leaderboards boards={[board(), board({ key: 'mvp', title: 'Most MVP picks' })]} />,
    );
    expect(container.querySelectorAll('section')).toHaveLength(2);
  });
});
