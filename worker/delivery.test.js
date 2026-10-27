import { describe, expect, it } from 'vitest';
import { EXCLAIM_SHORT, calmExclamations, exclaimMode } from './delivery.js';

// How excited the voice is allowed to sound (§2.73): a long sentence's "!" is
// softened in what the voice is sent, a short one keeps it, the words never change.

const LONG = 'השחורים פשוט פירקו את המגרש והראו לכולם מאיפה דג משתין עם שש נקודות';
const SHORT = 'איזו בונבוניירה!';

describe('calmExclamations', () => {
  it('ends a long exclamation with a full stop', () => {
    expect(LONG.length).toBeGreaterThan(EXCLAIM_SHORT);
    expect(calmExclamations(`${LONG}!`)).toBe(`${LONG}.`);
  });

  it('lets a short one keep its exclamation mark', () => {
    expect(SHORT.length).toBeLessThanOrEqual(EXCLAIM_SHORT);
    expect(calmExclamations(SHORT)).toBe(SHORT);
  });

  it('judges each sentence of a line on its own', () => {
    expect(calmExclamations(`${SHORT} ${LONG}! בעל הבית השתגע!`)).toBe(`${SHORT} ${LONG}. בעל הבית השתגע!`);
  });

  it('keeps the lines, and leaves full stops and questions alone', () => {
    const text = `${LONG}.\n${LONG}?\n${SHORT}`;
    expect(calmExclamations(text)).toBe(text);
  });

  it('does not turn a question into a statement', () => {
    expect(calmExclamations(`${LONG}?!`)).toBe(`${LONG}?`);
  });

  it('changes nothing but the mark', () => {
    const text = `${LONG}! ${LONG}!\n${SHORT} ${LONG}!`;
    const words = (t) => t.replace(/[.!?]/g, '').split(/\s+/);
    expect(words(calmExclamations(text))).toEqual(words(text));
  });

  it('"calm" turns every exclamation mark into a full stop, short ones too', () => {
    expect(calmExclamations(`${SHORT} ${LONG}!`, 'calm')).toBe(`איזו בונבוניירה. ${LONG}.`);
  });

  it('"all" sends the text as it is', () => {
    const text = `${LONG}! ${SHORT}`;
    expect(calmExclamations(text, 'all')).toBe(text);
  });

  it('copes with nothing', () => {
    expect(calmExclamations('')).toBe('');
    expect(calmExclamations(undefined)).toBe('');
  });
});

describe('exclaimMode', () => {
  it('is "short" unless set to something it knows', () => {
    expect(exclaimMode({})).toBe('short');
    expect(exclaimMode({ VOICE_EXCLAIM: 'calm' })).toBe('calm');
    expect(exclaimMode({ VOICE_EXCLAIM: 'ALL' })).toBe('all');
    expect(exclaimMode({ VOICE_EXCLAIM: 'wild' })).toBe('short');
  });
});
