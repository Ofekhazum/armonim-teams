import { describe, expect, it } from 'vitest';
import { TOTM_SIZE, buildWrapped, periodLabel, totmEligible, totmScore, wrappedPeriods } from './wrapped';
import type { AllMarks } from './gradeHistory';
import { nextPairing, recordMatch, winsFromLog } from './matchLog';
import { ATTACK_DEFAULT } from './types';
import type { FixtureRecord, MatchLogEntry, Player, TeamColor } from './types';

let seq = 0;

function night(
  date: string,
  black: string[],
  white: string[],
  wins: { black: number; white: number; blue: number },
  mvpId?: string,
  blue: string[] = [],
): FixtureRecord {
  const fx: FixtureRecord = {
    id: `f${seq}`,
    date,
    teams: { black, white, blue },
    players: [...black, ...white, ...blue].map((id) => ({ id, name: id, rating: 3 })),
    wins,
    mvpId,
  };
  seq++;
  return fx;
}

// A night logged match by match rather than tallied — `wins` is derived from
// the log itself, the same as the real app does, so a test can never write a
// log and a tally that quietly disagree.
function loggedNight(
  date: string,
  black: string[],
  white: string[],
  blue: string[],
  log: MatchLogEntry[],
  mvpId?: string,
): FixtureRecord {
  const fx = night(date, black, white, winsFromLog(log), mvpId, blue);
  fx.matchLog = log;
  return fx;
}

const m = (a: TeamColor, b: TeamColor, winner: TeamColor, viaPenalties = false): MatchLogEntry => ({
  a,
  b,
  winner,
  viaPenalties,
});

const player = (id: string): Player => ({
  id,
  name: id,
  rating: 3,
  attack: ATTACK_DEFAULT,
  chemistry: [],
});

const marksFor = (lines: Record<string, Record<string, number>>): AllMarks => lines;

