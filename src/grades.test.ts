import { describe, expect, it } from 'vitest';
import type { FixtureRecord, MatchLogEntry } from './types';
import { BASE, GRADE_MAX, MIN_RECENT, gradeConstants, nightGrades } from './grades';

// The mark out of ten (§2.39). What matters here is that the number is
// arithmetic a reader could check: that teammates share the part of it which
// is about the team, that only real per-player facts separate them, and that
// tonight never quietly raises the bar it is measured against.

let seq = 0;
const night = (
  teams: { black: string[]; white: string[]; blue: string[] },
  wins: { black: number; white: number; blue: number },
  extra: {
    mvpId?: string;
    mvpVotes?: Record<string, number>;
    matchLog?: MatchLogEntry[];
    ratings?: Record<string, number>;
    note?: string;
  } = {},
): FixtureRecord => {
  seq++;
  const { ratings, ...rest } = extra;
  return {
    id: `f${seq}`,
    // A real date `seq` days after the start of 2026, rather than
    // `2026-01-${seq}`. That older form ran out of month: once this file had
    // built its hundredth fixture, `padStart(2, '0')` produced `2026-01-100`,
    // which sorts *before* `2026-01-99` as a string — so every ordering in
    // `nightGrades` silently inverted for tests near the end of the file, and
    // a night's own history stopped being the nights before it.
    date: new Date(Date.UTC(2026, 0, 1) + seq * 86_400_000).toISOString().slice(0, 10),
    teams,
    // 3 (dead centre of the 1-5 scale, ratingTier() → 'middle') unless a test
    // is specifically exercising the cold-start tier nudge, in which case
    // every other test in this file staying neutral is the whole point.
    players: [...teams.black, ...teams.white, ...teams.blue].map((id) => ({
      id,
      name: id,
      rating: ratings?.[id] ?? 3,
    })),
    wins,
    ...rest,
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

  it('separates teammates on a first night by the MVP pick, and nothing else that is about them', () => {
    // No history, and an identical (middle-tier) rating for both, so career,
    // momentum and tier are all exactly zero for everybody: the parts prove
    // mvp is the one genuine personal signal, precisely — checked on the
    // components rather than the rounded total, because rounding (deliberately
    // small, deliberately uncorrelated with anybody) can land close enough to
    // a rounding boundary that the *totals* are not reliably ordered, which is
    // the point of it being noise rather than a second signal.
    const fx = night(T(['a', 'b'], ['x']), { black: 6, white: 2, blue: 0 }, { mvpId: 'a' });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'a').parts).toMatchObject({
      career: 0,
      momentum: 0,
      tier: 0,
      mvp: gradeConstants.MVP_BONUS,
    });
    expect(gradeOf(gs, 'b').parts).toMatchObject({ career: 0, momentum: 0, tier: 0, mvp: 0 });
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

  it('never marks a night winner below the floor, whoever they are', () => {
    // The real complaint this floor came from: a team took 7 of 12 while the
    // other two took 2 and 3, and players on it still came out at 7.5. The
    // personal terms span about ±1.5 between them, which is enough to drag
    // somebody under the mark their team's night earned.
    const fx = night(T(['a', 'b', 'c'], ['x', 'y'], ['z']), { black: 7, white: 3, blue: 2 });
    const gs = nightGrades([fx], fx.id)!;
    for (const id of ['a', 'b', 'c']) {
      expect(gradeOf(gs, id).context.wonNight).toBe(true);
      expect(gradeOf(gs, id).grade).toBeGreaterThanOrEqual(gradeConstants.WIN_FLOOR);
    }
  });

  it('still separates the winners rather than piling them all on the floor', () => {
    // The complaint that produced WIN_BONUS. With the floor alone, a winning
    // team's shared starting point was a fraction *under* 8, so the whole team
    // landed on it: a 5-star earned exactly 8.0 and a 3-star earned 7.0 and was
    // lifted to 8 to meet him. The rating had just been widened so it would
    // show, and the floor was flattening it straight back out.
    const fx = night(T(['top', 'mid', 'low'], ['x'], ['y']), { black: 7, white: 3, blue: 2 }, {
      ratings: { top: 5, mid: 4, low: 3 },
    });
    const gs = nightGrades([fx], fx.id)!;
    const [t, m, l] = ['top', 'mid', 'low'].map((id) => gradeOf(gs, id).grade);
    expect(t).toBeGreaterThan(l); // the whole point
    expect(t).toBeGreaterThanOrEqual(m);
    // and everybody is still above the floor they were promised
    for (const g of [t, m, l]) expect(g).toBeGreaterThanOrEqual(gradeConstants.WIN_FLOOR);
  });

  it('pays for taking the night on top of the margin it was taken by', () => {
    // `night` is the margin; WIN_BONUS is the fact of winning. A narrow win
    // and a rout are both wins, and only one of them is a rout.
    const narrow = night(T(['a'], ['b'], ['c']), { black: 5, white: 4, blue: 3 });
    const rout = night(T(['a'], ['b'], ['c']), { black: 9, white: 2, blue: 1 });
    const n = gradeOf(nightGrades([narrow], narrow.id), 'a').grade;
    const r = gradeOf(nightGrades([rout], rout.id), 'a').grade;
    expect(r).toBeGreaterThan(n); // the margin still counts for something
    expect(n).toBeGreaterThanOrEqual(gradeConstants.WIN_FLOOR); // and both are wins
  });

  it('holds the floor even for a player whose own record drags them down', () => {
    // A long run of empty nights coming in is exactly the case that produced
    // the 7.5: career and momentum both pulling hard the wrong way on a night
    // their team walked.
    const past = Array.from({ length: 6 }, () =>
      night(T(['loser'], ['w'], ['b']), { black: 0, white: 5, blue: 4 }),
    );
    const fx = night(T(['loser'], ['w'], ['b']), { black: 7, white: 3, blue: 2 });
    const gs = nightGrades([...past, fx], fx.id)!;
    const g = gradeOf(gs, 'loser');
    expect(g.context.trend).toBe('cold'); // the drag is real
    expect(g.grade).toBeGreaterThanOrEqual(gradeConstants.WIN_FLOOR);
  });

  it('does not floor a night that ended level at the top', () => {
    // §2.6 — nobody took it, so nobody is floored for having won it.
    const fx = night(T(['a'], ['b'], ['c']), { black: 4, white: 4, blue: 1 });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'a').grade).toBeLessThan(gradeConstants.WIN_FLOOR);
  });

  it('keeps the teams that did not win below the winners, and above the played floor', () => {
    // Two floors, not one. The winners' lifts them to 8; everybody else still
    // has a floor, but a lower one, and the ordering between the three teams
    // has to survive both — a floor that flattened the losing sides into the
    // winners would have thrown away what the night actually was.
    const fx = night(T(['a'], ['x'], ['z']), { black: 7, white: 3, blue: 2 });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'x').grade).toBeLessThan(gradeConstants.WIN_FLOOR);
    expect(gradeOf(gs, 'z').grade).toBeLessThan(gradeOf(gs, 'x').grade);
    for (const id of ['x', 'z']) {
      expect(gradeOf(gs, id).grade).toBeGreaterThanOrEqual(gradeConstants.PLAYED_FLOOR);
    }
  });

  // The reported case, reconstructed. On a 2.5 / 2.5 / 3.5 night a player on a
  // beaten team came out on 8 — the mark that means you took the night.
  //
  // Worth keeping the arithmetic here, because the complaint named momentum and
  // momentum was the smallest term in it: tier +0.80, close +0.57, career
  // +0.50, momentum +0.25, night −0.31. Trimming momentum would have fixed this
  // one case by rounding and left the next one alone, since none of the three
  // larger terms know the night was lost. A ceiling does know.
  it('never marks a beaten team as high as a winner', () => {
    const past = Array.from({ length: 6 }, () =>
      night(T(['hot'], ['w'], ['b']), { black: 6, white: 3, blue: 2 }),
    );
    const fx = night(T(['hot'], ['w'], ['b']), { black: 2.5, white: 2.5, blue: 3.5 }, {
      ratings: { hot: 5 }, // top tier, hot form, strong career — every term but `night`
    });
    const gs = nightGrades([...past, fx], fx.id)!;
    const g = gradeOf(gs, 'hot');
    expect(g.context.wonNight).toBe(false);
    expect(g.context.trend).toBe('hot'); // the form is real and still counted
    expect(g.grade).toBeLessThan(gradeConstants.WIN_FLOOR);
    expect(g.grade).toBeLessThanOrEqual(gradeConstants.LOSER_CAP);
    // …and the winners are still above them, which is the point of the line
    for (const id of ['b']) {
      expect(gradeOf(gs, id).grade).toBeGreaterThanOrEqual(gradeConstants.WIN_FLOOR);
    }
  });

  it('leaves the spread below the cap alone', () => {
    // A ceiling, not a flattening: the losing side still separates by tier.
    const fx = night(T(['top', 'low'], ['w', 'w2'], ['b', 'b2']), { black: 2, white: 3, blue: 7 }, {
      ratings: { top: 5, low: 1 },
    });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'top').grade).toBeGreaterThan(gradeOf(gs, 'low').grade);
  });

  describe('what the organiser wrote on the night (§2.57)', () => {
    // The reported case: שי scored four on a beaten team and marked 4.5, which
    // the organiser called abysmal and was right about — nothing in a night's
    // data can see a goal.
    it('lifts a player the note praised, past the losing team’s ceiling', () => {
      const plain = night(T(['שי', 'b'], ['w'], ['z']), { black: 2.5, white: 2.5, blue: 3.5 });
      const marked = night(T(['שי', 'b'], ['w'], ['z']), { black: 2.5, white: 2.5, blue: 3.5 }, {
        note: '@שי שם 4 גולים ++@',
      });
      const before = gradeOf(nightGrades([plain], plain.id), 'שי').grade;
      const after = gradeOf(nightGrades([marked], marked.id), 'שי').grade;
      expect(after).toBe(before + 1);
      // and their teammate, who was not named, has not moved
      expect(gradeOf(nightGrades([marked], marked.id), 'b').grade).toBe(
        gradeOf(nightGrades([plain], plain.id), 'b').grade,
      );
    });

    it('shows its working in the breakdown', () => {
      const fx = night(T(['שי'], ['w'], ['z']), { black: 2.5, white: 2.5, blue: 3.5 }, {
        note: '@שי שם 4 גולים +@',
      });
      const g = gradeOf(nightGrades([fx], fx.id), 'שי');
      expect(g.parts.events).toBe(0.5);
      // absent, not zero, on the ordinary night
      const quiet = night(T(['שי'], ['w'], ['z']), { black: 2.5, white: 2.5, blue: 3.5 });
      expect(gradeOf(nightGrades([quiet], quiet.id), 'שי').parts.events).toBeUndefined();
    });

    // The organiser's own words: "even if i add 20 +s make sure the cap is 0.5
    // below the MVP" — enforced downwards onto the field, never by lifting the
    // pick to stay ahead of it. See the test below for why that half went.
    it('keeps the pick clear however many markers somebody collects', () => {
      const fx = night(T(['loud'], ['pick'], ['z']), { black: 2.5, white: 2.5, blue: 3.5 }, {
        note: `@loud was everywhere ${'+'.repeat(20)}@`,
        mvpId: 'pick',
      });
      const gs = nightGrades([fx], fx.id)!;
      const mvp = gradeOf(gs, 'pick').grade;
      expect(gradeOf(gs, 'loud').grade).toBe(mvp - gradeConstants.MVP_CLEAR);
    });

    // **This reverses the rule as it was first built**, on the organiser's
    // instruction: "i want the MVP raiting to be the cap for the other players.
    // not the MVP gets pushed because other players got improved."
    //
    // The original MVP_CLEAR lifted the pick to half a point above the best
    // other mark. Harmless until §2.57 let the note move marks — and then a `+`
    // written about somebody else raised *the pick's* grade, so a player's mark
    // moved for words about a different player.
    it('does not move the pick for something said about somebody else', () => {
      const teams = T(['pick'], ['loud'], ['z']);
      const score = { black: 2.5, white: 2.5, blue: 3.5 };
      const quiet = night(teams, score, { mvpId: 'pick' });
      const praised = night(teams, score, {
        note: '@loud was everywhere ++++@',
        mvpId: 'pick',
      });
      expect(gradeOf(nightGrades([praised], praised.id), 'pick').grade).toBe(
        gradeOf(nightGrades([quiet], quiet.id), 'pick').grade,
      );
    });

    it('marks a player down when the note says so', () => {
      const plain = night(T(['a'], ['w'], ['z']), { black: 5, white: 3, blue: 2 });
      const marked = night(T(['a'], ['w'], ['z']), { black: 5, white: 3, blue: 2 }, {
        note: '@a scored an own goal --@',
      });
      expect(gradeOf(nightGrades([marked], marked.id), 'a').grade).toBeLessThan(
        gradeOf(nightGrades([plain], plain.id), 'a').grade,
      );
    });
  });

  it('never marks anybody who turned up below the played floor', () => {
    // The hardest case the formula can produce: a player whose team was
    // whitewashed, with a long record of the same behind them, so `night`,
    // `career` and `momentum` are all pulling down at once.
    const past = Array.from({ length: 8 }, () =>
      night(T(['sunk'], ['w'], ['b']), { black: 0, white: 7, blue: 5 }),
    );
    const fx = night(T(['sunk'], ['w'], ['b']), { black: 0, white: 8, blue: 4 }, {
      ratings: { sunk: 1 }, // bottom tier as well, for good measure
    });
    const g = gradeOf(nightGrades([...past, fx], fx.id), 'sunk');
    expect(g.context.trend).toBe('cold');
    expect(g.grade).toBe(gradeConstants.PLAYED_FLOOR);
  });

  it('remembers how recently somebody was picked player of the night', () => {
    // A player picked a fortnight earlier had two poor nights after it, which
    // is enough for `trend: 'cold'` — and the banter called it a free fall,
    // because the payload said "declining" and said nothing at all about the
    // pick. Counted in nights they played, so the honour does not age out
    // while somebody is away.
    const a = night(T(['p'], ['x'], ['y']), { black: 5, white: 3, blue: 2 }, { mvpId: 'p' });
    const b = night(T(['p'], ['x'], ['y']), { black: 1, white: 5, blue: 4 });
    const c = night(T(['p'], ['x'], ['y']), { black: 1, white: 5, blue: 4 });
    const gs = nightGrades([a, b, c], c.id)!;
    expect(gradeOf(gs, 'p').context.lastMvpAgo).toBe(2);
    // and the teammate who has never been picked says so with a null rather
    // than with a number that would read as "a long time ago"
    expect(gradeOf(gs, 'x').context.lastMvpAgo).toBeNull();
  });

  it('counts the MVP gap in their own nights, not in the club’s', () => {
    // Somebody who misses a month should not have their pick aged out by
    // nights they were not at.
    const own = night(T(['p'], ['x'], ['y']), { black: 5, white: 3, blue: 2 }, { mvpId: 'p' });
    const away = Array.from({ length: 4 }, () =>
      night(T(['q'], ['x'], ['y']), { black: 4, white: 4, blue: 4 }),
    );
    const back = night(T(['p'], ['x'], ['y']), { black: 1, white: 5, blue: 4 });
    const gs = nightGrades([own, ...away, back], back.id)!;
    expect(gradeOf(gs, 'p').context.lastMvpAgo).toBe(1); // their last night, not five ago
  });

  it('sits an average night exactly on the base mark', () => {
    // Three teams level: nobody beat the night's own average, so night is
    // zero, and a middle-tier player with no history has career, momentum and
    // tier at zero too. Every term is zero, so the mark is BASE — *exactly*,
    // now that the jitter is gone. It used to be "BASE give or take the
    // jitter", which is the looser thing this could honestly assert while a
    // hash was being added to every mark.
    const fx = night(T(['a'], ['b'], ['c']), { black: 3, white: 3, blue: 3 });
    const g = gradeOf(nightGrades([fx], fx.id), 'a');
    expect(g.parts).toMatchObject({ night: 0, mvp: 0, career: 0, momentum: 0, tier: 0 });
    expect(g.grade).toBe(BASE);
  });

  it('is the same answer every time it is asked', () => {
    const fx = night(T(['a'], ['b']), { black: 5, white: 2, blue: 0 });
    expect(nightGrades([fx], fx.id)).toEqual(nightGrades([fx], fx.id));
  });
});

