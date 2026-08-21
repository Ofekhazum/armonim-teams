import { describe, expect, it } from 'vitest';
import type { FixtureRecord, Player } from './types';
import { MIN_ATTEND_STREAK, MIN_WIN_STREAK } from './milestones';
import { WINS_WITHIN_REACH, bountyTonight, pendingTonight } from './radar';

// The radar says what tonight *could* become. Everything it prints is a
// condition on the record, never a prediction — so the tests are mostly about
// firing at exactly one night short of a line, and staying quiet otherwise.

let seq = 0;

const player = (id: string): Player => ({
  id,
  name: id,
  rating: 3,
  attack: 50,
  chemistry: [],
});

// `winner` names the team that took the night; 'none' leaves it level at the
// top, and null means no result was ever entered.
const night = (
  black: string[],
  white: string[],
  winner: 'black' | 'white' | 'none' | null,
): FixtureRecord => {
  seq++;
  return {
    id: `f${seq}`,
    date: `2026-03-${String(seq).padStart(2, '0')}`,
    teams: { black, white, blue: [] },
    players: [...black, ...white].map((id) => ({ id, name: id, rating: 3 })),
    wins:
      winner === null
        ? { black: 0, white: 0, blue: 0 }
        : winner === 'none'
          ? { black: 3, white: 3, blue: 0 }
          : winner === 'black'
            ? { black: 4, white: 1, blue: 0 }
            : { black: 1, white: 4, blue: 0 },
  };
};

const kinds = (facts: ReturnType<typeof pendingTonight>) => facts.map((f) => f.kind);

describe('pendingTonight', () => {
  it('fires a win streak at exactly one night short of the line', () => {
    const history = Array.from({ length: MIN_WIN_STREAK - 1 }, () => night(['a'], ['b'], 'black'));
    expect(kinds(pendingTonight([player('a')], history))).toContain('win-streak');
  });

  it('stays quiet two nights short', () => {
    const history = Array.from({ length: MIN_WIN_STREAK - 2 }, () => night(['a'], ['b'], 'black'));
    expect(kinds(pendingTonight([player('a')], history))).not.toContain('win-streak');
  });

  it('stays quiet once the streak has already been made', () => {
    // that is milestones.ts's job — announcing it after the fact
    const history = Array.from({ length: MIN_WIN_STREAK }, () => night(['a'], ['b'], 'black'));
    expect(kinds(pendingTonight([player('a')], history))).not.toContain('win-streak');
  });

  it('does not count a night level at the top as a win', () => {
    const history = [night(['a'], ['b'], 'black'), night(['a'], ['b'], 'none')];
    expect(kinds(pendingTonight([player('a')], history))).not.toContain('win-streak');
  });

  it('counts tonight as the next night for an nth-night milestone', () => {
    // nine nights played, so tonight is the tenth
    const history = Array.from({ length: 9 }, () => night(['a'], ['b'], 'black'));
    const facts = pendingTonight([player('a')], history);
    expect(facts).toContainEqual({ kind: 'nth-night', id: 'a', name: 'a', target: 10 });
  });

  it('does not announce an nth night that is not a milestone', () => {
    const history = Array.from({ length: 5 }, () => night(['a'], ['b'], 'black'));
    expect(kinds(pendingTonight([player('a')], history))).not.toContain('nth-night');
  });

  it('flags a career win milestone only once it is within reach', () => {
    // 4 wins a night here, so 12 nights is 48 wins — two short of 50
    const close = Array.from({ length: 12 }, () => night(['a'], ['b'], 'black'));
    expect(pendingTonight([player('a')], close)).toContainEqual({
      kind: 'nth-win',
      id: 'a',
      name: 'a',
      target: 50,
      away: 2,
    });

    const far = Array.from({ length: 2 }, () => night(['a'], ['b'], 'black'));
    expect(kinds(pendingTonight([player('a')], far))).not.toContain('nth-win');
  });

  it('never claims more than WINS_WITHIN_REACH away', () => {
    const history = Array.from({ length: 12 }, () => night(['a'], ['b'], 'black'));
    for (const f of pendingTonight([player('a')], history)) {
      if (f.kind === 'nth-win') expect(f.away).toBeLessThanOrEqual(WINS_WITHIN_REACH);
    }
  });

  it('fires the attendance streak one night short, counting untallied nights', () => {
    // attendance doesn't care whether anyone typed the score in
    const history = Array.from({ length: MIN_ATTEND_STREAK - 1 }, () => night(['a'], ['b'], null));
    expect(kinds(pendingTonight([player('a')], history))).toContain('iron-man');
  });

  it('ignores tonight’s own record, so the radar never describes the past', () => {
    const history = [night(['a'], ['b'], 'black'), night(['a'], ['b'], 'black')];
    const tonight = night(['a'], ['b'], 'black');
    // with tonight counted, a is already on 3 and nothing is pending
    expect(kinds(pendingTonight([player('a')], [...history, tonight], tonight.id))).toContain(
      'win-streak',
    );
  });

  it('says nothing at all about a player with no history', () => {
    expect(pendingTonight([player('new')], [])).toEqual([]);
  });

  it('puts the rarer facts first when several fire at once', () => {
    // nine nights played, of which only the last two were won: tonight is both
    // their 10th night and the one that could make it three in a row
    const history = [
      ...Array.from({ length: 7 }, () => night(['a'], ['b'], 'white')),
      night(['a'], ['b'], 'black'),
      night(['a'], ['b'], 'black'),
    ];
    expect(kinds(pendingTonight([player('a')], history))).toEqual(['nth-night', 'win-streak']);
  });
});

describe('bountyTonight', () => {
  it('names the longest active run once it clears the line', () => {
    const history = Array.from({ length: MIN_WIN_STREAK }, () => night(['a'], ['b'], 'black'));
    expect(bountyTonight([player('a'), player('b')], history)).toEqual({
      id: 'a',
      name: 'a',
      nights: MIN_WIN_STREAK,
    });
  });

  it('stays quiet below the line, rather than inventing a rivalry', () => {
    const history = Array.from({ length: MIN_WIN_STREAK - 1 }, () => night(['a'], ['b'], 'black'));
    expect(bountyTonight([player('a'), player('b')], history)).toBeNull();
  });

  it('names nobody when two players are level on the longest run', () => {
    // picking one of them arbitrarily would invent the target
    const history = Array.from({ length: MIN_WIN_STREAK }, () => night(['a', 'c'], ['b'], 'black'));
    expect(bountyTonight([player('a'), player('c')], history)).toBeNull();
  });

  it('picks the longer of two unequal runs', () => {
    const history = [
      night(['a'], ['b'], 'black'),
      night(['a', 'c'], ['b'], 'black'),
      night(['a', 'c'], ['b'], 'black'),
      night(['a', 'c'], ['b'], 'black'),
    ];
    expect(bountyTonight([player('a'), player('c')], history)?.id).toBe('a');
  });

  it('only considers players who are actually here tonight', () => {
    const history = Array.from({ length: MIN_WIN_STREAK }, () => night(['a'], ['b'], 'black'));
    expect(bountyTonight([player('b')], history)).toBeNull();
  });
});
