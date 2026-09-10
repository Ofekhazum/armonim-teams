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
  // Every property below has to hold in *both* languages (§2.45) — a Hebrew
  // title that truncates on a lock screen is exactly as useless as an English
  // one, and these are the only four sentences this Worker ever says.
  const LANGS = ['he', 'en'];
  const MOMENTS = [
    ['one-minute', 'regulation'],
    ['one-minute', 'added'],
    ['time-up', 'regulation'],
    ['time-up', 'added'],
  ];
  const everyMessage = () => LANGS.flatMap((l) => MOMENTS.map(([k, p]) => messageFor(k, p, l)));

  it('names the moment and never who is playing', () => {
    // these land on lock screens anyone standing nearby can read
    for (const m of everyMessage()) {
      expect(m.title).toBeTruthy();
      expect(m.body).toBeTruthy();
      expect(`${m.title} ${m.body}`).not.toMatch(/black|white|blue|שחור|לבן|כחול/i);
    }
  });

  it('distinguishes full time from the end of added time', () => {
    expect(messageFor('time-up', 'regulation', 'en').title).toContain('Full time');
    expect(messageFor('time-up', 'added', 'en').body).toMatch(/penalties/i);
    expect(messageFor('time-up', 'regulation', 'he').title).toContain('סיום');
    expect(messageFor('time-up', 'added', 'he').body).toContain('פנדלים');
  });

  it('speaks Hebrew unless the device asked otherwise', () => {
    // the app's own default, and what a subscription with no language stored
    // against it — one made before this shipped — falls back to
    const he = messageFor('time-up', 'regulation', 'he');
    expect(messageFor('time-up', 'regulation')).toEqual(he);
    expect(messageFor('time-up', 'regulation', 'klingon')).toEqual(he);
  });

  it('keeps every title short enough to survive a banner', () => {
    // the title is the half that identifies which of the four moments this is;
    // if it truncates, the notification has told you nothing
    for (const m of everyMessage()) {
      expect(m.title.length).toBeLessThanOrEqual(24);
    }
  });

  it('never repeats the title back in the body', () => {
    // a body that restates the moment is a line nobody needs to read twice —
    // it has to be an instruction or a branch, or it should not be there
    for (const { title, body } of everyMessage()) {
      // Unicode-aware, so the Hebrew half is genuinely checked rather than
      // stripped to nothing by a `\w` class that only knows ASCII.
      const words = title
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      expect(words.every((w) => !body.toLowerCase().includes(w))).toBe(true);
    }
  });

  it('states both branches at full time, since the app never learns the score', () => {
    const en = messageFor('time-up', 'regulation', 'en').body;
    expect(en).toMatch(/ahead/i); // someone won it
    expect(en).toMatch(/level/i); // nobody did
    const he = messageFor('time-up', 'regulation', 'he').body;
    expect(he).toContain('מובילים');
    expect(he).toContain('שוויון');
  });

  it('says the same thing at one minute in either period, with different advice', () => {
    const reg = messageFor('one-minute', 'regulation');
    const add = messageFor('one-minute', 'added');
    expect(reg.title).toBe(add.title);
    expect(reg.body).not.toBe(add.body);
  });
});
