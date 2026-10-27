import { describe, expect, it } from 'vitest';
import { PRONUNCIATIONS, pronounce } from './pronunciations.js';

// Respelling what the voice mispronounces (§2.71.2). What matters is what it
// must leave alone: a word that merely contains a name is not that name.

const DICT = {
  שגב: 'Segev',
  יועד: 'Yoed',
  שיא: 'סיא',
  דור: { to: 'Dor', exact: true },
};

describe('pronounce', () => {
  it('respells a word on its own', () => {
    expect(pronounce('שגב כבש שלושה שערים.', DICT)).toBe('Segev כבש שלושה שערים.');
  });

  it('keeps the punctuation around it', () => {
    expect(pronounce('מי כבש? שגב! "יועד", שגב.', DICT)).toBe('מי כבש? Segev! "Yoed", Segev.');
  });

  it('says a prefix the way it is said in front of a Latin spelling', () => {
    expect(pronounce('לשגב', DICT)).toBe('le Segev');
    expect(pronounce('מיועד', DICT)).toBe('me Yoed');
    expect(pronounce('והשגב', DICT)).toBe('veha Segev');
    expect(pronounce('כשיועד', DICT)).toBe('keshe Yoed');
    expect(pronounce('ושבשגב', DICT)).toBe('veshebe Segev');
  });

  it('leaves a prefix as it is in front of a Hebrew respelling', () => {
    expect(pronounce('בשיא השיא ומשיא', DICT)).toBe('בסיא הסיא ומסיא');
    expect(pronounce('שיא', DICT)).toBe('סיא');
  });

  it('does not touch a longer word that only contains an entry', () => {
    expect(pronounce('והשחורים', DICT)).toBe('והשחורים');
    expect(pronounce('ישגב', DICT)).toBe('ישגב'); // "will be exalted": a verb, not Segev
    expect(pronounce('אשגב', DICT)).toBe('אשגב');
    expect(pronounce('משגבים', DICT)).toBe('משגבים');
    expect(pronounce('שיאים', DICT)).toBe('שיאים');
    expect(pronounce('דוברי יועדים', DICT)).toBe('דוברי יועדים');
  });

  it('does not take any letters in front for a prefix', () => {
    expect(pronounce('נשגב', DICT)).toBe('נשגב');
    expect(pronounce('תשגב', DICT)).toBe('תשגב');
    expect(pronounce('ממשגב', DICT)).toBe('ממשגב');
  });

  it('leaves a word that is also another word alone when it is exact-only', () => {
    expect(pronounce('דור', DICT)).toBe('Dor');
    expect(pronounce('מדור הספורט, הדור, לדור', DICT)).toBe('מדור הספורט, הדור, לדור');
  });

  it('is not undone by being run twice, and ignores what is not Hebrew', () => {
    const once = pronounce('שגב ויועד', DICT);
    expect(pronounce(once, DICT)).toBe(once);
    expect(pronounce('Segev scored 3.', DICT)).toBe('Segev scored 3.');
    expect(pronounce('', DICT)).toBe('');
    expect(pronounce(undefined, DICT)).toBe('');
  });

  it('works across lines and several names at once', () => {
    expect(pronounce('שגב.\nיועד נגד שגב!', DICT)).toBe('Segev.\nYoed נגד Segev!');
  });
});

describe('the shipped dictionary', () => {
  it('has only entries a word can match: Hebrew letters on the left', () => {
    for (const word of Object.keys(PRONUNCIATIONS)) expect(word).toMatch(/^[א-ת]+$/);
  });

  it('respells the names it was started with', () => {
    expect(pronounce('שגב ויועד ודובצקי וזרקא')).toBe('Segev ve Yo-ahd ve Dubetsky ve Zarka');
    expect(pronounce('לאריאל ולירין, אופק ועומרי נגד טאקו ועובדיה')).toBe(
      'le Ariel vele Yarin, Ofek ve Omri נגד Tako ve Ovadia',
    );
    expect(pronounce('ארמונים בארמונים')).toBe('Armonim be Armonim');
  });

  it('respells a name that is also a word only on its own', () => {
    expect(pronounce('דור שי סלע קהל')).toBe('Dor Shy Sela Kahal');
    expect(pronounce('תומר קהל כבש')).toBe('תומר Kahal כבש');
    // the other words made of the same letters are not names
    expect(pronounce('מדור כדור הדור הקהל קהלים שיר סלעים')).toBe('מדור כדור הדור הקהל קהלים שיר סלעים');
  });
});