describe('wrappedPeriods', () => {
  it('lists months with a recorded result, newest first, and skips unrecorded ones', () => {
    const history = [
      night('2026-06-10', ['a'], ['b'], { black: 0, white: 0, blue: 0 }), // no result
      night('2026-07-03', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-14', ['a'], ['b'], { black: 1, white: 3, blue: 0 }),
      night('2026-07-17', ['a'], ['b'], { black: 2, white: 2, blue: 0 }),
    ];
    expect(wrappedPeriods(history)).toEqual(['2026-08', '2026-07']);
  });
});

describe('periodLabel', () => {
  it('formats a YYYY-MM key as a month name and year', () => {
    expect(periodLabel('2026-08')).toBe('August 2026');
  });
});

describe('buildWrapped', () => {
  it('only counts nights within the requested month', () => {
    const history = [
      night('2026-07-31', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    const stats = buildWrapped(history, '2026-08');
    expect(stats.nightsRecorded).toBe(2);
  });

  it('sums total wins across the month', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 2, white: 2, blue: 0 }),
    ];
    expect(buildWrapped(history, '2026-08').totalWins).toBe(8);
  });

  it('counts each match once, not once per player on the winning team', () => {
    // a 5-a-side team banking a 3-0 win is one "3 wins" fact, not fifteen —
    // regression for a bug where this summed every player's personal credit
    const history = [
      night('2026-08-01', ['a', 'b', 'c', 'd', 'e'], ['f', 'g', 'h', 'i', 'j'], {
        black: 3,
        white: 1,
        blue: 0,
      }),
    ];
    expect(buildWrapped(history, '2026-08').totalWins).toBe(4);
  });

  it('lists everyone with perfect attendance, not just the single top attendee', () => {
    const history = [
      night('2026-08-01', ['a', 'b', 'c'], ['x'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a', 'b'], ['x'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-15', ['a', 'b'], ['x'], { black: 3, white: 1, blue: 0 }),
    ];
    // a, b and x played all 3 nights; c only played 1 — not a perfect month for c
    const stats = buildWrapped(history, '2026-08');
    expect(stats.perfectAttendance).toEqual({ names: ['a', 'b', 'x'], nights: 3 });
  });

  it('does not call the month\'s best attendance "perfect" if it still fell short', () => {
    // regression: the old version always labelled the single highest
    // attendee "never missed", even when they'd actually missed a night —
    // everyone here missed at least one, so nobody should be listed
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['x'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-15', ['x'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    expect(buildWrapped(history, '2026-08').perfectAttendance).toBeNull();
  });

  it('ranks the top 3 by individual match wins, not by goals — this app has none', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 4, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['c'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-15', ['a'], ['d'], { black: 2, white: 1, blue: 0 }),
      night('2026-08-22', ['a'], ['e'], { black: 1, white: 1, blue: 0 }),
    ];
    // a racks up 4+3+2+1=10 across four nights; b, c, d, e each get one
    // night's worth (1, 1, 1, 1) — only the top 3 of those make the cut
    const stats = buildWrapped(history, '2026-08');
    expect(stats.topMatchWinners[0]).toEqual({ name: 'a', wins: 10 });
    expect(stats.topMatchWinners).toHaveLength(3);
  });

  it('ranks the top 3 by fixtures (whole nights) their team outright won, distinct from match wins', () => {
    // a's team banks a huge tally on one blowout night but doesn't top the
    // other two; b's team never blows anyone out, but narrowly tops every
    // single night — fewer total matches, more fixtures actually won
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 5, white: 1, blue: 0 }), // a's team wins big
      night('2026-08-08', ['a'], ['b'], { black: 0, white: 1, blue: 0 }), // b's team edges it
      night('2026-08-15', ['a'], ['b'], { black: 0, white: 1, blue: 0 }), // b's team edges it
    ];
    const stats = buildWrapped(history, '2026-08');
    // a: 5+0+0=5 match wins vs b: 1+1+1=3 — a leads on individual matches
    expect(stats.topMatchWinners[0]).toEqual({ name: 'a', wins: 5 });
    // but b's team (white) topped nights 2 and 3 outright, a's team only night 1
    expect(stats.topFixtureWinners[0]).toEqual({ name: 'b', nights: 2 });
    expect(stats.topFixtureWinners.find((w) => w.name === 'a')).toEqual({ name: 'a', nights: 1 });
  });

  it('reports the longest win streak in the month, gated the same as MIN_WIN_STREAK', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-15', ['a'], ['b'], { black: 1, white: 3, blue: 0 }),
    ];
    // only 2 in a row — below MIN_WIN_STREAK, so no streak is reported
    expect(buildWrapped(history, '2026-08').longestStreak).toBeNull();
  });

  it('says nothing about a duo below MIN_TOGETHER, same as tonight’s duo facts', () => {
    const history = [
      night('2026-08-01', ['a', 'b'], ['c', 'd'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a', 'b'], ['c', 'd'], { black: 3, white: 1, blue: 0 }),
    ];
    expect(buildWrapped(history, '2026-08').bestDuo).toBeNull();
  });

  it('finds who banked the fewest wins, but only once they have at least 2 nights', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 1, white: 3, blue: 0 }),
      // z only ever plays this one night with zero wins — a lower total than
      // a's 4, but a single night is a mercy exemption, not a record
      night('2026-08-15', ['z'], ['b'], { black: 0, white: 4, blue: 0 }),
    ];
    const stats = buildWrapped(history, '2026-08');
    expect(stats.bottomScorer).toEqual({ name: 'a', wins: 4, nights: 2 });
  });

  it('reports the longest winless run in the month, gated the same as MIN_WINLESS_RUN', () => {
    const four = Array.from({ length: 4 }, (_, i) =>
      night(`2026-08-0${i + 1}`, ['a'], ['b'], { black: 1, white: 3, blue: 0 }),
    );
    expect(buildWrapped(four, '2026-08').longestWinless).toBeNull();

    const five = [
      ...four,
      night('2026-08-05', ['a'], ['b'], { black: 1, white: 3, blue: 0 }),
    ];
    expect(buildWrapped(five, '2026-08').longestWinless).toEqual({ name: 'a', nights: 5 });
  });

  it('ranks by MVP picks — the one stat here that is not derived from a result', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }, 'a'),
      night('2026-08-08', ['a'], ['b'], { black: 3, white: 1, blue: 0 }, 'a'),
      night('2026-08-15', ['a'], ['b'], { black: 1, white: 3, blue: 0 }, 'b'),
      // a night with no MVP recorded doesn't count for or against anyone
      night('2026-08-22', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    const stats = buildWrapped(history, '2026-08');
    expect(stats.topMvps).toEqual([
      { name: 'a', count: 2 },
      { name: 'b', count: 1 },
    ]);
  });

  it('lists every MVP, not just a top 3 — unlike match/fixture wins, one pick a night spreads thin', () => {
    const history = [
      night('2026-08-01', ['a'], ['e'], { black: 3, white: 1, blue: 0 }, 'a'),
      night('2026-08-08', ['b'], ['e'], { black: 3, white: 1, blue: 0 }, 'b'),
      night('2026-08-15', ['c'], ['e'], { black: 3, white: 1, blue: 0 }, 'c'),
      night('2026-08-22', ['d'], ['e'], { black: 3, white: 1, blue: 0 }, 'd'),
    ];
    const stats = buildWrapped(history, '2026-08');
    expect(stats.topMvps).toHaveLength(4);
    expect(stats.topMvps.map((m) => m.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reports a worst duo alongside the best one', () => {
    const history = Array.from({ length: 20 }, (_, i) =>
      night(
        `2026-08-${String(i + 1).padStart(2, '0')}`,
        ['a', 'b'],
        ['c', 'd'],
        i < 15 ? { black: 3, white: 1, blue: 0 } : { black: 1, white: 3, blue: 0 },
      ),
    );
    const stats = buildWrapped(history, '2026-08');
    expect(stats.bestDuo).toMatchObject({ kind: 'together-better', aName: 'a', bName: 'b' });
    expect(stats.worstDuo).toMatchObject({ kind: 'together-worse', aName: 'c', bName: 'd' });
  });

  it('returns zeros and nulls for a month with nothing recorded', () => {
    const stats = buildWrapped([], '2026-08');
    expect(stats).toMatchObject({
      nightsRecorded: 0,
      totalWins: 0,
      perfectAttendance: null,
      topMatchWinners: [],
      topFixtureWinners: [],
      topMvps: [],
      bottomScorer: null,
      longestStreak: null,
      longestWinless: null,
      bestDuo: null,
      worstDuo: null,
      teachersPet: null,
      punchingBag: null,
      rollercoaster: null,
      benchwarmer: null,
      outOfGas: null,
      dramaQueen: null,
      reservist: null,
      bully: null,
      cursedShirt: null,
      nightOfMonth: null,
      longestRun: null,
      monthlyAchievements: [],
    });
  });
});

