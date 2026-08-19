import { describe, expect, it } from 'vitest';
import { messageFor, triggersFor } from './clock-notifier.js';

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const running = (over = {}) => ({
  period: 'regulation',
  endsAt: NOW + 8 * MIN,
  remaining: 0,
  ended: false,
  ...over,
});

describe('triggersFor', () => {
  it('schedules the one-minute warning and the whistle, in that order', () => {
    const triggers = triggersFor(running(), NOW);
    expect(triggers).toEqual([
      { at: NOW + 7 * MIN, kind: 'one-minute', period: 'regulation' },
      { at: NOW + 8 * MIN, kind: 'time-up', period: 'regulation' },
    ]);
  });

  it('schedules both for added time too — a 2-minute period still gets a warning', () => {
    // the fixture page only ever beeped the one-minute shout in regulation;
    // added time is short enough that the halfway cue is worth having
    const triggers = triggersFor(running({ period: 'added', endsAt: NOW + 2 * MIN }), NOW);
    expect(triggers.map((t) => t.kind)).toEqual(['one-minute', 'time-up']);
    expect(triggers[0]).toMatchObject({ at: NOW + MIN, period: 'added' });
  });

  it('drops a warning that is already in the past', () => {
    // someone starts the clock with 40 seconds left after a pause: announcing
    // "one minute left" now would be a lie, so only the whistle is scheduled
    const triggers = triggersFor(running({ endsAt: NOW + 40_000 }), NOW);
    expect(triggers.map((t) => t.kind)).toEqual(['time-up']);
  });

  it('schedules nothing for a paused clock', () => {
    // pausing nulls endsAt, and a countdown that isn't counting has no moments
    expect(triggersFor(running({ endsAt: null }), NOW)).toEqual([]);
  });

  it('schedules nothing once the period has ended', () => {
    expect(triggersFor(running({ ended: true }), NOW)).toEqual([]);
  });

  it('schedules nothing when there is no clock at all', () => {
    // what the worker sends when the organiser ends the night
    expect(triggersFor(null, NOW)).toEqual([]);
    expect(triggersFor(undefined, NOW)).toEqual([]);
  });

  it('drops everything once the whole period is behind us', () => {
    expect(triggersFor(running({ endsAt: NOW - 1000 }), NOW)).toEqual([]);
  });

  it('is recomputed from the clock alone, so restarting re-arms it', () => {
    // a match ends, the organiser hits Next match and starts again: the same
    // clock shape must produce a fresh pair rather than remembering it fired
    const first = triggersFor(running(), NOW);
    const second = triggersFor(running({ endsAt: NOW + 20 * MIN }), NOW + 12 * MIN);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(second[0].at).toBeGreaterThan(first[1].at);
  });
});

describe('messageFor', () => {
  it('names the moment and never who is playing', () => {
    // these land on lock screens anyone standing nearby can read
    const all = [
      messageFor('one-minute', 'regulation'),
      messageFor('one-minute', 'added'),
      messageFor('time-up', 'regulation'),
      messageFor('time-up', 'added'),
    ];
    for (const m of all) {
      expect(m.title).toBeTruthy();
      expect(m.body).toBeTruthy();
      expect(`${m.title} ${m.body}`).not.toMatch(/black|white|blue/i);
    }
  });

  it('distinguishes full time from the end of added time', () => {
    expect(messageFor('time-up', 'regulation').title).toContain('Full time');
    expect(messageFor('time-up', 'added').body).toContain('penalties');
  });

  it('says the same thing at one minute in either period, with different advice', () => {
    const reg = messageFor('one-minute', 'regulation');
    const add = messageFor('one-minute', 'added');
    expect(reg.title).toBe(add.title);
    expect(reg.body).not.toBe(add.body);
  });
});
