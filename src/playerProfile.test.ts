import { describe, expect, it } from 'vitest';
import type { FixtureRecord, MatchLogEntry, TeamColor } from './types';
import {
  MIN_PROFILE_NIGHTS,
  loggedNightsFor,
  fixtureRungs,
  ladderBadges,
  mvpRungs,
  nightRungs,
  profileCounts,
  profileNights,
  shirtNights,
  shootoutRecord,
  placeOf,
  sharedPlace,
  shootoutWins,
  matchupPicks,
  matchups,
  toGo,
  winRungs,
} from './playerProfile';

const TEAM_COLOURS: TeamColor[] = ['black', 'white', 'blue'];

// A player page is read as a statement about a person, which is exactly why
// the counting has to be dull and correct: an off-by-one in a streak, or a
// night with no result drawn as a defeat, is a small lie with somebody's name
// on it.

let seq = 0;

const night = (
  black: string[],
  white: string[],
  blue: string[],
  wins: { black: number; white: number; blue: number } | null,
  matchLog?: MatchLogEntry[],
): FixtureRecord => ({
  id: `f${seq++}`,
  // ascending so the natural order is also chronological
  date: `2026-01-${String(seq).padStart(2, '0')}`,
  teams: { black, white, blue },
  players: [...black, ...white, ...blue].map((id) => ({ id, name: id, rating: 3 })),
  wins: wins ?? { black: 0, white: 0, blue: 0 },
  ...(matchLog ? { matchLog } : {}),
});

// a night nobody ever typed a result into
const untallied = (black: string[], white: string[], blue: string[]) =>
  night(black, white, blue, null);

describe('profileNights', () => {
  it('lists only the nights this player was on the sheet, oldest first', () => {
    const history = [
      night(['a'], ['b'], [], { black: 3, white: 1, blue: 0 }),
      night(['b'], ['c'], [], { black: 3, white: 1, blue: 0 }),
      night([], ['a'], [], { black: 0, white: 4, blue: 1 }),
    ];
    const nights = profileNights(history, 'a');
    expect(nights.map((n) => n.shirt)).toEqual(['black', 'white']);
    expect(nights.map((n) => n.won)).toEqual([true, true]);
  });

  it('sorts by date rather than by the order nights were filed', () => {
    const late = night(['a'], ['b'], [], { black: 3, white: 1, blue: 0 });
    const early = { ...night(['a'], ['b'], [], { black: 0, white: 3, blue: 0 }), date: '2025-01-01' };
    expect(profileNights([late, early], 'a').map((n) => n.date)).toEqual([
      '2025-01-01',
      late.date,
    ]);
  });

  it('marks a night with no result as unknown, not as a loss', () => {
    // the distinction the whole ribbon rests on: turning up is not losing
    const nights = profileNights([untallied(['a'], ['b'], [])], 'a');
    expect(nights[0].won).toBeNull();
  });

  it('is empty for someone who has never played', () => {
    expect(profileNights([night(['a'], [], [], null)], 'ghost')).toEqual([]);
  });
});

describe('placeOf', () => {
  it('ranks the three teams by what they won', () => {
    const wins = { black: 5, white: 3, blue: 1 };
    expect(placeOf(wins, 'black')).toBe(1);
    expect(placeOf(wins, 'white')).toBe(2);
    expect(placeOf(wins, 'blue')).toBe(3);
  });

  it('gives both teams gold when they finish level at the top', () => {
    // standard competition ranking: the one below them is 3rd, not 2nd
    const wins = { black: 4, white: 4, blue: 2 };
    expect(placeOf(wins, 'black')).toBe(1);
    expect(placeOf(wins, 'white')).toBe(1);
    expect(placeOf(wins, 'blue')).toBe(3);
  });

  it('gives both teams silver when they finish level behind the winner', () => {
    const wins = { black: 6, white: 2, blue: 2 };
    expect(placeOf(wins, 'white')).toBe(2);
    expect(placeOf(wins, 'blue')).toBe(2);
  });

  it('gives everyone gold on a three-way tie', () => {
    const wins = { black: 3, white: 3, blue: 3 };
    expect(TEAM_COLOURS.map((c) => placeOf(wins, c))).toEqual([1, 1, 1]);
  });

  it('counts a half-win as the half it is', () => {
    expect(placeOf({ black: 3.5, white: 3, blue: 0 }, 'black')).toBe(1);
  });

  it('says when a place was shared', () => {
    expect(sharedPlace({ black: 4, white: 4, blue: 2 }, 'black')).toBe(true);
    expect(sharedPlace({ black: 4, white: 4, blue: 2 }, 'blue')).toBe(false);
  });
});