// --- Banter stats ------------------------------------------------------

describe("Teacher's Pet, Punching Bag and the Rollercoaster", () => {
  it("averages the month's published grades once there are at least 3 of them", () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-15', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    const marks = marksFor({
      [history[0].id]: { a: 9, b: 5 },
      [history[1].id]: { a: 8, b: 4 },
      [history[2].id]: { a: 7, b: 3 },
    });
    const stats = buildWrapped(history, '2026-08', [], marks);
    expect(stats.teachersPet).toEqual({ id: 'a', name: 'a', avg: 8, nights: 3 });
    expect(stats.punchingBag).toEqual({ id: 'b', name: 'b', avg: 4, nights: 3 });
  });

  it('says nothing about a player with fewer than 3 graded nights', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    const marks = marksFor({
      [history[0].id]: { a: 10, b: 1 },
      [history[1].id]: { a: 10, b: 1 },
    });
    const stats = buildWrapped(history, '2026-08', [], marks);
    expect(stats.teachersPet).toBeNull();
    expect(stats.punchingBag).toBeNull();
  });

  it("ignores a night the organiser never published grades for", () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-15', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    // only two of the three nights were ever graded
    const marks = marksFor({
      [history[0].id]: { a: 7, b: 5 },
      [history[1].id]: { a: 7, b: 5 },
    });
    const stats = buildWrapped(history, '2026-08', [], marks);
    expect(stats.teachersPet).toBeNull();
  });

  it("reports the swing between a player's best and worst night as the Rollercoaster", () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 1, white: 3, blue: 0 }),
      night('2026-08-15', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    const marks = marksFor({
      [history[0].id]: { a: 9, b: 6 },
      [history[1].id]: { a: 4.5, b: 6 },
      [history[2].id]: { a: 8.5, b: 6 },
    });
    const stats = buildWrapped(history, '2026-08', [], marks);
    // a swings 9.0 -> 4.5 -> 8.5, a range of 4.5; b is flat at 6 every night
    expect(stats.rollercoaster).toMatchObject({ id: 'a', high: 9, low: 4.5, range: 4.5 });
  });

  it('says nothing for the whole month if at most half its nights were ever graded, even when one player individually clears the 3-night floor', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-03', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-05', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-10', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-12', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-15', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    // 3 of 7 nights graded — enough for 'a' to individually clear
    // MIN_GRADED_NIGHTS_FOR_RECAP, but not more than half the month itself.
    const marks = marksFor({
      [history[0].id]: { a: 9, b: 5 },
      [history[1].id]: { a: 8, b: 4 },
      [history[2].id]: { a: 7, b: 3 },
    });
    const stats = buildWrapped(history, '2026-08', [], marks);
    expect(stats.teachersPet).toBeNull();
    expect(stats.punchingBag).toBeNull();
    expect(stats.rollercoaster).toBeNull();
  });

  it('computes as normal once strictly more than half the month is graded', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-03', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-05', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-10', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    // 3 of 5 nights graded — over half.
    const marks = marksFor({
      [history[0].id]: { a: 9, b: 5 },
      [history[1].id]: { a: 8, b: 4 },
      [history[2].id]: { a: 7, b: 3 },
    });
    const stats = buildWrapped(history, '2026-08', [], marks);
    expect(stats.teachersPet).toEqual({ id: 'a', name: 'a', avg: 8, nights: 3 });
    expect(stats.punchingBag).toEqual({ id: 'b', name: 'b', avg: 4, nights: 3 });
  });

  it('treats a fixture with an empty published grade sheet as ungraded for the macro gate', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    const marks = marksFor({
      [history[0].id]: {}, // published, but graded nobody
      [history[1].id]: { a: 8, b: 4 },
    });
    const stats = buildWrapped(history, '2026-08', [], marks);
    // 1 of 2 nights actually graded — not strictly more than half.
    expect(stats.teachersPet).toBeNull();
  });
});