// The cold-start nudge (§2.39) — an accepted, deliberately narrow exception to
// "no rating enters this formula", added on the organiser's explicit
// instruction after the plain formula flatlined an entire team's marks for
// three real weeks. Everything here is testing the two properties that make
// the trade-off the one that was actually agreed to: the bump is bounded and
// bucketed rather than the rating itself, and it is temporary rather than a
// standing leak.
describe('the tier shade', () => {
  it('gives a bottom-tier and a top-tier player different marks on an otherwise identical first night', () => {
    // The exact complaint this exists to answer: two players with nothing
    // else to distinguish them — same shirt, same night, no MVP, no history —
    // used to render as the identical number.
    const fx = night(T(['a', 'b'], ['x']), { black: 6, white: 2, blue: 0 }, { ratings: { a: 4.5, b: 1.5 } });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'a').parts.tier).toBeGreaterThan(gradeOf(gs, 'b').parts.tier);
  });

  it('buckets by tier, not by the rating itself', () => {
    // Two different top-tier ratings must land on the exact same bump — a
    // continuous map back to a rating is the one thing this cannot become.
    const fx = night(T(['a', 'b'], ['x']), { black: 6, white: 2, blue: 0 }, { ratings: { a: 4, b: 5 } });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'a').parts.tier).toBe(gradeOf(gs, 'b').parts.tier);
  });

  it('gives a middle rating no bump at all', () => {
    const fx = night(T(['a'], ['x']), { black: 4, white: 2, blue: 0 }, { ratings: { a: 3 } });
    expect(gradeOf(nightGrades([fx], fx.id), 'a').parts.tier).toBe(0);
  });

  it('gives two players the same mark when it knows nothing to separate them', () => {
    // What removing the jitter buys, stated as the property it is: a mark is
    // now a function of facts about the player, so identical facts give an
    // identical mark. It used to be a function of facts *and their id*, which
    // meant an unanswerable half-point between two debutants on one shirt.
    const fx = night(T(['one', 'two'], ['x'], ['y']), { black: 4, white: 4, blue: 4 });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'one').grade).toBe(gradeOf(gs, 'two').grade);
  });

  it('does not vary a mark by who is asking or when', () => {
    // The property the hash was providing for free and which now has to hold
    // on its own: same history, same fixture, same answer.
    for (let i = 0; i < 20; i++) {
      const fx = night(T([`p${i}`], ['x']), { black: 4, white: 2, blue: 0 });
      const first = gradeOf(nightGrades([fx], fx.id), `p${i}`).grade;
      const again = gradeOf(nightGrades([fx], fx.id), `p${i}`).grade;
      expect(again).toBe(first);
    }
  });

  it('never fades — a long career keeps the same shade as a debut', () => {
    // The deliberate reversal of an earlier design that tapered this to zero
    // by a fixed number of nights. The organiser maintains these ratings as
    // players improve and decline, so a term that switched itself off once
    // somebody had played enough would be fighting exactly the updates it is
    // supposed to reflect.
    const bottom = { ratings: { a: 1.5 } };
    const debut = night(T(['a'], ['x']), { black: 4, white: 2, blue: 0 }, bottom);
    const debutTier = gradeOf(nightGrades([debut], debut.id), 'a').parts.tier;
    expect(debutTier).toBeLessThan(0);

    const long = Array.from({ length: 30 }, () =>
      night(T(['a'], ['x']), { black: 3, white: 3, blue: 0 }, bottom),
    );
    const established = night(T(['a'], ['x']), { black: 4, white: 2, blue: 0 }, bottom);
    const lateTier = gradeOf(nightGrades([...long, established], established.id), 'a').parts.tier;
    expect(lateTier).toBe(debutTier);
  });

  it('follows a re-rating, using the rating the player held on that night', () => {
    // The organiser re-rates somebody upward mid-season. The nights they were
    // bottom-tier for keep the shade they were actually marked with, and the
    // nights after it get the new one — the same as-of-that-night rule every
    // other term in this file follows.
    const early = night(T(['a'], ['x']), { black: 4, white: 2, blue: 0 }, { ratings: { a: 1.5 } });
    const late = night(T(['a'], ['x']), { black: 4, white: 2, blue: 0 }, { ratings: { a: 4.5 } });
    const history = [early, late];
    expect(gradeOf(nightGrades(history, early.id), 'a').parts.tier).toBeLessThan(0);
    expect(gradeOf(nightGrades(history, late.id), 'a').parts.tier).toBeGreaterThan(0);
  });

  it('is outweighed by every part of the formula that is about actual football', () => {
    // The property that keeps a permanent rating term honest: it shades a
    // mark, it cannot carry one. A top-tier player on a blanked team must
    // still mark below a bottom-tier player whose team took the night.
    const fx = night(
      T(['strong'], ['weak']),
      { black: 0, white: 6, blue: 0 },
      { ratings: { strong: 5, weak: 1 } },
    );
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'weak').grade).toBeGreaterThan(gradeOf(gs, 'strong').grade);
  });

  it('stays smaller than momentum and the night itself', () => {
    // Stated as an assertion rather than left to the comments: this is what
    // keeps the rating a shade rather than a verdict.
    //
    // **It used to include `CAREER_CAP` and deliberately no longer does.** At
    // ±0.25 the rating was the weakest term in the formula and narrower than
    // the jitter, so a 5-star and a 2.5-star on one shirt came out identical —
    // the organiser's judgement outvoted by a hash. Widened to ±0.6 on their
    // explicit instruction, which puts it past career and still under the two
    // terms that must keep outranking it: what a player has actually been
    // doing, and what their team did tonight.
    const span = Math.max(...Object.values(gradeConstants.TIER_BUMP));
    expect(span).toBeLessThan(gradeConstants.NIGHT_CAP);
    // It now deliberately outranks form and record, on the organiser's
    // instruction — the assertion is inverted from what it used to be.
    expect(span).toBeGreaterThan(gradeConstants.MOMENTUM_CAP);
    expect(span).toBeGreaterThan(gradeConstants.CAREER_CAP);
  });

  it('still cannot lift a beaten player above a winning one', () => {
    // The line that actually bounds the rating now that its size does not.
    // A top-tier player whose team was hammered must stay below a bottom-tier
    // player whose team took the night, or these marks have stopped being
    // about the football.
    const fx = night(T(['star'], ['plodder'], ['z']), { black: 1, white: 7, blue: 4 }, {
      ratings: { star: 5, plodder: 2.5 },
    });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'star').grade).toBeLessThan(gradeOf(gs, 'plodder').grade);
  });

  it('lets the rating separate two teammates who are otherwise identical', () => {
    // The actual complaint, as a test. Same shirt, same result, same (empty)
    // history — so `night`, `career` and `momentum` are identical and the only
    // thing left between them is what the organiser thinks.
    const fx = night(T(['top', 'bottom'], ['x'], ['y']), { black: 4, white: 4, blue: 4 }, {
      ratings: { top: 5, bottom: 2.5 },
    });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'top').grade).toBeGreaterThan(gradeOf(gs, 'bottom').grade);
  });

  it('never lets the shade push a grade outside 1–10', () => {
    // The most extreme case the clamp has to survive: a bottom-tier player
    // whose team was also blanked.
    const fx = night(T(['a'], ['x']), { black: 0, white: 6, blue: 0 }, { ratings: { a: 1 } });
    const g = gradeOf(nightGrades([fx], fx.id), 'a');
    expect(g.grade).toBeGreaterThanOrEqual(1);
    expect(g.grade).toBeLessThanOrEqual(10);
  });

  it('reserves only the top two rungs for the player of the night', () => {
    // 9 must stay an ordinary mark anybody can earn — the cap is inclusive.
    // What it withholds is 9.5 and 10, so the two best marks of an evening say
    // something a scoreline cannot.
    const rout = night(T(['star'], ['x'], ['y']), { black: 9, white: 2, blue: 1 }, {
      ratings: { star: 5 },
    });
    const unpicked = gradeOf(nightGrades([rout], rout.id), 'star');
    expect(unpicked.grade).toBeLessThanOrEqual(gradeConstants.UNPICKED_CAP);
    expect(unpicked.grade).toBe(gradeConstants.UNPICKED_CAP); // reachable, not withheld

    const picked = night(T(['star'], ['x'], ['y']), { black: 9, white: 2, blue: 1 }, {
      ratings: { star: 5 },
      mvpId: 'star',
    });
    expect(gradeOf(nightGrades([picked], picked.id), 'star').grade).toBeGreaterThan(
      gradeConstants.UNPICKED_CAP,
    );
  });

  // **This reverses a deliberate earlier decision, on the organiser's ask.**
  // It used to assert the opposite — that a pick on a beaten team still marked
  // below whoever took the night, because `night` outweighs the MVP bonus by
  // some distance. That is defensible arithmetic and it buried the one fact a
  // night produces that a scoreline cannot: the room's own verdict. Reserving
  // the top two rungs for the pick was never the same as using them.
  //
  // The *guarantee* survived the rewrite below — the pick still finishes half a
  // point clear — but it is now reached by holding the field down rather than
  // by raising the pick, so this reads the gap and not the mechanism.
  it('finishes the pick clear of the field, even from a beaten team', () => {
    const fx = night(T(['picked'], ['winner'], ['z']), { black: 1, white: 8, blue: 3 }, {
      mvpId: 'picked',
    });
    const gs = nightGrades([fx], fx.id)!;
    const best = Math.max(...gs.filter((g) => !g.context.isMvp).map((g) => g.grade));
    expect(gradeOf(gs, 'picked').grade).toBe(best + gradeConstants.MVP_CLEAR);
    expect(gradeOf(gs, 'picked').grade).toBeGreaterThan(gradeOf(gs, 'winner').grade);
  });

  // **Reversed too, and this is the one that changed behaviour** — it used to
  // assert that naming a pick left everybody else's mark untouched. The gap is
  // now paid for by the field: whoever the room did not vote for finishes under
  // the pick, rather than the pick climbing over them. The reason is §2.57 —
  // see "does not move the pick for something said about somebody else".
  it('holds the field under the pick rather than climbing over it', () => {
    const fx = night(T(['picked'], ['winner'], ['z']), { black: 1, white: 8, blue: 3 }, {
      mvpId: 'picked',
    });
    const withPick = nightGrades([fx], fx.id)!;
    const without = nightGrades([{ ...fx, mvpId: undefined }], fx.id)!;
    // the pick's own mark is the same either way — the vote moves it through
    // PICK_BONUS, not through anybody else's grade
    expect(gradeOf(withPick, 'winner').grade).toBeLessThan(gradeOf(without, 'winner').grade);
    expect(gradeOf(withPick, 'winner').grade).toBe(
      gradeOf(withPick, 'picked').grade - gradeConstants.MVP_CLEAR,
    );
  });

  // Nowhere left to go is the honest answer, not a reason to demote the field.
  it('shares the top when somebody else is already on it', () => {
    const fx = night(T(['picked'], ['winner'], ['z']), { black: 1, white: 12, blue: 1 }, {
      ratings: { winner: 5, picked: 5 },
      mvpId: 'picked',
    });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'picked').grade).toBeLessThanOrEqual(10);
  });

  it('needs the night as well as the pick to reach the very top', () => {
    // "10 needs a team domination plus an MVP pick" — a pick on a narrow win
    // is a good mark, not a perfect one.
    const narrow = night(T(['a'], ['b'], ['c']), { black: 5, white: 4, blue: 3 }, { mvpId: 'a' });
    expect(gradeOf(nightGrades([narrow], narrow.id), 'a').grade).toBeLessThan(10);
  });

  // --- The vote (§2.46) ----------------------------------------------------
  //
  // The pick used to be one bit: you were it or you were not. A night can now
  // carry the whole tally, and these hold the two properties that make the
  // extra resolution safe to spend on a mark somebody reads about themselves.

  it('marks a landslide above a squeaker, which one bit could never say', () => {
    const votes = (mvpVotes: Record<string, number>) =>
      night(T(['a', 'b'], ['x'], ['y']), { black: 6, white: 3, blue: 2 }, { mvpId: 'a', mvpVotes });

    const walked = votes({ a: 5 });
    const shaded = votes({ a: 3, b: 2 });
    expect(gradeOf(nightGrades([walked], walked.id), 'a').parts.mvp).toBeGreaterThan(
      gradeOf(nightGrades([shaded], shaded.id), 'a').parts.mvp,
    );
    // and both are still recognisably the same honour, not two different ones
    expect(gradeOf(nightGrades([shaded], shaded.id), 'a').parts.mvp).toBeGreaterThan(
      gradeConstants.PICK_BONUS,
    );
  });

  it('gives the runner-up something, where before they were nobody', () => {
    const fx = night(T(['a', 'b', 'c'], ['x'], ['y']), { black: 6, white: 3, blue: 2 }, {
      mvpId: 'a',
      mvpVotes: { a: 3, b: 2 },
    });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'b').parts.mvp).toBeGreaterThan(0);
    // and a teammate nobody named still gets nothing, so the term stays a fact
    // about the person rather than a participation fee
    expect(gradeOf(gs, 'c').parts.mvp).toBe(0);
  });

  it('separates a landslide from a squeaker in the mark itself', () => {
    // The point of the whole feature, asserted on the printed number rather
    // than on `parts.mvp` — a term that moves and a mark that does not would
    // be a formula talking to itself.
    const votes = (mvpVotes: Record<string, number>) =>
      night(T(['a', 'b', 'c'], ['x'], ['y']), { black: 6, white: 3, blue: 3 }, {
        mvpId: 'a',
        mvpVotes,
      });
    const walked = votes({ a: 5 });
    const shaded = votes({ a: 3, b: 2 });
    expect(gradeOf(nightGrades([walked], walked.id), 'a').grade).toBeGreaterThan(
      gradeOf(nightGrades([shaded], shaded.id), 'a').grade,
    );
  });

  it('leaves a runner-up on the floor where the floor is what set their mark', () => {
    // Measured, and worth pinning because it is the limit of what the vote can
    // do: `WIN_FLOOR` has the winning team at 8 and a runner-up's raw mark is
    // under it, so 0.28 of a bonus changes nothing. Their recognition is the
    // tally beside the name and the sentence, not the figure. If this ever
    // starts failing, the floor moved — which is a decision, not a bug.
    const fx = night(T(['a', 'b', 'c'], ['x'], ['y']), { black: 6, white: 3, blue: 3 }, {
      mvpId: 'a',
      mvpVotes: { a: 3, b: 2 },
    });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'b').parts.mvp).toBeGreaterThan(0);
    expect(gradeOf(gs, 'b').grade).toBe(gradeOf(gs, 'c').grade); // both on the floor
    expect(gradeOf(gs, 'b').grade).toBe(gradeConstants.WIN_FLOOR);
  });

  it('does move a runner-up on a night nobody won outright', () => {
    // Level at the top means `PLAYED_FLOOR`, which is far below where these
    // marks land — so the vote has room and the runner-up reads a rung above
    // the teammate nobody named.
    const fx = night(T(['a', 'b', 'c'], ['x'], ['y']), { black: 4, white: 4, blue: 4 }, {
      mvpVotes: { a: 3, b: 3 },
    });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'b').grade).toBeGreaterThan(gradeOf(gs, 'c').grade);
  });

  it('never lets polling well outrank being picked', () => {
    // The property `PICK_BONUS` exists for: no arrangement of votes may put the
    // runner-up's mvp term above the winner's, however close the sheet.
    for (const [a, b] of [
      [3, 2],
      [4, 3],
      [8, 7],
      [2, 1],
    ] as const) {
      const fx = night(T(['a', 'b'], ['x'], ['y']), { black: 6, white: 3, blue: 2 }, {
        mvpId: 'a',
        mvpVotes: { a, b },
      });
      const gs = nightGrades([fx], fx.id)!;
      expect(gradeOf(gs, 'a').parts.mvp).toBeGreaterThan(gradeOf(gs, 'b').parts.mvp);
    }
  });

  it('leaves a night with no sheet marked exactly as it always was', () => {
    // Every night filed before the vote existed. Nothing about them may move,
    // which is why `MVP_BONUS` is still in the file.
    const fx = night(T(['a', 'b'], ['x'], ['y']), { black: 6, white: 3, blue: 2 }, { mvpId: 'a' });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'a').parts.mvp).toBe(gradeConstants.MVP_BONUS);
    expect(gradeOf(gs, 'b').parts.mvp).toBe(0);
    // and the payload says "not counted" rather than "nobody voted for you"
    expect(gradeOf(gs, 'b').context.votes).toBeNull();
    expect(gradeOf(gs, 'b').context.votesCast).toBeNull();
  });

  it('sits an untallied pick between the best and worst a counted one can do', () => {
    // The calibration claim in ROOM_W, asserted rather than left in a comment:
    // a club that never types a sheet is not quietly re-scored in either
    // direction, because the old flat bonus is the midpoint of the new span.
    const unanimous = gradeConstants.PICK_BONUS + gradeConstants.ROOM_W;
    expect(gradeConstants.MVP_BONUS).toBeGreaterThan(gradeConstants.PICK_BONUS);
    expect(gradeConstants.MVP_BONUS).toBeLessThan(unanimous);
    expect(gradeConstants.MVP_BONUS).toBeCloseTo((gradeConstants.PICK_BONUS + unanimous) / 2, 10);
  });

  it('still withholds the top two rungs from everyone but the pick', () => {
    // A runner-up on a rout polls well *and* has every other term going for
    // them. `UNPICKED_CAP` keys off the pick, not the votes, so they stop at 9.
    const fx = night(T(['star', 'second'], ['x'], ['y']), { black: 11, white: 1, blue: 0 }, {
      ratings: { star: 5, second: 5 },
      mvpId: 'star',
      mvpVotes: { star: 4, second: 3 },
    });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'second').grade).toBe(gradeConstants.UNPICKED_CAP);
    expect(gradeOf(gs, 'star').grade).toBeGreaterThan(gradeConstants.UNPICKED_CAP);
  });

  it('reads the sheet even when the pick is missing from it', () => {
    // A level sheet leaves `mvpId` unset (see mvpFromVotes) — the votes still
    // have to reach the marks, or a tied night would grade as an uncounted one.
    const fx = night(T(['a', 'b'], ['x'], ['y']), { black: 6, white: 3, blue: 2 }, {
      mvpVotes: { a: 3, b: 3 },
    });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'a').parts.mvp).toBeGreaterThan(0);
    expect(gradeOf(gs, 'a').parts.mvp).toBe(gradeOf(gs, 'b').parts.mvp);
    // neither of them is the pick, so neither gets the step or the top rungs
    expect(gradeOf(gs, 'a').parts.mvp).toBeLessThan(gradeConstants.PICK_BONUS);
    expect(gradeOf(gs, 'a').grade).toBeLessThanOrEqual(gradeConstants.UNPICKED_CAP);
  });

  it('does not charge a beaten player twice for the same losing run', () => {
    // The case that produced the momentum trim. A team took 2 of 12, so `night`
    // alone had everybody near the floor; a cold run then pushed a higher-rated
    // player *under* it, where the floor flattened them together with a
    // lower-rated teammate. `night` and `momentum` were charging for the same
    // fact — a beaten team is mostly made of players whose recent results are
    // losses.
    //
    // Ratings chosen to straddle a real `ratingTier` boundary (<=2.5 bottom,
    // >=4 top): 4 and 3.5 are genuinely different buckets, where 3.5 and 3 are
    // the same one and would prove nothing.
    const past = Array.from({ length: 5 }, () =>
      night(T(['cold'], ['w'], ['b']), { black: 1, white: 7, blue: 4 }),
    );
    const fx = night(T(['cold', 'lower'], ['w'], ['b']), { black: 2, white: 7, blue: 3 }, {
      ratings: { cold: 4, lower: 3.5 },
    });
    const gs = nightGrades([...past, fx], fx.id)!;
    expect(gradeOf(gs, 'cold').context.trend).toBe('cold'); // the drag is real
    // and the higher-rated player still finishes above the lower-rated one,
    // rather than being dragged under the floor to meet them
    expect(gradeOf(gs, 'cold').grade).toBeGreaterThan(gradeOf(gs, 'lower').grade);
  });

  it('still lets form move a mark in both directions, under the rating', () => {
    // The ordering here was deliberately inverted on 2026-08-28. It used to
    // assert that form outswung the tier; the organiser asked for the opposite,
    // so what survives is the weaker and more important claim: a player's own
    // recent form must still visibly move their mark *both ways*. A tier that
    // outranks form is a judgement call; a form term that does nothing is a
    // dead term, and that is what this now guards against.
    const build = (early: number, late: number) => {
      const old = Array.from({ length: 6 }, () =>
        night(T(['a'], ['x']), { black: early, white: 6 - early, blue: 0 }),
      );
      const recent = Array.from({ length: 5 }, () =>
        night(T(['a'], ['x']), { black: late, white: 6 - late, blue: 0 }),
      );
      const tonight = night(T(['a'], ['x']), { black: 3, white: 3, blue: 0 });
      return gradeOf(nightGrades([...old, ...recent, tonight], tonight.id), 'a');
    };
    const hot = build(1, 5);
    const cold = build(5, 1);
    expect(hot.parts.momentum).toBeGreaterThan(0);
    expect(cold.parts.momentum).toBeLessThan(0);
    // enough of a swing to be worth at least one step on a half-point scale
    expect(hot.parts.momentum - cold.parts.momentum).toBeGreaterThanOrEqual(0.5);
  });
});

