import { describe, expect, it } from 'vitest';
import type { FixtureRecord, MatchLogEntry, Player, TeamColor } from './types';
import { winsFromLog } from './matchLog';
import { buildTestClub } from './testData';
import { gradesFacts } from './gradesFacts';
import { nightGrades } from './grades';
import { usableLines, type GradeLines } from './gradesApi';

// The payload behind the grades (§2.39). Two things carry all the risk here:
// the `p1` codes, which are the only address the model's answer comes back
// under, and the derby, which is the one fact in the whole request that belongs
// to two named people rather than to a team.

const m = (a: TeamColor, b: TeamColor, winner: TeamColor, viaPenalties = false): MatchLogEntry => ({
  a,
  b,
  winner,
  viaPenalties,
});

const SQUAD = ['a', 'b', 'c', 'd', 'e', 'f'];
const TEAMS = { black: ['a', 'b'], white: ['c', 'd'], blue: ['e', 'f'] };
const roster: Player[] = SQUAD.map((id) => ({
  id,
  name: id,
  rating: 3,
  attack: 50,
  chemistry: [],
}));

let seq = 0;
const night = (log: MatchLogEntry[], extra: Partial<FixtureRecord> = {}): FixtureRecord => {
  seq++;
  return {
    id: `f${seq}`,
    date: `2026-04-${String(seq).padStart(2, '0')}`,
    teams: TEAMS,
    players: SQUAD.map((id) => ({ id, name: id, rating: 3 })),
    wins: winsFromLog(log),
    matchLog: log,
    ...extra,
  };
};

// Six each way makes black and white dead level at 6–6 over 12 — a derby.
const level = () => [
  night(Array.from({ length: 6 }, () => m('black', 'white', 'black'))),
  night(Array.from({ length: 6 }, () => m('black', 'white', 'white'))),
];

