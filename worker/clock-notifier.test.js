import { describe, expect, it } from 'vitest';
import { messageFor, resultMessage, triggersFor } from './clock-notifier.js';

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

// What a result says when it lands on a lock screen (§2.63).
describe('resultMessage', () => {
  const m = (over = {}) => ({ a: 'black', b: 'white', winner: 'black', viaPenalties: false, ...over });

  it('names the winning shirt in both languages', () => {
    expect(resultMessage(m(), 'he').title).toContain('שחורים');
    expect(resultMessage(m(), 'en').title).toContain('Black');
  });

  it('says penalties when it was penalties, and not when it was not', () => {
    expect(resultMessage(m({ viaPenalties: true }), 'he').title).toContain('בפנדלים');
    expect(resultMessage(m({ viaPenalties: true }), 'en').title).toMatch(/on penalties/i);
    expect(resultMessage(m(), 'he').title).not.toContain('פנדלים');
    expect(resultMessage(m(), 'en').title).not.toMatch(/penalt/i);
  });

  // **Reversed on the organiser's instruction.** The body used to name the
  // shirt coming on next, on the grounds that the clock alerts' bodies all
  // earn their place as instructions. A result is not a cue to do anything —
  // the squad is looking at the pitch — so the body carries the noise instead.
  it('says only who won, never who is on next', () => {
    for (const lang of ['he', 'en']) {
      const r = resultMessage(m(), lang);
      const all = `${r.title} ${r.body}`;
      // black beat white, so blue was the shirt off the pitch — and must not
      // be mentioned at all
      expect(all).not.toMatch(/Blue|כחולים/);
      expect(all).not.toMatch(/come on|נכנסים/);
    }
  });

  it('is a title and nothing else', () => {
    // Explicitly empty rather than absent: the service worker falls back to
    // "Match update" for a payload with no body.
    for (const lang of ['he', 'en']) {
      expect(resultMessage(m(), lang).body).toBe('');
      expect(resultMessage(m({ viaPenalties: true }), lang).body).toBe('');
    }
  });

  it('shouts, once', () => {
    for (const lang of ['he', 'en']) {
      for (const seq of [0, 1, 2]) {
        for (const over of [{}, { viaPenalties: true }]) {
          const title = resultMessage(m(over), lang, seq).title;
          expect(title.endsWith('!')).toBe(true);
          expect(title.match(/!/g)).toHaveLength(1);
        }
      }
    }
  });

  it('does not say it the same way every time', () => {
    // Rotated on the match's number, so a night never hears one phrasing twice
    // running — and the same match always produces the same words.
    for (const lang of ['he', 'en']) {
      const said = [0, 1, 2].map((seq) => resultMessage(m(), lang, seq).title);
      expect(new Set(said).size).toBe(3);
      // deterministic: the 4th match wraps back to the 1st phrasing
      expect(resultMessage(m(), lang, 3).title).toBe(said[0]);
      // and every one of them still names the winner
      for (const t of said) expect(t).toMatch(lang === 'en' ? /Black/ : /שחורים/);
    }
  });

  it('varies the shootout lines too, and each still says penalties', () => {
    for (const lang of ['he', 'en']) {
      const said = [0, 1, 2].map((seq) => resultMessage(m({ viaPenalties: true }), lang, seq).title);
      expect(new Set(said).size).toBe(3);
      for (const t of said) expect(t).toMatch(lang === 'en' ? /penalties/i : /פנדלים/);
    }
  });

  it('never reads past the end of its own list', () => {
    // `seq` is a match count and grows all night; a negative would be a bug
    // elsewhere, but neither may produce `undefined is not a function`.
    for (const seq of [0, 7, 99, -1, -4]) {
      expect(resultMessage(m(), 'he', seq).title).toContain('!');
    }
  });

  it('claims nothing beyond this one match', () => {
    // The only input is the match itself, so a body implying a run or a tally
    // would eventually be wrong about a night it cannot see.
    for (const lang of ['he', 'en']) {
      for (const over of [{}, { viaPenalties: true }]) {
        const r = resultMessage(m(over), lang);
        expect(`${r.title} ${r.body}`).not.toMatch(/another|streak|רצף|עוד אחד|\d/i);
      }
    }
  });

  it('is built only out of shirts, so it cannot leak a line-up', () => {
    // The rule the clock alerts are built on: these land on screens anyone
    // standing nearby can read, and tonight's line-up is not theirs to have.
    // A shirt is already visible on the pitch; a name is not — and the only
    // input here is `{a, b, winner, viaPenalties}`, which holds no name to
    // leak. This pins that the *words* stay inside the shirt vocabulary too.
    const allowed = {
      he: ['ניצחון', 'לשחורים', 'ללבנים', 'לכחולים', 'השחורים', 'הלבנים', 'הכחולים',
        'לקחו', 'את', 'זה', 'ניצחו', 'בפנדלים', 'פנדלים', 'ושחורים', 'והשחורים', 'והלבנים', 'והכחולים'],
      en: ['take', 'takes', 'win', 'it', 'on', 'penalties', 'black', 'white', 'blue', "that's", 'penalties —', '—'],
    };
    for (const lang of ['he', 'en']) {
      for (const over of [{}, { viaPenalties: true }, { winner: 'white' }, { a: 'white', b: 'blue', winner: 'blue' }]) {
        // every phrasing, not just the first — an unchecked variant is exactly
        // where a stray word would hide
        for (const seq of [0, 1, 2]) {
        const r = resultMessage(m(over), lang, seq);
        const words = `${r.title} ${r.body}`
          .replace(/[⚫⚪🔵.!—]/gu, ' ')
          .split(/\s+/)
          .filter(Boolean)
          // case is the sentence's business, not the vocabulary's
          .map((w) => (lang === 'en' ? w.toLowerCase() : w));
        for (const w of words) expect(allowed[lang]).toContain(w);
        }
      }
    }
  });

  it('carries its own tag so a result and a clock cue do not replace each other', () => {
    expect(resultMessage(m(), 'he').tag).toBe('armonim-result');
    expect(messageFor('one-minute', 'regulation', 'he').tag).toBeUndefined();
  });

  it('says nothing at all for a match with no winner', () => {
    expect(resultMessage({ a: 'black', b: 'white' }, 'he')).toBeNull();
    expect(resultMessage(null, 'he')).toBeNull();
  });

  it('falls back to Hebrew for a language it does not know', () => {
    expect(resultMessage(m(), 'fr').title).toBe(resultMessage(m(), 'he').title);
  });
});