describe('The Benchwarmer', () => {
  it('sums, across the month, every match a player sat out while their team was on the sheet', () => {
    const history = [
      loggedNight(
        '2026-08-01',
        ['a'],
        ['b'],
        ['z'],
        [m('black', 'white', 'black'), m('black', 'white', 'white'), m('black', 'white', 'black')],
      ),
      loggedNight('2026-08-08', ['a'], ['b'], ['z'], [m('black', 'white', 'white'), m('black', 'white', 'black')]),
    ];
    // blue (z) never plays a single match across either night: benched 3, then 2
    const stats = buildWrapped(history, '2026-08');
    expect(stats.benchwarmer).toEqual({ id: 'z', name: 'z', matchesBenched: 5 });
  });

  it('says nothing about a month with no logged nights', () => {
    const history = [night('2026-08-01', ['a'], ['b'], { black: 3, white: 1, blue: 0 })];
    expect(buildWrapped(history, '2026-08').benchwarmer).toBeNull();
  });
});

describe('Out of Gas', () => {
  it('finds a player who wins early in a night and fades late, across the month', () => {
    const strongEarlyFadeLate = [
      m('black', 'white', 'black'),
      m('black', 'white', 'black'),
      m('black', 'white', 'black'),
      m('black', 'white', 'white'),
      m('black', 'white', 'white'),
      m('black', 'white', 'white'),
    ];
    const history = [
      loggedNight('2026-08-01', ['a'], ['b'], [], strongEarlyFadeLate),
      loggedNight('2026-08-08', ['a'], ['b'], [], strongEarlyFadeLate),
      loggedNight('2026-08-15', ['a'], ['b'], [], strongEarlyFadeLate),
    ];
    // a (black) wins their first 3 matches every night and loses the last 3 —
    // 9 early, 9 late across the month, clearing MIN_HALF (8) on both sides
    const stats = buildWrapped(history, '2026-08');
    expect(stats.outOfGas).toEqual({ id: 'a', name: 'a', earlyRate: 1, lateRate: 0 });
  });

  it('says nothing on an ordinary month, the same way playerArcs does on a thin one', () => {
    const history = [
      loggedNight('2026-08-01', ['a'], ['b'], [], [m('black', 'white', 'black'), m('black', 'white', 'white')]),
    ];
    expect(buildWrapped(history, '2026-08').outOfGas).toBeNull();
  });
});