// --- Finishing close to the winner (§2.48) ---------------------------------
//
// `WIN_FLOOR` lifts the winner to 8 and used to lift nobody else, which made
// the gap between first and second *largest on the closest nights* — the floor
// only fires when the win was narrow. These cover the fix and, more
// importantly, the three things that keep it from becoming a new problem.

describe('the closeness carry', () => {
  const marks = (wins: { black: number; white: number; blue: number }) => {
    const fx = night(T(['a'], ['b'], ['c']), wins);
    const gs = nightGrades([fx], fx.id)!;
    return {
      first: gradeOf(gs, 'a'),
      second: gradeOf(gs, 'b'),
      third: gradeOf(gs, 'c'),
    };
  };

  it('closes the gap on a night decided by half a win', () => {
    // The scoreline that prompted this. Was 8 / 6.5 / 5 — a rung and a half
    // between teams separated by one half-win out of ten and a half.
    const { first, second, third } = marks({ black: 4.5, white: 4, blue: 2 });
    expect(first.grade).toBe(8);
    expect(second.grade).toBe(7);
    // and the team that was genuinely beaten is not dragged up with them
    expect(third.grade).toBe(5);
  });

  it('leaves a convincing win exactly where it was', () => {
    // Self-limiting, and the property that keeps the blast radius small: a
    // winner who clears 8 on the margin alone was never floored, so there is
    // no lift to share and the night grades as it always did.
    for (const wins of [
      { black: 7, white: 3, blue: 2 },
      { black: 9, white: 2, blue: 1 },
    ]) {
      const { first, second, third } = marks(wins);
      expect(first.parts.close).toBe(0);
      expect(second.parts.close).toBe(0);
      expect(third.parts.close).toBe(0);
    }
    expect(marks({ black: 9, white: 2, blue: 1 }).second.grade).toBe(4.5);
  });

  it('never carries anybody past the winner', () => {
    // The ordering that has to survive: taking the night outright is worth
    // more than nearly taking it, however thin the margin. At team level the
    // runner-up tops out half a rung short — the WIN_BONUS, which no amount of
    // closeness can erode.
    for (const wins of [
      { black: 4.5, white: 4, blue: 2 },
      { black: 4, white: 3.5, blue: 3 },
      { black: 6, white: 5, blue: 4 },
      { black: 5, white: 4.5, blue: 1 },
      { black: 4.5, white: 4, blue: 3.5 },
    ]) {
      const { first, second, third } = marks(wins);
      expect(second.grade).toBeLessThan(first.grade);
      expect(third.grade).toBeLessThanOrEqual(second.grade);
    }
  });

  it('gives the winner nothing — they have the floor itself', () => {
    // Adding the lift to the winner as well would push them *above* 8 on the
    // strength of a floor that exists to stop them falling below it.
    expect(marks({ black: 4.5, white: 4, blue: 2 }).first.parts.close).toBe(0);
  });

  it('shares nothing when the night was level at the top', () => {
    // Nobody is floored on a shared night (§2.6), so there is no lift to pass
    // on — and a team that did not win one cannot hand out a share of it.
    const { first, second } = marks({ black: 5, white: 5, blue: 2 });
    expect(first.parts.close).toBe(0);
    expect(second.parts.close).toBe(0);
    expect(first.grade).toBe(second.grade);
  });

  it('fades with distance rather than lifting the whole night', () => {
    const { second, third } = marks({ black: 4.5, white: 4, blue: 2 });
    expect(second.parts.close).toBeGreaterThan(third.parts.close);
    expect(third.parts.close).toBeGreaterThan(0);
    // a team a full share of the night behind the winner gets none of it
    const far = marks({ black: 5, white: 4.5, blue: 1 });
    expect(far.third.parts.close).toBe(0);
  });

  it('adds rather than floors, so teammates are still told apart', () => {
    // The reason this is not simply a second floor. A floor flattens: all five
    // players on the runner-up would read one number regardless of their own
    // rating and form, which is the known cost of WIN_FLOOR (see WIN_BONUS)
    // and not one worth paying twice.
    const fx = night(T(['w1'], ['s1', 's2'], ['c']), { black: 4.5, white: 4, blue: 2 }, {
      ratings: { s1: 5, s2: 1 },
    });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 's1').parts.close).toBe(gradeOf(gs, 's2').parts.close);
    expect(gradeOf(gs, 's1').grade).toBeGreaterThan(gradeOf(gs, 's2').grade);
  });
});
