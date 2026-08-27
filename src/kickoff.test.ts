import { describe, expect, it } from 'vitest';
import {
  MAX_SCHEDULE_AHEAD_MS,
  agoLabel,
  hasKickedOff,
  isSchedulable,
  kickoffLabel,
  nextThursday7pm,
  parseLocalKickoff,
  untilKickOff,
} from './kickoff';

// Whether a fixture has kicked off is derived, never stored — every device
// has to reach the same answer from `startedAt` alone (§2.7.2), so the
// boundary here is load-bearing: get it wrong in either direction and either
// a night starts a moment before everyone thinks, or the group waits an extra
// tick for a fixture that has already begun.

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('hasKickedOff', () => {
  it('treats the exact moment as kicked off, not still to come', () => {
    expect(hasKickedOff(NOW, NOW)).toBe(true);
  });

  it('is false a moment before, true a moment after', () => {
    expect(hasKickedOff(NOW + 1, NOW)).toBe(false);
    expect(hasKickedOff(NOW - 1, NOW)).toBe(true);
  });
});

describe('untilKickOff', () => {
  it('never goes negative once kickoff has passed', () => {
    expect(untilKickOff(NOW - HOUR, NOW)).toBe(0);
  });

  it('counts down the honest gap beforehand', () => {
    expect(untilKickOff(NOW + HOUR, NOW)).toBe(HOUR);
  });
});

describe('isSchedulable', () => {
  it('accepts a time inside the lead-time bound', () => {
    expect(isSchedulable(NOW + 6 * DAY, NOW)).toBe(true);
  });

  it('rejects a time past the bound — the guard against a mistyped year', () => {
    expect(isSchedulable(NOW + 8 * DAY, NOW)).toBe(false);
    expect(isSchedulable(NOW + MAX_SCHEDULE_AHEAD_MS + 1, NOW)).toBe(false);
  });

  it('rejects a time that is not actually in the future', () => {
    expect(isSchedulable(NOW, NOW)).toBe(false);
    expect(isSchedulable(NOW - 1, NOW)).toBe(false);
  });
});

describe('parseLocalKickoff', () => {
  it('parses a datetime-local value as local time, not UTC', () => {
    // The trap: reaching for Date.UTC(...) out of a "always use UTC" habit
    // would read a Thursday-evening pick as a different hour entirely for
    // anyone not sitting on UTC. Round-tripping through the local getters is
    // what proves the value was never shifted.
    const at = parseLocalKickoff('2026-08-20T20:00');
    expect(at).not.toBeNull();
    const d = new Date(at!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // August
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(20);
    expect(d.getMinutes()).toBe(0);
  });

  it('refuses a value that does not parse as a date at all', () => {
    expect(parseLocalKickoff('not a date')).toBeNull();
  });
});

describe('nextThursday7pm', () => {
  it('picks the coming Thursday when today is earlier in the week', () => {
    const monday = new Date(2026, 7, 17, 9, 0).getTime(); // Mon 17 Aug 2026
    const d = nextThursday7pm(monday);
    expect(d.getDay()).toBe(4);
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(19);
    expect(d.getMinutes()).toBe(0);
  });

  it('rolls over to next week once this Thursday\'s 19:00 has passed', () => {
    const thursdayNight = new Date(2026, 7, 20, 20, 0).getTime(); // Thu 20:00, past 19:00
    const d = nextThursday7pm(thursdayNight);
    expect(d.getDate()).toBe(27);
  });

  it('still offers this Thursday if it is not 19:00 yet', () => {
    const thursdayMorning = new Date(2026, 7, 20, 9, 0).getTime();
    const d = nextThursday7pm(thursdayMorning);
    expect(d.getDate()).toBe(20);
  });
});

describe('kickoffLabel', () => {
  it('leads with days once more than a day is left', () => {
    expect(kickoffLabel(NOW + 3 * DAY + 4 * HOUR, NOW)).toBe('in 3d 4h');
  });

  it('drops to hours and minutes under a day', () => {
    expect(kickoffLabel(NOW + 2 * HOUR + 15 * MIN, NOW)).toBe('in 2h 15m');
  });

  it('drops to minutes alone under an hour', () => {
    expect(kickoffLabel(NOW + 42 * MIN, NOW)).toBe('in 42m');
  });

  it('shows a clock face under a minute, like the match clock does', () => {
    expect(kickoffLabel(NOW + 37_000, NOW)).toBe('in 0:37');
  });

  it('never reads as a countdown once kickoff has arrived', () => {
    expect(kickoffLabel(NOW, NOW)).toBe('kicking off any moment');
    expect(kickoffLabel(NOW - HOUR, NOW)).toBe('kicking off any moment');
  });
});

describe('agoLabel', () => {
  it('floors under a minute to "just now" — never a negative count', () => {
    expect(agoLabel(NOW, NOW)).toBe('just now');
  });

  it('counts minutes, then hours and minutes past sixty', () => {
    expect(agoLabel(NOW - 42 * MIN, NOW)).toBe('42 min ago');
    expect(agoLabel(NOW - (3 * HOUR + 12 * MIN), NOW)).toBe('3h 12m ago');
  });
});
