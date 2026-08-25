import { describe, expect, it } from 'vitest';
import type { FixtureRecord, MatchLogEntry } from './types';
import { BASE, MIN_RECENT, nightGrades } from './grades';

// The mark out of ten (§2.39). What matters here is that the number is
// arithmetic a reader could check: that teammates share the part of it which
// is about the team, that only real per-player facts separate them, and that
// tonight never quietly raises the bar it is measured against.

let seq = 0;
const night = (
  teams: { black: string[]; white: string[]; blue: string[] },
  wins: { black: number; white: number; blue: number },
  extra: { mvpId?: string; matchLog?: MatchLogEntry[] } = {},
): FixtureRecord => {
  seq++;
  return {
    id: `f${seq}`,
    date: `2026-01-${String(seq).padStart(2, '0')}`,
    teams,
    players: [...teams.black, ...teams.white, ...teams.blue].map((id) => ({ id, name: id, rating: 3 })),
    wins,
    ...extra,
  };
};

const T = (black: string[], white: string[], blue: string[] = []) => ({ black, white, blue });
const gradeOf = (gs: ReturnType<typeof nightGrades>, id: string) => gs!.find((g) => g.id === id)!;

describe('nightGrades', () => {
  it('says nothing about a night nobody typed a result into', () => {
    const fx = night(T(['a'], ['b']), { black: 0, white: 0, blue: 0 });
    expect(nightGrades([fx], fx.id)).toBeNull();
  });

  it('gives every player on a shirt the same night term', () => {
    // The five share one result, and the part of the grade that is about that
    // result has to be identical or the app is inventing a difference.
    const fx = night(T(['a', 'b', 'c'], ['x']), { black: 6, white: 2, blue: 0 });
    const gs = nightGrades([fx], fx.id)!;
    const nights = ['a', 'b', 'c'].map((id) => gradeOf(gs, id).parts.night);
    expect(new Set(nights).size).toBe(1);
  });

  it('separates teammates only by the MVP pick, on a first night', () => {
    // No history, so career and momentum are zero for everybody: the only
    // thing that can differ is the one genuine per-player signal.
    const fx = night(T(['a', 'b'], ['x']), { black: 6, white: 2, blue: 0 }, { mvpId: 'a' });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'a').grade - gradeOf(gs, 'b').grade).toBe(1);
    expect(gradeOf(gs, 'b').parts).toMatchObject({ career: 0, momentum: 0, mvp: 0 });
  });

  it('scores the night against that night’s own size', () => {
    // Four wins out of nine is a better night than four out of fifteen, and a
    // flat count would call them the same.
    const short = night(T(['a'], ['x'], ['y']), { black: 4, white: 3, blue: 2 });
    const long = night(T(['a'], ['x'], ['y']), { black: 4, white: 6, blue: 5 });
    const a = nightGrades([short], short.id)!;
    const b = nightGrades([long], long.id)!;
    expect(gradeOf(a, 'a').parts.night).toBeGreaterThan(gradeOf(b, 'a').parts.night);
  });

  it('reads history from before tonight, so a big night cannot raise its own bar', () => {
    const past = [
      night(T(['a'], ['x']), { black: 1, white: 5, blue: 0 }),
      night(T(['a'], ['x']), { black: 1, white: 5, blue: 0 }),
      night(T(['a'], ['x']), { black: 1, white: 5, blue: 0 }),
    ];
    const tonight = night(T(['a'], ['x']), { black: 6, white: 1, blue: 0 });
    const g = gradeOf(nightGrades([...past, tonight], tonight.id), 'a');
    // Coming in they averaged 1 a night — tonight's 6 must not be in that.
    expect(g.context.baseline).toBeCloseTo(1, 10);
    expect(g.context.nightsBefore).toBe(3);
  });

  it('holds momentum back until there is enough of it', () => {
    const past = Array.from({ length: MIN_RECENT - 1 }, () =>
      night(T(['a'], ['x']), { black: 5, white: 1, blue: 0 }),
    );
    const tonight = night(T(['a'], ['x']), { black: 3, white: 3, blue: 0 });
    const g = gradeOf(nightGrades([...past, tonight], tonight.id), 'a');
    expect(g.parts.momentum).toBe(0);
    expect(g.context.trend).toBeNull();
  });

  it('reads a run above their own baseline as hot, and below it as cold', () => {
    const build = (early: number, late: number) => {
      const old = Array.from({ length: 6 }, () => night(T(['a'], ['x']), { black: early, white: 6 - early, blue: 0 }));
      const recent = Array.from({ length: 5 }, () => night(T(['a'], ['x']), { black: late, white: 6 - late, blue: 0 }));
      const tonight = night(T(['a'], ['x']), { black: 3, white: 3, blue: 0 });
      return gradeOf(nightGrades([...old, ...recent, tonight], tonight.id), 'a');
    };
    expect(build(1, 5).context.trend).toBe('hot');
    expect(build(5, 1).context.trend).toBe('cold');
    expect(build(1, 5).parts.momentum).toBeGreaterThan(0);
    expect(build(5, 1).parts.momentum).toBeLessThan(0);
  });

  it('never leaves the 1–10 scale, however lopsided the night', () => {
    const past = Array.from({ length: 8 }, () => night(T(['a'], ['x']), { black: 9, white: 0, blue: 0 }));
    const rout = night(T(['a'], ['x']), { black: 12, white: 0, blue: 0 }, { mvpId: 'a' });
    const g = gradeOf(nightGrades([...past, rout], rout.id), 'a');
    expect(g.grade).toBeLessThanOrEqual(10);
    expect(g.grade).toBeGreaterThanOrEqual(1);
  });

  it('marks to the nearest half, never to two decimal places', () => {
    const fx = night(T(['a'], ['x'], ['y']), { black: 4, white: 3, blue: 2 });
    for (const g of nightGrades([fx], fx.id)!) expect(g.grade * 2).toBe(Math.round(g.grade * 2));
  });

  it('gives nobody the night when it ended level at the top', () => {
    const fx = night(T(['a'], ['b'], ['c']), { black: 4, white: 4, blue: 1 });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'a').context.wonNight).toBe(false);
    expect(gradeOf(gs, 'b').context.wonNight).toBe(false);
    // and the team that was clearly bottom still is
    expect(gradeOf(gs, 'c').context.place).toBe(3);
  });

  it('grades a team that took the night above one that did not', () => {
    const fx = night(T(['a'], ['b']), { black: 6, white: 1, blue: 0 });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'a').grade).toBeGreaterThan(gradeOf(gs, 'b').grade);
    expect(gradeOf(gs, 'a').context.wonNight).toBe(true);
  });

  it('sits an average night on the base mark', () => {
    // Three teams level: nobody beat the night's own average, so nothing is
    // added or taken away and the mark is the base.
    const fx = night(T(['a'], ['b'], ['c']), { black: 3, white: 3, blue: 3 });
    expect(gradeOf(nightGrades([fx], fx.id), 'a').grade).toBe(BASE);
  });

  it('is the same answer every time it is asked', () => {
    const fx = night(T(['a'], ['b']), { black: 5, white: 2, blue: 0 });
    expect(nightGrades([fx], fx.id)).toEqual(nightGrades([fx], fx.id));
  });
});