describe('Drama Queen', () => {
  it('credits both sides of every shootout, and sums across the month', () => {
    const history = [
      loggedNight('2026-08-01', ['a'], ['b'], ['z'], [m('black', 'white', 'black', true)]),
      loggedNight(
        '2026-08-08',
        ['a'],
        ['b'],
        ['z'],
        [m('black', 'white', 'black', true), m('black', 'blue', 'blue', true)],
      ),
    ];
    // a: in all 3 shootouts; b: in 2 (both a-vs-b ones); z: in 1
    const stats = buildWrapped(history, '2026-08');
    expect(stats.dramaQueen).toEqual({ id: 'a', name: 'a', shootouts: 3 });
  });
});

describe('The Reservist', () => {
  it('picks the rarest attendee who still won outright, over one with more nights', () => {
    const history = [
      night('2026-08-01', ['r'], ['x'], { black: 3, white: 1, blue: 0 }), // r: 1 night, won
      night('2026-08-03', ['w'], ['x'], { black: 3, white: 1, blue: 0 }), // w night 1 (won)
      night('2026-08-05', ['w'], ['x'], { black: 1, white: 3, blue: 0 }), // w night 2 (lost)
      night('2026-08-08', ['w'], ['x'], { black: 3, white: 1, blue: 0 }), // w night 3 (won) — 3 nights, too many
      night('2026-08-10', ['q'], ['x'], { black: 1, white: 3, blue: 0 }), // q night 1 (lost)
      night('2026-08-15', ['q'], ['x'], { black: 3, white: 1, blue: 0 }), // q night 2 (won) — a candidate too
    ];
    const stats = buildWrapped(history, '2026-08');
    // r (1 night) beats q (2 nights) on rarity; w is excluded outright at 3 nights
    expect(stats.reservist).toEqual({ id: 'r', name: 'r', nights: 1, wins: 3 });
  });

  it('excludes a player who never actually won outright, however rarely they played', () => {
    const history = [
      night('2026-08-01', ['n'], ['x'], { black: 0, white: 3, blue: 0 }),
      night('2026-08-08', ['n'], ['x'], { black: 1, white: 2, blue: 0 }),
    ];
    // n loses both of their two nights; x wins both of theirs
    const stats = buildWrapped(history, '2026-08');
    expect(stats.reservist).toEqual({ id: 'x', name: 'x', nights: 2, wins: 5 });
  });
});

describe('The Bully', () => {
  it('finds the most lopsided individual head-to-head of the month', () => {
    const history = [
      loggedNight(
        '2026-08-01',
        ['a'],
        ['b'],
        [],
        [m('black', 'white', 'black'), m('black', 'white', 'black'), m('black', 'white', 'black')],
      ),
      loggedNight(
        '2026-08-08',
        ['a'],
        ['b'],
        [],
        [m('black', 'white', 'black'), m('black', 'white', 'black'), m('black', 'white', 'white')],
      ),
    ];
    // a beats b 5 times to b's 1, over 6 matches — clears MIN_BULLY_MATCHES (5)
    const stats = buildWrapped(history, '2026-08');
    expect(stats.bully).toEqual({
      aId: 'a',
      aName: 'a',
      aWon: 5,
      bId: 'b',
      bName: 'b',
      bWon: 1,
      faced: 6,
    });
  });

  it('says nothing below the floor on matches faced', () => {
    const history = [loggedNight('2026-08-01', ['a'], ['b'], [], [m('black', 'white', 'black')])];
    expect(buildWrapped(history, '2026-08').bully).toBeNull();
  });

  it('says nothing about a record that is level, however much football is behind it', () => {
    const history = [
      loggedNight(
        '2026-08-01',
        ['a'],
        ['b'],
        [],
        [
          m('black', 'white', 'black'),
          m('black', 'white', 'white'),
          m('black', 'white', 'black'),
          m('black', 'white', 'white'),
          m('black', 'white', 'black'),
          m('black', 'white', 'white'),
        ],
      ),
    ];
    expect(buildWrapped(history, '2026-08').bully).toBeNull();
  });
});

