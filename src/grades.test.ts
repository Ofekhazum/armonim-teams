import { describe, expect, it } from 'vitest';
import type { FixtureRecord, MatchLogEntry } from './types';
import { BASE, MIN_RECENT, gradeConstants, nightGrades } from './grades';

// The mark out of ten (§2.39). What matters here is that the number is
// arithmetic a reader could check: that teammates share the part of it which
// is about the team, that only real per-player facts separate them, and that
// tonight never quietly raises the bar it is measured against.

let seq = 0;
const night = (
  teams: { black: string[]; white: string[]; blue: string[] },
  wins: { black: number; white: number; blue: number },
  extra: { mvpId?: string; matchLog?: MatchLogEntry[]; ratings?: Record<string, number> } = {},
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
    // components rather than the rounded total, because jitter (deliberately
    // small, deliberately uncorrelated with anybody) can land close enough to
    // a rounding boundary that the *totals* are not reliably ordered, which is
    // the point of it being noise rather than a second signal.
    const fx = night(T(['a', 'b'], ['x']), { black: 6, white: 2, blue: 0 }, { mvpId: 'a' });
    const gs = nightGrades([fx], fx.id)!;
    expect(gradeOf(gs, 'a').parts).toMatchObject({ career: 0, momentum: 0, tier: 0, mvp: 1 });
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

  it('sits an average night on the base mark, up to the jitter', () => {
    // Three teams level: nobody beat the night's own average, so night is
    // zero, and a middle-tier player with no history has career, momentum and
    // tier all at zero too. The *football* is therefore exactly BASE — but
    // jitter is permanent (see below), so the printed mark is BASE give or
    // take it, which is what this can honestly assert.
    const fx = night(T(['a'], ['b'], ['c']), { black: 3, white: 3, blue: 3 });
    const g = gradeOf(nightGrades([fx], fx.id), 'a');
    expect(g.parts).toMatchObject({ night: 0, mvp: 0, career: 0, momentum: 0, tier: 0 });
    // ±jitter, then rounding to the nearest half on top of it.
    expect(Math.abs(g.grade - BASE)).toBeLessThanOrEqual(gradeConstants.JITTER_SPAN + 0.5);
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

  it('never lets jitter alone exceed its own bound', () => {
    // Bounded by construction, but checked across enough ids that a mistake
    // in the hash (e.g. an off-by-one in the normalisation) would show up as
    // an occasional outlier rather than passing by luck on one sample.
    for (let i = 0; i < 40; i++) {
      const fx = night(T([`p${i}`], ['x']), { black: 4, white: 2, blue: 0 });
      const jitter = gradeOf(nightGrades([fx], fx.id), `p${i}`).parts.jitter;
      expect(Math.abs(jitter)).toBeLessThanOrEqual(gradeConstants.JITTER_SPAN);
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
    expect(span).toBeLessThan(gradeConstants.MOMENTUM_CAP);
    expect(span).toBeLessThan(gradeConstants.NIGHT_CAP);
    // and it must stay clear of the noise it was being drowned by
    expect(span).toBeGreaterThan(gradeConstants.JITTER_SPAN);
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

  it('leaves momentum its full weight — the shade is an addition, not a replacement', () => {
    // Guarding the thing that was explicitly asked to survive this change: a
    // player's own recent form must still move their mark, and by more than
    // their tier does.
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
    // and the swing form can produce is wider than the whole tier span
    const tierSpan = Math.max(...Object.values(gradeConstants.TIER_BUMP)) * 2;
    expect(hot.parts.momentum - cold.parts.momentum).toBeGreaterThan(tierSpan);
  });
});
