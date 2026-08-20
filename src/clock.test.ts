import { describe, expect, it } from 'vitest';
import { REGULATION_MS, withAddedTime, type ClockState } from './types';

// The clock keeps its time in one of two places depending on whether it is
// moving, and adding to the wrong one silently discards the time — the button
// appears to work and the match ends thirty seconds early. Which is exactly the
// sort of thing nobody notices until it matters.

const NOW = 1_700_000_000_000;
const SEC = 1000;
const clock = (over: Partial<ClockState> = {}): ClockState => ({
  period: 'regulation',
  endsAt: null,
  remaining: REGULATION_MS,
  ended: false,
  ...over,
});

describe('withAddedTime', () => {
  it('moves the end of a running clock, leaving it running', () => {
    const before = clock({ endsAt: NOW + 120 * SEC, remaining: 0 });
    const after = withAddedTime(before, 30 * SEC, NOW);
    expect(after.endsAt).toBe(NOW + 150 * SEC);
    expect(after.ended).toBe(false);
  });

  it('grows what is left on a paused clock, leaving it paused', () => {
    const after = withAddedTime(clock({ remaining: 90 * SEC }), 30 * SEC, NOW);
    expect(after).toMatchObject({ endsAt: null, remaining: 120 * SEC, ended: false });
  });

  it('adds to a match that has not kicked off yet', () => {
    const after = withAddedTime(clock(), 30 * SEC, NOW);
    expect(after.remaining).toBe(REGULATION_MS + 30 * SEC);
    expect(after.endsAt).toBeNull();
  });

  it('gives the time back to a match that has already ended, and un-ends it', () => {
    const after = withAddedTime(clock({ remaining: 0, ended: true }), 30 * SEC, NOW);
    expect(after).toMatchObject({ remaining: 30 * SEC, ended: false, endsAt: null });
  });

  it('leaves an ended match stopped rather than restarting it', () => {
    // restarting is a separate decision from giving the time back; merging the
    // two would have a match resume in somebody's pocket
    expect(withAddedTime(clock({ remaining: 0, ended: true }), 30 * SEC, NOW).endsAt).toBeNull();
  });

  it('gives a full thirty seconds to a clock that ran out while still running', () => {
    // endsAt is in the past but nobody has pressed anything yet. Adding to
    // endsAt here would hand back thirty seconds minus however long the ball
    // has been out of play — which on a phone in a pocket could be all of it.
    const ranOutLongAgo = clock({ endsAt: NOW - 45 * SEC, remaining: 0 });
    const after = withAddedTime(ranOutLongAgo, 30 * SEC, NOW);
    expect(after).toMatchObject({ endsAt: null, remaining: 30 * SEC, ended: false });
  });

  it('adds up across repeated presses', () => {
    let c = clock({ endsAt: NOW + 60 * SEC, remaining: 0 });
    for (let i = 0; i < 3; i++) c = withAddedTime(c, 30 * SEC, NOW);
    expect(c.endsAt).toBe(NOW + 150 * SEC);
  });

  it('keeps the period, so added time stays added time', () => {
    expect(withAddedTime(clock({ period: 'added' }), 30 * SEC, NOW).period).toBe('added');
  });
});
