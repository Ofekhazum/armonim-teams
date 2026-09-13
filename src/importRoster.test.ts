import { describe, expect, it } from 'vitest';
import { matchPlayer, parseImportList, resolveImportedNames } from './importRoster';
import type { Player } from './types';

function player(id: string, name: string, extra: Partial<Player> = {}): Player {
  return { id, name, rating: 3, attack: 50, chemistry: [], ...extra };
}

describe('parseImportList', () => {
  it('reads a classic dotted numbered list', () => {
    expect(parseImportList('1. עופר\n2. דני\n3. יוסי')).toEqual(['עופר', 'דני', 'יוסי']);
  });

  it('reads a numbered list with no punctuation at all — the reported bug', () => {
    expect(parseImportList('1 עופר\n2 דני\n3 יוסי')).toEqual(['עופר', 'דני', 'יוסי']);
  });

  it('reads numbers with parens, dashes, or colons', () => {
    expect(parseImportList('1) עופר\n2- דני\n3: יוסי')).toEqual(['עופר', 'דני', 'יוסי']);
  });

  it('handles inconsistent separators within the same paste', () => {
    expect(parseImportList('1. עופר\n2 דני\n3) יוסי')).toEqual(['עופר', 'דני', 'יוסי']);
  });

  it('tolerates gaps in the numbering (someone dropped out)', () => {
    expect(parseImportList('1. עופר\n3. דני\n7. יוסי')).toEqual(['עופר', 'דני', 'יוסי']);
  });

  it('reads a bulleted list with no numbers', () => {
    expect(parseImportList('• עופר\n• דני\n• יוסי')).toEqual(['עופר', 'דני', 'יוסי']);
    expect(parseImportList('- עופר\n- דני\n- יוסי')).toEqual(['עופר', 'דני', 'יוסי']);
  });

  it('reads a plain list with no numbering or bullets at all', () => {
    expect(parseImportList('עופר\nדני\nיוסי')).toEqual(['עופר', 'דני', 'יוסי']);
  });

  it('stops at a waiting-list header', () => {
    expect(parseImportList('1. עופר\n2. דני\nהמתנה\n3. יוסי')).toEqual(['עופר', 'דני']);
  });

  it('ignores a time header line', () => {
    expect(parseImportList('🕗 19:00\n1. עופר\n2. דני')).toEqual(['עופר', 'דני']);
  });

  it('strips a trailing guest/role note from a name', () => {
    expect(parseImportList('1. דני (אורח)\n2. לירן(שוער)')).toEqual(['דני', 'לירן']);
  });

  it('ignores blank lines mixed into the list', () => {
    expect(parseImportList('1. עופר\n\n2. דני\n\n\n3. יוסי')).toEqual(['עופר', 'דני', 'יוסי']);
  });

  it('does not sweep an unrelated sentence with a leading digit into a punctuated list', () => {
    const text = '1. עופר\n3 players still needed for Friday\n2. דני\n4. יוסי';
    expect(parseImportList(text)).toEqual(['עופר', 'דני', 'יוסי']);
  });

  it('returns nothing for an empty paste', () => {
    expect(parseImportList('')).toEqual([]);
    expect(parseImportList('   \n  \n')).toEqual([]);
  });

  it('handles a single unpunctuated numbered line on its own', () => {
    expect(parseImportList('1 עופר')).toEqual(['עופר']);
  });

  // The reported bug, verbatim: a real Thursday message from the group.
  //
  // Two things were wrong with it. The old strict-ascending rule read the
  // restart under "מזמינים" as proof this was not a list at all, and the
  // last-resort branch then returned every line with its number still
  // attached, so `matchPlayer` recognised nobody and all fifteen regulars were
  // imported as guests. And "מזמינים" is a waiting list: by the time anybody
  // writes that header the squad is already at fifteen, so those two are
  // queueing for a drop-out rather than playing.
  it('reads the squad and stops at מזמינים', () => {
    const paste = `*חמישי ערמונים 19:00🏆⚽️🇮🇱*
1 חנגל
2 הלחמי
3 ניב
4 יוני
5 עילאי
6 רותם
7 שגב
8 נדב
9 חנש
 10 דור גי
11 אופק
12 ירין
13 יועד
14 טום
15 שי

*מזמינים*
1. זרקא
2. ארטיום`;
    expect(parseImportList(paste)).toEqual([
      'חנגל',
      'הלחמי',
      'ניב',
      'יוני',
      'עילאי',
      'רותם',
      'שגב',
      'נדב',
      'חנש',
      'דור גי',
      'אופק',
      'ירין',
      'יועד',
      'טום',
      'שי',
    ]);
  });

  it('stops at a guest/waiting header rather than importing reserves', () => {
    expect(parseImportList('1. עופר\nמזמינים\n1. זרקא')).toEqual(['עופר']);
    expect(parseImportList('1. עופר\n*מוזמנים*\n1. זרקא')).toEqual(['עופר']);
  });

  it('skips a keeper header without ending the list — they are still playing', () => {
    expect(parseImportList('1. עופר\nשוערים\n1. לירן')).toEqual(['עופר', 'לירן']);
  });

  // The numbering fix stands on its own, separately from the header rule: a
  // paste can restart at 1 under a heading this does not recognise, and it is
  // still a list. The heading itself falls out for free — it carries no
  // number, so the numbered branch never picks it up.
  it('reads two numbered sections under an unrecognised header', () => {
    const text = '1 עופר\n2 דני\n*קבוצה ב*\n1 יוסי\n2 לירן';
    expect(parseImportList(text)).toEqual(['עופר', 'דני', 'יוסי', 'לירן']);
  });

  // The restart is forgiven only at exactly 1 — a new list beginning. Anything
  // else that drops is still a sentence that happens to open with a digit, and
  // the punctuated-only branch is what has to catch it.
  it('still refuses a mid-list number that drops to something other than 1', () => {
    const text = '1. עופר\n3 players still needed for Friday\n2. דני\n4. יוסי';
    expect(parseImportList(text)).toEqual(['עופר', 'דני', 'יוסי']);
  });

  it('strips WhatsApp bold from a name', () => {
    expect(parseImportList('1. *עופר*\n2. דני')).toEqual(['עופר', 'דני']);
  });

  // Defence in depth for the branch that did the damage. Whatever shape of
  // paste drops through to "plain list", handing back "12 ירין" as a name is
  // never the right answer.
  it('never returns a name with its list number still attached', () => {
    // Deliberately unparseable as a list: numbers that jump around and no
    // punctuation, so every confident branch declines it.
    const messy = '7 עופר\n3 דני\n5 יוסי';
    for (const name of parseImportList(messy)) {
      expect(name).not.toMatch(/^\d/);
    }
  });
});

