import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Arcs } from '../playerArcs';
import NightParts from './NightParts';

// The "across the night" chart (§2.23), after the redesign and after four
// parts became three. Every number the original version showed was true and
// it was still unreadable — so what is tested here is the readability, which
// means the things a reader has to be able to tell apart.

const arcs = (parts: [number, number][], over: Partial<Arcs> = {}): Arcs => {
  const ps = parts.map(([won, played]) => ({ won, played }));
  return {
    loggedNights: 10,
    matches: ps.reduce((n, p) => n + p.played, 0),
    won: ps.reduce((n, p) => n + p.won, 0),
    parts: ps,
    early: { won: 0, played: 0 },
    late: { won: 0, played: 0 },
    bounce: { won: 0, played: 0 },
    ...over,
  };
};

const bars = (container: HTMLElement) =>
  [...container.querySelectorAll('.rounded-t-md')] as HTMLElement[];

describe('the "across the night" chart', () => {
  it('states the rate as a percentage, not as a bare fraction', () => {
    // The old card's `32/49` made the reader do the division before they could
    // compare two bars — and then compare against nothing.
    render(<NightParts arcs={arcs([[5, 10], [8, 10], [3, 10]])} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('keeps the raw count underneath as the evidence', () => {
    // A percentage off three matches and one off forty look identical without
    // it, which is how a card starts overclaiming.
    render(<NightParts arcs={arcs([[5, 10], [8, 12], [3, 9]])} />);
    expect(screen.getByText('8 of 12')).toBeInTheDocument();
  });

  it('gives the reader something to read the bars against', () => {
    // The whole point of the redesign. A bar at 65% means nothing alone: three
    // teams share one pitch, so "good" is near 50%, not near 100%.
    render(<NightParts arcs={arcs([[6, 10], [4, 10], [5, 10]])} />);
    expect(screen.getByText(/dashed line is their/)).toBeInTheDocument();
    expect(screen.getByText('50%', { selector: 'b' })).toBeInTheDocument();
  });

  it('draws the average line at the same height a bar of that rate would reach', () => {
    // The bars and the line have to share one coordinate space or the
    // comparison the card is built around is a lie. Bars are 40%/60% of a
    // track with no padding; the average is 50%, so the line sits at 50%.
    const { container } = render(<NightParts arcs={arcs([[4, 10], [6, 10], [5, 10]])} />);
    const line = container.querySelector('[aria-hidden].border-dashed') as HTMLElement;
    expect(line.style.bottom).toBe('50%');
    expect(bars(container)[0].style.height).toBe('40%');
    expect(bars(container)[1].style.height).toBe('60%');
  });

  it('distinguishes a part nobody played from one they lost every match of', () => {
    // Zero height would read as "played and lost them all" — the same
    // distinction the medal ribbon draws between no result and third place.
    const { container } = render(<NightParts arcs={arcs([[0, 8], [0, 0], [4, 8]])} />);
    expect(screen.getByText('none played')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();

    // lost the lot: a visible bar at the floor. never played: no bar at all.
    expect(bars(container)[0].style.height).toBe('2%');
    expect(bars(container)[1].style.height).toBe('0px');
  });

  it('is beginning, middle and end — not 1st/2nd/3rd/4th quarter', () => {
    render(<NightParts arcs={arcs([[5, 10], [5, 10], [5, 10]])} />);
    for (const label of ['Beginning', 'Middle', 'End']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText(/quarter/i)).not.toBeInTheDocument();
  });

  it('survives a player with no logged matches at all without dividing by zero', () => {
    render(<NightParts arcs={arcs([[0, 0], [0, 0], [0, 0]])} />);
    expect(screen.getAllByText('none played')).toHaveLength(3);
    expect(screen.getByText('0%', { selector: 'b' })).toBeInTheDocument();
  });
});
