import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Derby } from '../derby';
import DerbyBanner from './DerbyBanner';

// The derby banner (§2.33). The metric has its own tests; what matters on
// screen is that the card stays symmetric — this is the one pick in the app
// with no subject, and a layout that favours one side would imply a claim the
// arithmetic never made.

const derby = (over: Partial<Derby> = {}): Derby => ({
  aId: 'a',
  aName: 'אופק',
  aShirt: 'black',
  aWon: 7,
  bId: 'b',
  bName: 'ניב',
  bShirt: 'white',
  bWon: 7,
  faced: 14,
  contested: 14,
  ...over,
});

describe('the derby banner', () => {
  it('renders nothing when there is no derby', () => {
    // Most of the club's life, and every young club — same shape as the price
    // tag: not-yet is a state, not an error worth a sentence.
    const { container } = render(<DerbyBanner derby={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names both players and the scoreline between them', () => {
    render(<DerbyBanner derby={derby()} />);
    expect(screen.getByText('אופק')).toBeInTheDocument();
    expect(screen.getByText('ניב')).toBeInTheDocument();
    expect(screen.getByText('7–7')).toBeInTheDocument();
  });

  it('gives both names the same weight', () => {
    // The symmetry test. Every other pick in this app has a subject; this one
    // does not, and the moment one name is bigger the reader decides the other
    // is the underdog.
    render(<DerbyBanner derby={derby({ aWon: 9, bWon: 5 })} />);
    const a = screen.getByText('אופק').closest('span')!;
    const b = screen.getByText('ניב').closest('span')!;
    expect(a.className).toBe(b.className);
  });

  it('says what was counted, so the scoreline cannot be read as goals', () => {
    // This app has never counted a goal in its life (§2.9), and "7–7" beside
    // two names is exactly what a goal tally looks like.
    render(<DerbyBanner derby={derby()} />);
    expect(screen.getByText(/14 matches on opposite sides/)).toBeInTheDocument();
  });

  it('calls a level record level', () => {
    render(<DerbyBanner derby={derby({ aWon: 7, bWon: 7 })} />);
    expect(screen.getByText(/dead level/)).toBeInTheDocument();
  });

  it('lets an uneven record speak for itself', () => {
    render(<DerbyBanner derby={derby({ aWon: 9, bWon: 5, faced: 14 })} />);
    expect(screen.getByText('9–5')).toBeInTheDocument();
    expect(screen.queryByText(/dead level/)).not.toBeInTheDocument();
  });
});