describe('matchPlayer', () => {
  const players = [player('a', 'עופר לוי'), player('b', 'דני', { aliases: ['Danny', 'דניאל'] })];

  it('matches by exact name, case/whitespace-insensitively', () => {
    expect(matchPlayer('  עופר לוי  ', players)?.id).toBe('a');
  });

  it('matches by alias', () => {
    expect(matchPlayer('Danny', players)?.id).toBe('b');
    expect(matchPlayer('דניאל', players)?.id).toBe('b');
  });

  it('returns undefined for an unrecognized name', () => {
    expect(matchPlayer('מישהו אחר', players)).toBeUndefined();
  });
});

describe('resolveImportedNames', () => {
  it('matches roster players and turns the rest into guests', () => {
    const players = [player('a', 'עופר'), player('b', 'דני')];
    const makeGuest = (name: string): Player => player(`guest-${name}`, name, { isGuest: true });
    const result = resolveImportedNames(['עופר', 'אורח חדש'], players, [], makeGuest);
    expect(result.availableIds).toEqual(['a']);
    expect(result.matchedNames).toEqual(['עופר']);
    expect(result.guestNames).toEqual(['אורח חדש']);
    expect(result.guests).toHaveLength(1);
  });

  it('does not duplicate a guest already present', () => {
    const players = [player('a', 'עופר')];
    const existingGuest = player('g1', 'אורח חדש', { isGuest: true });
    const makeGuest = (name: string): Player => player(`guest-${name}`, name, { isGuest: true });
    const result = resolveImportedNames(['אורח חדש'], players, [existingGuest], makeGuest);
    expect(result.guests).toHaveLength(0);
    expect(result.guestNames).toHaveLength(0);
  });
});
