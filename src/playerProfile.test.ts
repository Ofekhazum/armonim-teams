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
  teammateCounts,
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

// The plain count that the Teammates card leads with. Separate from the duo
// records on purpose: this is who someone plays alongside, which is always
// true, rather than whether a pair beats chance, which almost never fires.
describe('teammateCounts', () => {
  it('counts nights on the same team, and how many they won', () => {
    const history = [
      night(['a', 'b'], ['c'], [], { black: 4, white: 1, blue: 0 }),
      night(['a', 'b'], ['c'], [], { black: 1, white: 4, blue: 0 }),
      night(['a'], ['b'], [], { black: 4, white: 1, blue: 0 }),
    ];
    const mates = teammateCounts(history, 'a');
    expect(mates.find((m) => m.id === 'b')).toMatchObject({ together: 2, won: 1 });
    // the third night they were opponents, so it counts for neither
    expect(mates.find((m) => m.id === 'c')).toBeUndefined();
  });

  it('sorts by nights together, most first', () => {
    const history = [
      night(['a', 'b', 'c'], ['x'], [], { black: 4, white: 1, blue: 0 }),
      night(['a', 'b'], ['x'], [], { black: 4, white: 1, blue: 0 }),
    ];
    expect(teammateCounts(history, 'a').map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('skips nights with no result, since "won" would be a guess', () => {
    const history = [untallied(['a', 'b'], ['c'], [])];
    expect(teammateCounts(history, 'a')).toEqual([]);
  });

  it('is empty for someone who has never played', () => {
    expect(teammateCounts([night(['a'], ['b'], [], { black: 4, white: 1, blue: 0 })], 'ghost'))
      .toEqual([]);
  });

  it('names a guest from the night they played, not from a roster', () => {
    const fx = night(['a', 'g1'], ['c'], [], { black: 4, white: 1, blue: 0 });
    fx.players = fx.players.map((p) => (p.id === 'g1' ? { ...p, name: 'זרקא' } : p));
    expect(teammateCounts([fx], 'a')[0].name).toBe('זרקא');
  });
});

describe('the other two ladders', () => {
  it('marks nights-won rungs at 5, 10, 25 then every 50', () => {
    expect(fixtureRungs(4).map((r) => r.target)).toEqual([5]);
    expect(fixtureRungs(12).map((r) => r.target)).toEqual([5, 10, 25]);
    const deep = fixtureRungs(60);
    expect(deep[deep.length - 1].target).toBe(100);
  });

  it('marks the first MVP as a rung of its own', () => {
    // being picked at all is the event; a ladder starting at three would say
    // nothing to almost anybody for a season
    expect(mvpRungs(1)).toEqual([{ target: 1, reached: true }, { target: 3, reached: false }]);
    expect(mvpRungs(0)).toEqual([{ target: 1, reached: false }]);
  });
});

describe('ladderBadges', () => {
  const counts = (over = {}) => ({ nights: 0, nightsWon: 0, wins: 0, ...over });

  it('wears only the top rung of each ladder', () => {
    // 25 nights makes "10 nights" not worth saying any more
    const badges = ladderBadges(counts({ nights: 30 }), 0);
    expect(badges.map((b) => b.label)).toEqual(['25 nights']);
  });

  it('says nothing for a player who has crossed nothing', () => {
    expect(ladderBadges(counts({ nights: 9 }), 0)).toEqual([]);
  });

  it('carries a sentence explaining every badge', () => {
    for (const b of ladderBadges(counts({ nights: 25, wins: 100, nightsWon: 10 }), 3)) {
      expect(b.detail.length).toBeGreaterThan(10);
      expect(b.detail.endsWith('.')).toBe(true);
    }
  });

  it('names the first MVP differently from a count of them', () => {
    expect(ladderBadges(counts(), 1)[0].label).toBe('First MVP');
    expect(ladderBadges(counts(), 5)[0].label).toBe('5 MVPs');
  });

  it('counts a half-win as the half it is', () => {
    // 49.5 is not 50 wins, and rounding up would hand out a badge unearned
    expect(ladderBadges(counts({ wins: 49.5 }), 0)).toEqual([]);
    expect(ladderBadges(counts({ wins: 50 }), 0).map((b) => b.label)).toEqual(['50 wins']);
  });
});
