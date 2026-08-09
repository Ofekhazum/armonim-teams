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