describe('the ribbon carries a place per night', () => {
  it('medals a night, and leaves an untallied one with none', () => {
    const history = [
      night(['a'], ['b'], ['c'], { black: 1, white: 5, blue: 3 }),
      untallied(['a'], ['b'], ['c']),
    ];
    const nights = profileNights(history, 'a');
    expect(nights[0].place).toBe(3);
    // no result recorded is not a third place — nobody finished anywhere
    expect(nights[1].place).toBeNull();
    expect(nights[1].shared).toBe(false);
  });

  it('keeps place and won as separate questions', () => {
    // level at the top: both finished first, but nobody *took* the night, so
    // it must not count towards nights won or a winning run
    const history = [night(['a'], ['b'], ['c'], { black: 4, white: 4, blue: 1 })];
    const nights = profileNights(history, 'a');
    expect(nights[0].place).toBe(1);
    expect(nights[0].shared).toBe(true);
    expect(nights[0].won).toBe(false);
    expect(profileCounts(nights).nightsWon).toBe(0);
  });
});

describe('profileCounts', () => {
  const won = (id: string) => night([id], ['x'], [], { black: 3, white: 1, blue: 0 });
  const lost = (id: string) => night([id], ['x'], [], { black: 1, white: 3, blue: 0 });

  it('counts nights, nights won and the matches their teams took', () => {
    const c = profileCounts(profileNights([won('a'), lost('a'), won('a')], 'a'));
    expect(c.nights).toBe(3);
    expect(c.nightsWon).toBe(2);
    expect(c.wins).toBe(3 + 1 + 3);
  });

  it('withholds the per-night rate until there is enough football', () => {
    const few = Array.from({ length: MIN_PROFILE_NIGHTS - 1 }, () => won('a'));
    expect(profileCounts(profileNights(few, 'a')).perNight).toBeNull();

    const enough = Array.from({ length: MIN_PROFILE_NIGHTS }, () => won('a'));
    expect(profileCounts(profileNights(enough, 'a')).perNight).toBe(3);
  });

  it('counts nights turned up for separately from nights with a result', () => {
    const c = profileCounts(profileNights([won('a'), untallied(['a'], ['x'], [])], 'a'));
    expect(c.onSheet).toBe(2);
    expect(c.nights).toBe(1); // the untallied night can't be won or lost
  });

  it('finds the longest run of winning nights, and the current one', () => {
    const history = [won('a'), won('a'), lost('a'), won('a')];
    const c = profileCounts(profileNights(history, 'a'));
    expect(c.bestRun).toBe(2);
    expect(c.currentRun).toBe(1);
  });

  it('reports no current run when the last night was lost', () => {
    const c = profileCounts(profileNights([won('a'), won('a'), lost('a')], 'a'));
    expect(c.bestRun).toBe(2);
    expect(c.currentRun).toBe(0);
  });

  it('does not let a night with no result break a run', () => {
    // it says nothing either way, so it is skipped rather than counted a loss
    const history = [won('a'), untallied(['a'], ['x'], []), won('a')];
    expect(profileCounts(profileNights(history, 'a')).currentRun).toBe(2);
  });

  it('handles a player with no nights at all', () => {
    const c = profileCounts([]);
    expect(c).toMatchObject({ nights: 0, wins: 0, perNight: null, bestRun: 0, currentRun: 0 });
  });
});

