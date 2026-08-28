import { describe, expect, it } from 'vitest';
import type { LiveFixture } from './types';
import { initialClock } from './types';
import { pollDelay } from './live';

// The poll rate is decided by whether a fixture has actually *kicked off*
// (§2.7.2), not merely whether one exists — the whole point being that a
// fixture scheduled for tomorrow must not cost every phone in the group a
// request every two seconds for the next day.

const HOUR = 60 * 60 * 1000;

const fixture = (startedAt: number): LiveFixture => ({
  id: `live-${startedAt}`,
  startedAt,
  players: [],
  teams: { black: [], white: [], blue: [] },
  gkIds: [],
  clock: initialClock(),
});

describe('pollDelay', () => {
  it('polls slowly when nothing is live at all', () => {
    expect(pollDelay(null)).toBe(15_000);
  });

  it('polls slowly for a fixture that is merely scheduled', () => {
    const future = fixture(Date.now() + HOUR);
    expect(pollDelay(future)).toBe(15_000);
  });

  it('polls fast once the fixture has actually kicked off', () => {
    const started = fixture(Date.now() - 1);
    expect(pollDelay(started)).toBe(2_000);
  });

  it('treats the exact kickoff moment as kicked off', () => {
    const rightNow = fixture(Date.now());
    expect(pollDelay(rightNow)).toBe(2_000);
  });
});
