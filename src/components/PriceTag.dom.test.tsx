import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PriceTag from './PriceTag';

// The price tag (§2.31). Three things matter on screen and none of them are
// the number: that no price draws *nothing* rather than an absence, that the
// weekly move is legible without colour, and that the caption never lets a
// euro figure read as the app's opinion of somebody.

describe('the price tag', () => {
  it('renders nothing at all when there is no price', () => {
    // Offline, an undeployed Worker, a club under five nights, and a player who
    // has never played are four different reasons that all mean "not yet".
    // None is worth a sentence on somebody's profile.
    const { container } = render(<PriceTag />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the price', () => {
    render(<PriceTag price={{ value: 8.75, previous: 8.5 }} />);
    expect(screen.getByText('€8.75M')).toBeInTheDocument();
  });

  it('says what the number is made of, so it cannot read as a rating', () => {
    // The app does not have opinions about people (§2.9), and a euro figure
    // beside a name is read as one unless it says otherwise.
    render(<PriceTag price={{ value: 8.75, previous: 8.5 }} />);
    expect(screen.getByText(/Results, appearances and honours/)).toBeInTheDocument();
  });

  it('marks a rise with a sign and a glyph, not with a colour alone', () => {
    render(<PriceTag price={{ value: 9, previous: 8.5 }} />);
    expect(screen.getByText('▲ +€0.5M')).toBeInTheDocument();
  });

  it('marks a fall the same way', () => {
    render(<PriceTag price={{ value: 8, previous: 8.75 }} />);
    expect(screen.getByText('▼ −€0.75M')).toBeInTheDocument();
  });

  it('says unchanged rather than drawing a zero', () => {
    render(<PriceTag price={{ value: 6.25, previous: 6.25 }} />);
    expect(screen.getByText('— unchanged')).toBeInTheDocument();
  });

  it('calls a first price a first price', () => {
    render(<PriceTag price={{ value: 6, previous: null }} />);
    expect(screen.getByText('first valuation')).toBeInTheDocument();
    expect(screen.queryByText(/▲|▼/)).not.toBeInTheDocument();
  });
});
