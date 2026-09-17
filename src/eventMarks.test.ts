import { describe, expect, it } from 'vitest';
import type { FixtureRecord } from './types';
import { eventMarks, splitEvents, stripMarks } from './eventMarks';

// The organiser's thumb on the scale (§2.57). A night cannot tell that somebody
// scored four goals on a beaten team; the person on the touchline can, and this
// is the route by which that reaches the number.

const fx = (note: string, names = ['שי', 'יוני', 'יועד', 'דור גי', 'חנגל']): FixtureRecord => ({
  id: 'f1',
  date: '2026-09-17',
  teams: { black: names.slice(0, 2), white: names.slice(2, 4), blue: names.slice(4) },
  players: names.map((n) => ({ id: n, name: n, rating: 3 })),
  wins: { black: 2.5, white: 2.5, blue: 3.5 },
  note,
});

const marks = (note: string, names?: string[]) => Object.fromEntries(eventMarks(fx(note, names)));

describe('reading the markers', () => {
  it('takes a marker at either end of the event', () => {
    // RTL: "before" and "after" are not advice anybody can follow reliably, so
    // both work and mean the same thing.
    expect(marks('@שי שם 4 גולים +@')).toEqual({ שי: 0.5 });
    expect(marks('@+ שי שם 4 גולים@')).toEqual({ שי: 0.5 });
  });

  it('is worth half a point per marker, in both directions', () => {
    expect(marks('@שי שם 4 גולים ++@')).toEqual({ שי: 1 });
    expect(marks('@שי שם 4 גולים ++++@')).toEqual({ שי: 2 });
    expect(marks('@שי החמיץ פנדל -@')).toEqual({ שי: -0.5 });
    expect(marks('@שי החמיץ פנדל --@')).toEqual({ שי: -1 });
  });

  it('sums a player named in more than one event', () => {
    expect(marks('@שי שם 4 גולים +@ @שי גם הגן +@')).toEqual({ שי: 1 });
  });

  // The reported question. Both marks move by the full amount rather than
  // sharing one marker between them — the line says two players were good, not
  // that half a good thing happened.
  it('moves both players when one event names two', () => {
    expect(marks('@יוני ויועד שיחקו מצוין בשער +@')).toEqual({ יוני: 0.5, יועד: 0.5 });
  });

  // Hebrew glues "and" onto the front of the next word, so the second name in
  // a pair is never a word on its own. Missing it was the worst kind of
  // failure available here: half the line obeyed, no error, and one mark that
  // did not move for reasons invisible to whoever wrote it.
  it('reads a name behind a Hebrew prefix letter', () => {
    expect(marks('@יוני ויועד שיחקו מצוין בשער +@')).toEqual({ יוני: 0.5, יועד: 0.5 });
    expect(marks('@ליועד היה ערב מצוין +@')).toEqual({ יועד: 0.5 });
    expect(marks('@כששי נכנס הכל השתנה +@')).toEqual({ שי: 0.5 });
  });

  it('leaves an unmarked event alone', () => {
    expect(marks('@שי שם 4 גולים@')).toEqual({});
    expect(marks('@שי שם 4 גולים@ @יוני היה בשער +@')).toEqual({ יוני: 0.5 });
  });

  // The same attribution rule the report follows (§2.24): a line naming nobody
  // belongs to nobody, and guessing at an owner is the invention that rule
  // exists to prevent.
  it('adjusts nobody when the event names nobody', () => {
    expect(marks('@הרשתות היו קרועות -@')).toEqual({});
  });
});

describe('finding who an event is about', () => {
  it('matches a two-word name as a run, not as loose words', () => {
    expect(marks('@דור גי היה ענק +@')).toEqual({ 'דור גי': 0.5 });
    // "דור" on its own is the first word of a name nobody else shares, so it
    // is a usable handle
    expect(marks('@דור היה ענק +@')).toEqual({ 'דור גי': 0.5 });
  });

  it('refuses a first name two players answer to', () => {
    // Moving the wrong player's mark is worse than moving nobody's.
    const two = ['דור גי', 'דור לוי', 'שי'];
    expect(marks('@דור היה ענק +@', two)).toEqual({});
    // …and the full name still works
    expect(marks('@דור לוי היה ענק +@', two)).toEqual({ 'דור לוי': 0.5 });
  });

  it('does not match a name inside a longer word', () => {
    // "שי" is two letters and turns up inside ordinary Hebrew words; matching
    // on substrings rather than whole words would move marks at random.
    expect(marks('@המגרש היה רטוב ואישי +@')).toEqual({});
  });
});

describe('not mistaking football for a marker', () => {
  it('leaves a scoreline in the middle of a sentence alone', () => {
    expect(marks('@הם ניצחו 5-2 בגמר@')).toEqual({});
    expect(marks('@שי שם 3+4 שערים@')).toEqual({});
  });

  it('wants whitespace between the marker and the words', () => {
    // A marker is a token sitting on its own at the edge of the line, not a
    // character glued to the last word.
    expect(marks('@שי היה טוב+@')).toEqual({});
  });
});

describe('what the models are shown', () => {
  it('takes the markers off but keeps the event boundaries', () => {
    expect(stripMarks('@שי שם 4 גולים +@ @הרשתות קרועות@')).toBe(
      '@שי שם 4 גולים@ @הרשתות קרועות@',
    );
  });

  it('handles a note written one per line', () => {
    expect(stripMarks('שי שם 4 גולים +\nהרשתות קרועות')).toBe('שי שם 4 גולים\nהרשתות קרועות');
  });

  it('says nothing when there was nothing', () => {
    expect(stripMarks(null)).toBeNull();
    expect(stripMarks('')).toBeNull();
    expect(stripMarks('   ')).toBeNull();
  });
});

// Must stay in step with `splitEvents` in worker/recap.js — the same notes are
// read on both sides, and the examples are deliberately shared.
describe('splitting a note into events', () => {
  it('reads @…@ markers as the explicit separator', () => {
    expect(splitEvents('@one@ @two@')).toEqual(['one', 'two']);
  });

  it('falls back to one per line, trimming bullets and numbers', () => {
    expect(splitEvents('- one\n2. two\n• three')).toEqual(['one', 'two', 'three']);
  });

  it('treats prose with no separator as a single event', () => {
    expect(splitEvents('the ball went over the fence and somebody brought a dog')).toHaveLength(1);
  });
});