describe('gradesFacts', () => {
  it('says nothing about a night with no result', () => {
    const fx = night([]);
    expect(gradesFacts(fx, [fx], roster)).toBeNull();
  });

  it('gives every player a unique key, in mark order', () => {
    // The key is the only address the answer comes back under, so a duplicate
    // would silently merge two players and a gap would orphan one.
    const fx = night([m('black', 'white', 'black'), m('black', 'blue', 'black')]);
    const facts = gradesFacts(fx, [fx], roster)!;
    const keys = facts.players.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(SQUAD.map((_, i) => `p${i + 1}`));
    const marks = facts.players.map((p) => p.grade);
    expect([...marks].sort((x, y) => y - x)).toEqual(marks);
  });

  it('carries the player id beside the key, for mapping the answer back', () => {
    const fx = night([m('black', 'white', 'black')]);
    const facts = gradesFacts(fx, [fx], roster)!;
    for (const p of facts.players) expect(SQUAD).toContain(p.id);
  });

  it('agrees with nightGrades about every mark', () => {
    // One formula, and the payload is a view of it rather than a second copy.
    const fx = night([m('black', 'white', 'black'), m('white', 'blue', 'blue')]);
    const facts = gradesFacts(fx, [fx], roster)!;
    const graded = nightGrades([fx], fx.id)!;
    for (const p of facts.players) {
      expect(p.grade).toBe(graded.find((g) => g.id === p.id)!.grade);
    }
  });

  it('carries no rating, for anybody, anywhere', () => {
    // §2.28. The fixture players all carry one; none of it may travel.
    const fx = night([m('black', 'white', 'black')]);
    const facts = gradesFacts(fx, [fx], roster)!;
    for (const p of facts.players) expect(p).not.toHaveProperty('rating');
    expect(JSON.stringify(facts)).not.toContain('rating');
  });

  it('names the winners as colours, leaving the Hebrew to the Worker', () => {
    const fx = night([m('black', 'white', 'black'), m('black', 'blue', 'black')]);
    expect(gradesFacts(fx, [fx], roster)!.winners).toEqual(['black']);
  });

  it('says nobody won a night that finished level at the top', () => {
    // §2.6 — nobody takes a night that ends level, and the payload must not
    // hand the model a winner to congratulate.
    const fx = night([m('black', 'white', 'black'), m('white', 'blue', 'white')]);
    const facts = gradesFacts(fx, [fx], roster)!;
    expect(facts.winners).toEqual([]);
    expect(facts.players.every((p) => !p.wonNight)).toBe(true);
  });

  it('passes the organiser’s note through, and null when there is none', () => {
    const withNote = night([m('black', 'white', 'black')], { note: '  over the fence  ' });
    expect(gradesFacts(withNote, [withNote], roster)!.said).toBe('over the fence');
    const bare = night([m('black', 'white', 'black')]);
    expect(gradesFacts(bare, [bare], roster)!.said).toBeNull();
  });

  it('drops the milestone that names nobody', () => {
    // A group debut — "3 players played their first night" — is the one
    // milestone with no owner, and under the attribution rule it could only
    // ever be a trap. The individual debuts say the same thing, with names.
    const fx = night([m('black', 'white', 'black')]);
    const facts = gradesFacts(fx, [fx], roster)!;
    expect(facts.milestones.every((s) => !/^\d+ players/.test(s))).toBe(true);
  });

  describe('the derby', () => {
    it('is absent when no pairing has enough history', () => {
      const fx = night([m('black', 'white', 'black')]);
      expect(gradesFacts(fx, [fx], roster)!.derby).toBeNull();
    });

    it('names both sides by a key the prompt will define', () => {
      const history = level();
      const fx = night([m('black', 'white', 'black')]);
      const facts = gradesFacts(fx, [...history, fx], roster)!;
      const keys = new Set(facts.players.map((p) => p.key));
      expect(facts.derby).not.toBeNull();
      expect(keys.has(facts.derby!.aKey)).toBe(true);
      expect(keys.has(facts.derby!.bKey)).toBe(true);
      expect(facts.derby!.aKey).not.toBe(facts.derby!.bKey);
    });

    it('carries the record they came in on and what tonight did to it', () => {
      const history = level();
      const fx = night([
        m('black', 'white', 'black'),
        m('black', 'white', 'black'),
        m('black', 'white', 'white', true),
      ]);
      const d = gradesFacts(fx, [...history, fx], roster)!.derby!;
      expect([d.aBefore, d.bBefore]).toEqual([6, 6]);
      expect(d.faced).toBe(12);
      expect(d.met).toBe(3);
      expect(d.aTook).toBe(2);
      expect(d.bTook).toBe(1);
      expect(d.penalties).toBe(1);
    });

    it('is absent on a night that was only ever a tally', () => {
      // §2.17 — no log, no head-to-head, so nothing to settle.
      const history = level();
      const fx = night([m('black', 'white', 'black')]);
      const tally: FixtureRecord = { ...fx, matchLog: undefined };
      expect(gradesFacts(tally, [...history, tally], roster)!.derby).toBeNull();
    });
  });

  it('produces a whole payload for a real night of the invented club', () => {
    // The synthetic fixtures above are uniform on purpose; this is the check
    // that the thing works on a night with a spread of careers behind it.
    const club = buildTestClub();
    const fx = club.history[club.history.length - 1];
    const facts = gradesFacts(fx, club.history, club.players)!;
    expect(facts.players.length).toBe(fx.players.length);
    expect(facts.date).toBe(fx.date);
    expect(facts.players.every((p) => p.grade >= 1 && p.grade <= 10)).toBe(true);
    expect(facts.players.some((p) => p.nightsBefore > 0)).toBe(true);
  });
});

describe('usableLines', () => {
  const fx = night([m('black', 'white', 'black'), m('black', 'blue', 'black')]);
  const graded = nightGrades([fx], fx.id)!;
  const lines = (over: Partial<Record<string, number>> = {}): GradeLines =>
    Object.fromEntries(
      graded.map((g) => [g.id, { text: `line for ${g.id}`, grade: over[g.id] ?? g.grade }]),
    );

  it('keeps a line written against the mark that is still showing', () => {
    expect(Object.keys(usableLines(lines(), graded))).toHaveLength(graded.length);
  });

  it('drops a line whose mark has moved underneath it', () => {
    // A night corrected months later, or the formula retuned: the banter is
    // now about a number nobody can see, and a bare mark is the honest state.
    const drifted = usableLines(lines({ [graded[0].id]: graded[0].grade + 1 }), graded);
    expect(drifted[graded[0].id]).toBeUndefined();
    expect(Object.keys(drifted)).toHaveLength(graded.length - 1);
  });

  it('is empty rather than throwing when there is nothing stored', () => {
    expect(usableLines(null, graded)).toEqual({});
  });

  it('ignores a line for somebody who did not play', () => {
    expect(usableLines({ nobody: { text: 'x', grade: 6 } }, graded)).toEqual({});
  });
});