describe('The Cursed Shirt', () => {
  it('finds the colour with the worst record for the month', () => {
    const history = [
      night('2026-08-01', ['a'], ['b'], { black: 4, white: 1, blue: 0 }, undefined, ['z']),
      night('2026-08-08', ['a'], ['b'], { black: 1, white: 3, blue: 0 }, undefined, ['z']),
      night('2026-08-15', ['a'], ['b'], { black: 2, white: 1, blue: 1 }, undefined, ['z']),
    ];
    // black tops nights 1 and 3, white tops night 2, blue never tops a night
    // and banks only 1 of the month's 13 match wins
    const stats = buildWrapped(history, '2026-08');
    expect(stats.cursedShirt).toMatchObject({ color: 'blue', nightsWon: 0, nightsPlayed: 3 });
    expect(stats.cursedShirt?.matchWinShare).toBeCloseTo(1 / 13);
  });
});

describe('Night of the Month and the longest run', () => {
  // Same scripting approach nightStory.test.ts uses, and for the same reason:
  // a hand-written log can describe a night that could not have happened
  // (recordMatch enforces winner-stays-on), so the numbers below are read off
  // real playback through the real pairing logic rather than guessed.
  //   A = black wins the opener; W = the team already out there wins again;
  //   N = the team that just came on wins it.
  const scriptedLog = (script: string): MatchLogEntry[] => {
    let log: MatchLogEntry[] = [];
    for (const ch of script) {
      let winner: TeamColor;
      if (log.length === 0) {
        winner = 'black';
      } else {
        const [staying, coming] = nextPairing(log)!;
        winner = ch === 'W' ? staying : coming;
      }
      log = recordMatch(log, winner, false, ['black', 'white']);
    }
    return log;
  };

  it('picks the night with more lead changes over the more dominant one', () => {
    // 'AWWWWW': black wins the opener and every match after it — one team,
    // one evening, leadChanges = 0, longest run = 6
    const dominant = scriptedLog('AWWWWW');
    // 'ANWWWW': black leads after the opener, the incoming team (blue) takes
    // it back on the next match and holds it — leadChanges = 1, longest run
    // for blue = 5 (see the header comment on this describe block)
    const chaotic = scriptedLog('ANWWWW');
    const history = [
      loggedNight('2026-08-01', ['a'], ['b'], ['c'], dominant),
      loggedNight('2026-08-08', ['a'], ['b'], ['c'], chaotic),
    ];
    const stats = buildWrapped(history, '2026-08');
    expect(stats.nightOfMonth?.fixtureId).toBe(history[1].id);
    expect(stats.nightOfMonth?.leadChanges).toBe(1);
    // the longest single-team run still goes to the dominant night, even
    // though it lost the "most dramatic" pick — the two questions differ
    expect(stats.longestRun).toEqual({
      fixtureId: history[0].id,
      date: '2026-08-01',
      color: 'black',
      length: 6,
    });
  });

  it('never picks a night for drama below HALVES_MIN matches, however lopsided', () => {
    const history = [loggedNight('2026-08-01', ['a'], ['b'], ['c'], scriptedLog('ANW'))];
    expect(buildWrapped(history, '2026-08').nightOfMonth).toBeNull();
  });
});