describe('shirtNights', () => {
  it('counts every shirt worn, including nights with no result', () => {
    const history = [
      night(['a'], [], [], { black: 3, white: 0, blue: 0 }),
      night([], ['a'], [], { black: 0, white: 3, blue: 0 }),
      untallied([], [], ['a']),
    ];
    expect(shirtNights(profileNights(history, 'a'))).toEqual({ black: 1, white: 1, blue: 1 });
  });
});

describe('the milestone ladder', () => {
  it('shows the rungs already reached and the next one, and stops there', () => {
    expect(nightRungs(12)).toEqual([
      { target: 10, reached: true },
      { target: 25, reached: false },
    ]);
  });

  it('shows only the next rung to someone who has reached none', () => {
    expect(nightRungs(0)).toEqual([{ target: 10, reached: false }]);
  });

  it('says how far the next rung is', () => {
    expect(toGo(nightRungs(12), 12)).toEqual({ target: 25, away: 13 });
  });

  it('counts a half-win towards a win milestone as the half it is', () => {
    // 49.5 wins is not 50 wins, and rounding up would announce a milestone
    // the player has not reached
    expect(toGo(winRungs(49.5), 49.5)).toEqual({ target: 50, away: 1 });
    expect(winRungs(49.5)[0]).toEqual({ target: 50, reached: false });
  });

  it('marks a rung reached exactly on the number', () => {
    expect(nightRungs(10)[0]).toEqual({ target: 10, reached: true });
    expect(toGo(nightRungs(10), 10)).toEqual({ target: 25, away: 15 });
  });
});

describe('shootouts', () => {
  const log = (winner: string, viaPenalties: boolean): MatchLogEntry => ({
    a: 'black',
    b: 'white',
    winner: winner as MatchLogEntry['winner'],
    viaPenalties,
  });

  it('splits what a player’s team won on penalties from what it won in play', () => {
    const history = [
      night(['a'], ['b'], [], { black: 2, white: 1, blue: 0 }, [
        log('black', true),
        log('black', false),
        log('white', true),
      ]),
    ];
    expect(shootoutRecord(history, 'a')).toEqual({ loggedNights: 1, taken: 1, wonInPlay: 1 });
    expect(shootoutRecord(history, 'b')).toEqual({ loggedNights: 1, taken: 1, wonInPlay: 0 });
  });

  it('ignores nights that were only tallied, since they cannot answer it', () => {
    const history = [night(['a'], ['b'], [], { black: 5, white: 1, blue: 0 })];
    expect(shootoutRecord(history, 'a')).toEqual({ loggedNights: 0, taken: 0, wonInPlay: 0 });
  });

  it('credits every player in the winning team, once each', () => {
    const history = [
      night(['a', 'b'], ['c'], [], { black: 1, white: 0, blue: 0 }, [log('black', true)]),
    ];
    const wins = shootoutWins(history);
    expect(wins.get('a')).toBe(1);
    expect(wins.get('b')).toBe(1);
    expect(wins.get('c') ?? 0).toBe(0);
  });

  it('counts how many of a player’s nights were logged match by match', () => {
    const history = [
      night(['a'], ['b'], [], { black: 1, white: 0, blue: 0 }, [log('black', false)]),
      night(['a'], ['b'], [], { black: 1, white: 0, blue: 0 }),
      night(['c'], ['b'], [], { black: 1, white: 0, blue: 0 }, [log('black', false)]),
    ];
    expect(loggedNightsFor(history, 'a')).toBe(1);
    expect(loggedNightsFor(history, 'c')).toBe(1);
    expect(loggedNightsFor(history, 'b')).toBe(2);
  });
});

