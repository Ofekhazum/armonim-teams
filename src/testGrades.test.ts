import { describe, expect, it } from 'vitest';
import { buildTestClub } from './testData';
import { nightGrades } from './grades';
import { testGradeLines } from './testGrades';

// The sandbox's grades (§2.32, §2.39). The one property that actually matters
// is that they agree with the formula: the profile's form graph computes marks
// from `nightGrades` in test mode, so a night page showing a different number
// for the same night would be a sandbox that misrepresents the feature.

const club = buildTestClub();
const graded = club.history.filter((fx) => nightGrades(club.history, fx.id));

describe('testGradeLines', () => {
  it('gives every player on a night a mark and a line', () => {
    const fx = graded[graded.length - 1];
    const lines = testGradeLines(club.history, fx.id)!;
    const expected = nightGrades(club.history, fx.id)!;
    expect(Object.keys(lines)).toHaveLength(expected.length);
    for (const g of expected) {
      // `text` is optional on a GradeLine — the Worker omits it for a player
      // the model skipped. The sandbox has no model to skip anybody, so every
      // line here must carry one.
      expect(lines[g.id].text ?? '').not.toBe('');
    }
  });

  it('uses the real marks, so the night page and the form graph agree', () => {
    // The reason this file does not roll a random number, stated as a test.
    for (const fx of graded.slice(0, 5)) {
      const lines = testGradeLines(club.history, fx.id)!;
      for (const g of nightGrades(club.history, fx.id)!) {
        expect(lines[g.id].grade).toBe(g.grade);
      }
    }
  });

  it('says nothing for a night with no result', () => {
    const blank = { ...club.history[0], id: 'blank', wins: { black: 0, white: 0, blue: 0 } };
    expect(testGradeLines([...club.history, blank], 'blank')).toBeNull();
  });

  it('is the same every time it is asked, so a page does not reshuffle', () => {
    const fx = graded[0];
    expect(testGradeLines(club.history, fx.id)).toEqual(testGradeLines(club.history, fx.id));
  });

  it('matches the tone of the mark rather than pulling from one pool', () => {
    // A "carried the whole team" line under a 3.5 reads as broken rather than
    // invented, which is the whole reason the pools are split by band.
    const seen = new Map<string, Set<string>>();
    for (const fx of graded) {
      const lines = testGradeLines(club.history, fx.id) ?? {};
      for (const line of Object.values(lines)) {
        const band = line.grade >= 8 ? 'standout' : line.grade < 5 ? 'rough' : 'middle';
        if (!seen.has(band)) seen.set(band, new Set());
        seen.get(band)!.add(line.text ?? '');
      }
    }
    // The invented club spreads marks across the scale, so every band should
    // have turned up — and no line may appear in two of them.
    expect(seen.get('standout')?.size).toBeGreaterThan(0);
    expect(seen.get('rough')?.size).toBeGreaterThan(0);
    const standout = seen.get('standout')!;
    for (const text of seen.get('rough')!) expect(standout.has(text)).toBe(false);
  });
});
