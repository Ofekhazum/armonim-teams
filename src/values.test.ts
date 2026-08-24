import { describe, expect, it } from 'vitest';
import { formatValue, moveOf } from './values';

describe('formatValue', () => {
  it('writes a price the way a price is written', () => {
    expect(formatValue(14.5)).toBe('€14.5M');
    expect(formatValue(6)).toBe('€6M');
    expect(formatValue(6.25)).toBe('€6.25M');
    expect(formatValue(10)).toBe('€10M');
  });

  it('keeps the quarter, which is the whole step size', () => {
    // Trimming too eagerly turns €6.25M into €6.2M and loses the distinction
    // between two adjacent prices.
    expect(formatValue(6.75)).toBe('€6.75M');
    expect(formatValue(6.5)).toBe('€6.5M');
  });
});

describe('moveOf', () => {
  it('reads a rise and a fall', () => {
    expect(moveOf({ value: 8.5, previous: 8 })).toEqual({ dir: 'up', by: 0.5 });
    expect(moveOf({ value: 8, previous: 8.75 })).toEqual({ dir: 'down', by: 0.75 });
  });

  it('calls a first valuation new rather than flat', () => {
    // Drawing "no change" over a price with nothing behind it claims a
    // stability nobody has observed.
    expect(moveOf({ value: 6, previous: null })).toEqual({ dir: 'new' });
  });

  it('calls an unchanged price flat', () => {
    expect(moveOf({ value: 6.25, previous: 6.25 })).toEqual({ dir: 'flat' });
  });

  it('does not let floating point invent a move', () => {
    // 8.8 - 8.55 is 0.25000000000000089 in binary, which would render as
    // €0.25000000000000089M on somebody's profile.
    const move = moveOf({ value: 8.8, previous: 8.55 });
    expect(move).toEqual({ dir: 'up', by: 0.25 });
  });
});
