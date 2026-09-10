import { describe, expect, it } from 'vitest';
import { STRINGS } from './strings';
import { LANGS, dirOf, translate, type Entry, type Key, type Lang } from './i18n';

// The dictionary is the one part of the language feature that can rot quietly.
// A missing label does not throw, does not fail a typecheck once the key
// exists, and only shows up as English sitting in the middle of a Hebrew page
// — on somebody's phone, on a match night. So the shape of every entry is
// checked here rather than trusted.

const entries = Object.entries(STRINGS) as [Key, Entry][];

describe('the dictionary', () => {
  it('has entries at all', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('says everything in both languages', () => {
    const missing: string[] = [];
    for (const [key, entry] of entries) {
      for (const lang of LANGS) {
        const v = entry[lang];
        if (v === undefined) missing.push(`${key}.${lang}`);
        else if (typeof v === 'string') {
          if (v.trim() === '') missing.push(`${key}.${lang} (empty)`);
        } else if (!v.one?.trim() || !v.other?.trim()) {
          missing.push(`${key}.${lang} (empty plural)`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps a plural a plural in both languages', () => {
    // One language having `{one, other}` and the other a bare string is the
    // shape that silently drops the count agreement in exactly one language.
    const mismatched = entries
      .filter(([, e]) => (typeof e.he === 'string') !== (typeof e.en === 'string'))
      .map(([k]) => k);
    expect(mismatched).toEqual([]);
  });

  it('asks for the same placeholders in both languages', () => {
    // `{team}` in the Hebrew and `{name}` in the English is a string that
    // renders a literal brace to half the club.
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const flat = (v: Entry[Lang]) => (typeof v === 'string' ? [v] : [v.one, v.other]);

    const mismatched: string[] = [];
    for (const [key, entry] of entries) {
      const he = flat(entry.he).flatMap(holes);
      const en = flat(entry.en).flatMap(holes);
      if ([...new Set(he)].sort().join() !== [...new Set(en)].sort().join()) {
        mismatched.push(`${key}: he[${he}] vs en[${en}]`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('never returns a key as its own translation', () => {
    // What `translate` falls back to when a key is absent. Nothing in the
    // dictionary should be able to produce it.
    const selfish = entries.filter(([k]) => LANGS.some((l) => translate(l, k) === k)).map(([k]) => k);
    expect(selfish).toEqual([]);
  });
});

describe('translate', () => {
  it('fills placeholders', () => {
    // Uses a real key so the test breaks if the string stops taking a count,
    // rather than passing against a fixture that no longer resembles the app.
    expect(translate('en', 'app.tab.roster', { n: 12 })).toBe('Roster (12)');
    expect(translate('he', 'app.tab.roster', { n: 12 })).toBe('סגל (12)');
  });

  it('leaves an unknown placeholder alone rather than blanking it', () => {
    expect(translate('en', 'app.tab.roster')).toBe('Roster ({n})');
  });

  it('picks the singular only at exactly one', () => {
    for (const [n, want] of [
      [0, 'nights'],
      [1, 'night'],
      [2, 'nights'],
    ] as const) {
      expect(translate('en', 'ui.night', { n })).toBe(want);
    }
    expect(translate('he', 'ui.night', { n: 1 })).toBe('ערב');
    expect(translate('he', 'ui.night', { n: 3 })).toBe('ערבים');
  });

  it('returns the key itself for one it does not know', () => {
    expect(translate('he', 'nope.not.a.key' as Key)).toBe('nope.not.a.key');
  });
});

describe('direction', () => {
  it('is right-to-left for Hebrew and left-to-right for English', () => {
    expect(dirOf('he')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });
});