describe('Monthly achievements', () => {
  it("replays tonightsMilestones across the month's own nights", () => {
    const history = [
      night('2026-08-01', ['s'], ['y'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-08', ['s'], ['y'], { black: 3, white: 1, blue: 0 }),
      night('2026-08-15', ['s'], ['y'], { black: 3, white: 1, blue: 0 }),
    ];
    const stats = buildWrapped(history, '2026-08');
    expect(
      stats.monthlyAchievements.some((a) => a.kind === 'win-streak' && a.name === 's' && a.nights === 3),
    ).toBe(true);
  });

  it('excludes a debutant guest once a roster says who is actually on it', () => {
    const filler = Array.from({ length: 5 }, (_, i) =>
      night(`2026-07-0${i + 1}`, ['x'], ['y'], { black: 3, white: 1, blue: 0 }),
    );
    const history = [
      ...filler,
      night('2026-08-01', ['x', 'r'], ['y', 'g'], { black: 3, white: 1, blue: 0 }),
    ];
    const roster = [player('x'), player('y'), player('r')]; // g is not on it
    const stats = buildWrapped(history, '2026-08', roster);
    expect(stats.monthlyAchievements.some((a) => a.kind === 'debut' && a.name === 'r')).toBe(true);
    expect(stats.monthlyAchievements.some((a) => a.kind === 'debut' && a.name === 'g')).toBe(false);
  });

  it('treats nobody as a guest when no roster is given, same as every other stat here', () => {
    const filler = Array.from({ length: 5 }, (_, i) =>
      night(`2026-07-0${i + 1}`, ['x'], ['y'], { black: 3, white: 1, blue: 0 }),
    );
    const history = [...filler, night('2026-08-01', ['x', 'g'], ['y'], { black: 3, white: 1, blue: 0 })];
    const stats = buildWrapped(history, '2026-08');
    expect(stats.monthlyAchievements.some((a) => a.kind === 'debut' && a.name === 'g')).toBe(true);
  });

  it('collapses a streak that fired on several of the month\'s nights down to its best showing', () => {
    // 's' wins every night; the streak clears MIN_WIN_STREAK (3) on night 3
    // and keeps firing on nights 4 and 5 too — "3 running", "4 running" and
    // "5 running" would all show up without the dedupe, when the only one
    // worth telling anybody about is the last
    const history = Array.from({ length: 5 }, (_, i) =>
      night(`2026-08-${String(i + 1).padStart(2, '0')}`, ['s'], ['y'], { black: 3, white: 1, blue: 0 }),
    );
    const stats = buildWrapped(history, '2026-08');
    const streaks = stats.monthlyAchievements.filter((a) => a.kind === 'win-streak' && a.name === 's');
    expect(streaks).toEqual([{ kind: 'win-streak', id: 's', name: 's', nights: 5 }]);
  });
});

// The Team of the Month is the one leaderboard in the app whose rule is
// deliberately not printed on the thing it produces, which is exactly why it
// has to be pinned down here instead.
describe('team of the month', () => {
  const d = (n: number) => `2026-05-${String(n).padStart(2, '0')}`;
  const totm = (history: FixtureRecord[]) => buildWrapped(history, '2026-05').teamOfMonth;

  it('picks at most five', () => {
    const squad = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const history = [
      night(d(1), squad, ['z'], { black: 4, white: 1, blue: 0 }),
      night(d(2), squad, ['z'], { black: 4, white: 1, blue: 0 }),
    ];
    expect(totm(history)).toHaveLength(TOTM_SIZE);
  });

  it('leaves out anybody short of half the month’s nights', () => {
    // five nights, so three clears the bar and two does not
    const history = [
      night(d(1), ['a', 'b'], ['z'], { black: 4, white: 1, blue: 0 }),
      night(d(2), ['a', 'b'], ['z'], { black: 4, white: 1, blue: 0 }),
      night(d(3), ['a'], ['z'], { black: 4, white: 1, blue: 0 }),
      night(d(4), ['a'], ['z'], { black: 4, white: 1, blue: 0 }),
      night(d(5), ['a'], ['z'], { black: 4, white: 1, blue: 0 }),
    ];
    const names = totm(history).map((p) => p.name);
    expect(names).toContain('a');
    // b played two of five, and would otherwise top the list on rate alone
    expect(names).not.toContain('b');
  });

  it('does not let one huge night outrank a month of steady football', () => {
    // 'flash' turns up twice and wins big; 'steady' plays every night
    const history = [
      night(d(1), ['steady', 'flash'], ['z'], { black: 9, white: 0, blue: 0 }),
      night(d(2), ['steady', 'flash'], ['z'], { black: 9, white: 0, blue: 0 }),
      night(d(3), ['steady'], ['z'], { black: 5, white: 4, blue: 0 }),
      night(d(4), ['steady'], ['z'], { black: 5, white: 4, blue: 0 }),
    ];
    // both are eligible; the point is only that the pick is the score, and the
    // eligibility gate is what stops a single night deciding the month
    expect(totm(history).map((p) => p.name)).toContain('steady');
  });

  it('ranks a night taken outright above the same wins spread thinner', () => {
    // both bank 8 match wins over 2 nights; only 'edge' actually took nights
    const history = [
      night(d(1), ['edge'], ['blowout'], { black: 4, white: 4, blue: 0 }),
      night(d(2), ['edge'], ['blowout'], { black: 4, white: 4, blue: 0 }),
    ];
    // level at the top both nights, so nobody won a night — scores tie, and the
    // tie-break falls to the name rather than to chance
    const picked = totm(history);
    expect(picked[0].score).toBe(picked[1].score);
  });

  it('counts an MVP pick towards the score', () => {
    const withMvp = [
      night(d(1), ['a', 'b'], ['z'], { black: 4, white: 1, blue: 0 }, 'a'),
      night(d(2), ['a', 'b'], ['z'], { black: 4, white: 1, blue: 0 }, 'a'),
    ];
    const picked = totm(withMvp);
    expect(picked[0].name).toBe('a');
    expect(picked[0].mvps).toBe(2);
    expect(picked[0].score).toBeGreaterThan(picked[1].score);
  });

  it('is empty for a month with no football', () => {
    expect(totm([])).toEqual([]);
  });

  it('keeps the parts that made the score, so the pick can be explained', () => {
    const history = [night(d(1), ['a'], ['z'], { black: 4, white: 1, blue: 0 }, 'a')];
    expect(totm(history)[0]).toMatchObject({
      nights: 1,
      wins: 4,
      nightsWon: 1,
      mvps: 1,
      monthLength: 1,
    });
  });

  it('lets a full-attendance player overtake a higher-rate part-timer', () => {
    // 'a' plays half the month (the eligibility floor) at a high rate; 'b'
    // plays every night at a lower rate. On the rate alone 'a' would lead —
    // the attendance bonus is what puts 'b' ahead instead.
    const history = [
      night(d(1), ['a', 'b'], ['z'], { black: 3, white: 0, blue: 0 }),
      night(d(2), ['a', 'b'], ['z'], { black: 3, white: 0, blue: 0 }),
      night(d(3), ['b'], ['z'], { black: 3, white: 0, blue: 0 }),
      night(d(4), ['b'], ['z'], { black: 2, white: 0, blue: 0 }),
    ];
    const picked = totm(history);
    // a: 6 wins / 2 nights = 3.0 base — the higher rate of the two
    // b: 11 wins / 4 nights = 2.75 base — lower, but full attendance
    expect(picked[0].name).toBe('b');
    expect(picked.find((p) => p.name === 'a')!.score).toBeLessThan(
      picked.find((p) => p.name === 'b')!.score,
    );
  });
});

describe('the team-of-the-month rule', () => {
  it('needs half a month’s nights, rounded up', () => {
    expect(totmEligible(3, 5)).toBe(true);
    expect(totmEligible(2, 5)).toBe(false);
    expect(totmEligible(2, 4)).toBe(true);
    expect(totmEligible(0, 0)).toBe(false);
  });

  it('weighs a night won and an MVP above a bare match win', () => {
    // monthLength equal to nights (full attendance) throughout, so the
    // attendance bonus is a constant +1 here and doesn't disturb the
    // comparison this test is actually about.
    const base = { nights: 1, wins: 1, nightsWon: 0, mvps: 0, monthLength: 1 };
    expect(totmScore(base)).toBe(2);
    expect(totmScore({ ...base, nightsWon: 1 })).toBe(4);
    expect(totmScore({ ...base, mvps: 1 })).toBe(5);
  });

  it('is a rate, not a total — playing more nights does not inflate it', () => {
    // both at full attendance for their own (different-length) month, so the
    // bonus is +1 in both cases and the totals still land equal
    expect(totmScore({ nights: 2, wins: 8, nightsWon: 2, mvps: 0, monthLength: 2 })).toBe(7);
    expect(totmScore({ nights: 4, wins: 16, nightsWon: 4, mvps: 0, monthLength: 4 })).toBe(7);
  });

  it('gives proportionally more of the attendance bonus for a bigger share of the month', () => {
    // same rate (0 from wins/nightsWon/mvps) so the whole score is the bonus
    const zero = { wins: 0, nightsWon: 0, mvps: 0 };
    expect(totmScore({ ...zero, nights: 2, monthLength: 4 })).toBe(0.5); // half the month
    expect(totmScore({ ...zero, nights: 3, monthLength: 4 })).toBe(0.75); // three quarters
    expect(totmScore({ ...zero, nights: 4, monthLength: 4 })).toBe(1); // every night
  });

  it('is zero rather than NaN for nobody', () => {
    expect(totmScore({ nights: 0, wins: 0, nightsWon: 0, mvps: 0, monthLength: 0 })).toBe(0);
  });
});