// Who somebody plays with, and — new — who they play against. Everything here
// is a count of what happened to two teams, which is what lets the labels on
// screen have their fun without the numbers claiming anything.
describe('matchups', () => {
  it('counts nights alongside, and how many of those were won', () => {
    const history = [
      night(['a', 'b'], ['c'], [], { black: 4, white: 1, blue: 0 }),
      night(['a', 'b'], ['c'], [], { black: 1, white: 4, blue: 0 }),
    ];
    expect(matchups(history, 'a').find((m) => m.id === 'b')).toMatchObject({
      together: 2,
      togetherWon: 1,
      against: 0,
    });
  });

  it('counts nights opposite, and who took them', () => {
    const history = [
      night(['a'], ['b'], [], { black: 4, white: 1, blue: 0 }),
      night(['a'], ['b'], [], { black: 1, white: 4, blue: 0 }),
      night(['a'], ['b'], [], { black: 1, white: 4, blue: 0 }),
    ];
    expect(matchups(history, 'a').find((m) => m.id === 'b')).toMatchObject({
      against: 3,
      beat: 1,
      beatenBy: 2,
    });
  });

  it('credits neither when a third team takes the night', () => {
    // two players can be opponents on a night that has nothing to do with
    // either of them, and that is not a win over anybody
    const history = [night(['a'], ['b'], ['c'], { black: 1, white: 1, blue: 5 })];
    expect(matchups(history, 'a').find((m) => m.id === 'b')).toMatchObject({
      against: 1,
      beat: 0,
      beatenBy: 0,
    });
  });

  it('credits neither when the night finishes level at the top', () => {
    const history = [night(['a'], ['b'], [], { black: 3, white: 3, blue: 0 })];
    expect(matchups(history, 'a').find((m) => m.id === 'b')).toMatchObject({ beat: 0, beatenBy: 0 });
  });

  it('skips nights with no result', () => {
    expect(matchups([untallied(['a'], ['b'], [])], 'a')).toEqual([]);
  });
});

describe('matchupPicks', () => {
  const many = (n: number, black: string[], white: string[], wins: { black: number; white: number; blue: number }) =>
    Array.from({ length: n }, () => night(black, white, [], wins));

  it('separates who you played most with from who you won most with', () => {
    const history = [
      // 'often' is alongside for four nights, only one of them won
      ...many(3, ['a', 'often'], ['x'], { black: 1, white: 4, blue: 0 }),
      ...many(1, ['a', 'often'], ['x'], { black: 4, white: 1, blue: 0 }),
      // 'lucky' only three nights, but all three taken
      ...many(3, ['a', 'lucky'], ['x'], { black: 4, white: 1, blue: 0 }),
    ];
    const picks = matchupPicks(matchups(history, 'a'));
    expect(picks.playedMost?.id).toBe('often');
    expect(picks.wonMost?.id).toBe('lucky');
  });

  it('finds the bogey man and the favourite victim', () => {
    const history = [
      ...many(4, ['a'], ['bogey'], { black: 1, white: 4, blue: 0 }),
      ...many(3, ['a'], ['victim'], { black: 4, white: 1, blue: 0 }),
    ];
    const picks = matchupPicks(matchups(history, 'a'));
    expect(picks.bogey?.id).toBe('bogey');
    expect(picks.victim?.id).toBe('victim');
  });

  it('only names someone never played alongside if they are around a lot', () => {
    const rare = matchupPicks(matchups(many(2, ['a'], ['b'], { black: 4, white: 1, blue: 0 }), 'a'));
    expect(rare.neverTogether).toBeNull();

    const often = matchupPicks(matchups(many(6, ['a'], ['b'], { black: 4, white: 1, blue: 0 }), 'a'));
    expect(often.neverTogether?.id).toBe('b');
  });

  it('says nothing at all rather than naming a one-off', () => {
    const picks = matchupPicks(matchups([night(['a', 'b'], ['c'], [], { black: 4, white: 1, blue: 0 })], 'a'));
    expect(picks.playedMost).toBeNull();
    expect(picks.victim).toBeNull();
  });
});
