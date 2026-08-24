import { describe, expect, it } from 'vitest';
import type { FixtureRecord, MatchLogEntry, TeamColor, Teams, TonightPlayer } from './types';
import { winsFromLog } from './matchLog';
import { MIN_MATCHES, derbyTonight } from './derby';

// Tonight's derby (§2.33). The pick is the closest record over at least
// MIN_MATCHES matches, with neither side past BOGEY_RATE — so most of what is
// worth asserting is about what it *declines* to name: a whitewash, the least
// lopsided pair on a lopsided sheet, a teammate, a single evening, a guest.

// `TonightPlayer` is deliberately tiny — a name and a shirt is all the group's
// view of a night ever carries (§2.28), and a derby needs nothing more.
const player = (id: string, over: Partial<TonightPlayer> = {}): TonightPlayer => ({
  id,
  name: id,
  ...over,
});

// Two per shirt keeps every fixture small enough to reason about by hand.
const TEAMS: Teams = { black: ['a', 'b'], white: ['c', 'd'], blue: ['e', 'f'] };
const SQUAD = ['a', 'b', 'c', 'd', 'e', 'f'];
const todays = (over: Record<string, Partial<TonightPlayer>> = {}) =>
  SQUAD.map((id) => player(id, over[id] ?? {}));

const m = (a: TeamColor, b: TeamColor, winner: TeamColor): MatchLogEntry => ({
  a,
  b,
  winner,
  viaPenalties: false,
});

let seq = 0;
const night = (log: MatchLogEntry[], teams: Teams = TEAMS): FixtureRecord => {
  seq++;
  return {
    id: `f${seq}`,
    date: `2026-03-${String(seq).padStart(2, '0')}`,
    teams,
    players: SQUAD.map((id) => ({ id, name: id, rating: 3 })),
    wins: winsFromLog(log),
    matchLog: log,
  };
};

// n matches of black beating white, which makes every black player n-0 up on
// every white player.
const blackBeatsWhite = (n: number) => night(Array.from({ length: n }, () => m('black', 'white', 'black')));
// ...and the reverse, for building a level record out of two nights.
const whiteBeatsBlack = (n: number) => night(Array.from({ length: n }, () => m('black', 'white', 'white')));

describe('derbyTonight', () => {
  it('says nothing at all with no history', () => {
    expect(derbyTonight(TEAMS, todays(), [])).toBeNull();
  });

  it('names a level rivalry once there is enough of it', () => {
    const derby = derbyTonight(TEAMS, todays(), [blackBeatsWhite(5), whiteBeatsBlack(5)])!;
    expect(derby).not.toBeNull();
    expect(derby.faced).toBe(10);
    expect(derby.gap).toBe(0);
    expect(derby.aWon).toBe(5);
    expect(derby.bWon).toBe(5);
  });

  it('holds its tongue on a single evening', () => {
    // The floor's actual job. One night of football is a description of an
    // evening, not of a rivalry, and with ~75 cross-team pairs on a sheet
    // something always looks level by accident.
    const derby = derbyTonight(TEAMS, todays(), [
      night([m('black', 'white', 'black'), m('black', 'white', 'white')]),
    ]);
    expect(derby).toBeNull();
  });

  it('refuses a whitewash however much of it there is', () => {
    // 20-0 clears the match floor twice over, and is the opposite of a derby.
    // This is the line between a derby and a bogey man (`matchupPicks`).
    expect(derbyTonight(TEAMS, todays(), [blackBeatsWhite(20)])).toBeNull();
  });

  it('would rather say nothing than crown the least lopsided of a lopsided lot', () => {
    // The ceiling's job, and the failure that ranking on the gap alone walks
    // straight into: 13-7 is the *closest* record on this sheet, and naming it
    // is announcing a bogey man by a different route.
    const history = [
      night(Array.from({ length: 13 }, () => m('black', 'white', 'black'))),
      night(Array.from({ length: 7 }, () => m('black', 'white', 'white'))),
    ];
    expect(derbyTonight(TEAMS, todays(), history)).toBeNull();
  });

  it('prefers the level record to the lopsided one', () => {
    // black v white finish 12-2; black v blue finish 5-5. Far more football in
    // the first, and the second is the rivalry.
    const history = [
      night(Array.from({ length: 12 }, () => m('black', 'white', 'black'))),
      night(Array.from({ length: 2 }, () => m('black', 'white', 'white'))),
      night(Array.from({ length: 5 }, () => m('black', 'blue', 'black'))),
      night(Array.from({ length: 5 }, () => m('black', 'blue', 'blue'))),
    ];
    const derby = derbyTonight(TEAMS, todays(), history)!;
    expect(derby.gap).toBe(0);
    expect([derby.aShirt, derby.bShirt]).toEqual(['black', 'blue']);
  });

  it('prefers the closer record even when the other has more football behind it', () => {
    // black v white are 11-9 over twenty; black v blue are 6-6 over twelve.
    // Volume does not buy its way past a closer record — that reordering is
    // the entire reason this metric replaced the contested-matches one.
    const history = [
      night(Array.from({ length: 11 }, () => m('black', 'white', 'black'))),
      night(Array.from({ length: 9 }, () => m('black', 'white', 'white'))),
      night(Array.from({ length: 6 }, () => m('black', 'blue', 'black'))),
      night(Array.from({ length: 6 }, () => m('black', 'blue', 'blue'))),
    ];
    const derby = derbyTonight(TEAMS, todays(), history)!;
    expect(derby.gap).toBe(0);
    expect(derby.faced).toBe(12);
    expect([derby.aShirt, derby.bShirt]).toEqual(['black', 'blue']);
  });

  it('takes the longer rivalry when two are equally close', () => {
    // 6-6 and 8-8 are both dead level; the second has more behind it. This is
    // the one place volume gets a say, and only as a tie-break.
    const history = [
      night(Array.from({ length: 6 }, () => m('black', 'white', 'black'))),
      night(Array.from({ length: 6 }, () => m('black', 'white', 'white'))),
      night(Array.from({ length: 8 }, () => m('black', 'blue', 'black'))),
      night(Array.from({ length: 8 }, () => m('black', 'blue', 'blue'))),
    ];
    const derby = derbyTonight(TEAMS, todays(), history)!;
    expect(derby.gap).toBe(0);
    expect(derby.faced).toBe(16);
    expect([derby.aShirt, derby.bShirt]).toEqual(['black', 'blue']);
  });

  // --- who is eligible -------------------------------------------------------

  it('ignores a pair who are on the same shirt tonight', () => {
    // 'a' and 'c' have a long level record, but tonight they are teammates —
    // there is no derby between two people playing on the same side.
    const history = [blackBeatsWhite(6), whiteBeatsBlack(6)];
    const sameTeam: Teams = { black: ['a', 'c'], white: ['b', 'd'], blue: ['e', 'f'] };
    const derby = derbyTonight(sameTeam, todays(), history);
    // Whatever it names, it must not be that pair.
    if (derby) {
      expect(new Set([derby.aId, derby.bId])).not.toEqual(new Set(['a', 'c']));
    }
  });

  it('never names a guest, whose id is new every week', () => {
    const history = [blackBeatsWhite(6), whiteBeatsBlack(6)];
    const withGuest = todays({ c: { isGuest: true }, d: { isGuest: true } });
    // c and d are the only opponents 'a' and 'b' have any record against.
    expect(derbyTonight(TEAMS, withGuest, history)).toBeNull();
  });

  it('leaves tonight out of the record they bring into tonight', () => {
    const history = [blackBeatsWhite(5), whiteBeatsBlack(5)];
    const tonight = history[history.length - 1];
    // Dropping the second night leaves 5-0, a whitewash, so nothing is named.
    expect(derbyTonight(TEAMS, todays(), history, tonight.id)).toBeNull();
  });

  // --- what counts -----------------------------------------------------------

  it('counts matches rather than nights', () => {
    // One night, ten matches, level. A night-counting version would see this
    // as a single data point and say nothing.
    const derby = derbyTonight(TEAMS, todays(), [
      night([
        ...Array.from({ length: 5 }, () => m('black', 'white', 'black')),
        ...Array.from({ length: 5 }, () => m('black', 'white', 'white')),
      ]),
    ])!;
    expect(derby.faced).toBe(10);
    expect(derby.gap).toBe(0);
  });

  it('ignores a night that was only tallied', () => {
    // No sequence in three totals, so no head-to-head to read (§2.17).
    const tallied: FixtureRecord = {
      ...blackBeatsWhite(1),
      matchLog: [],
      wins: { black: 9, white: 4, blue: 2 },
    };
    expect(derbyTonight(TEAMS, todays(), [tallied])).toBeNull();
  });

  it('does not count a match either of them sat out', () => {
    // black v blue while white rest: nothing here is about a white player.
    const history = [
      night(Array.from({ length: 10 }, () => m('black', 'blue', 'black'))),
      blackBeatsWhite(5),
      whiteBeatsBlack(5),
    ];
    const derby = derbyTonight(TEAMS, todays(), history)!;
    // black v white is the level pair; their 10 matches are the ones counted,
    // not the 10 black played against blue.
    expect([derby.aShirt, derby.bShirt]).toEqual(['black', 'white']);
    expect(derby.faced).toBe(10);
  });

  it('counts a shootout as the win it was', () => {
    // The half-point rule is about the night's tally, not about who beat whom.
    const shootouts = Array.from({ length: 10 }, (_, i) => ({
      ...m('black', 'white', i < 5 ? ('black' as TeamColor) : ('white' as TeamColor)),
      viaPenalties: true,
    }));
    const derby = derbyTonight(TEAMS, todays(), [night(shootouts)])!;
    expect(derby.faced).toBe(10);
    expect(derby.gap).toBe(0);
  });

  // --- presentation ----------------------------------------------------------

  it('orders the pair by tonight’s shirt, so it reads like the cards below it', () => {
    const derby = derbyTonight(TEAMS, todays(), [blackBeatsWhite(5), whiteBeatsBlack(5)])!;
    expect(derby.aShirt).toBe('black');
    expect(derby.bShirt).toBe('white');
    expect(TEAMS.black).toContain(derby.aId);
    expect(TEAMS.white).toContain(derby.bId);
  });

  it('attributes each side’s wins to the right player', () => {
    // black takes 7, white takes 5. Whoever is drawn first must be the one on
    // 7 — the arithmetic must not depend on which order the ids sort in.
    const derby = derbyTonight(TEAMS, todays(), [blackBeatsWhite(7), whiteBeatsBlack(5)])!;
    expect(derby.aShirt).toBe('black');
    expect(derby.aWon).toBe(7);
    expect(derby.bWon).toBe(5);
  });

  it('is the same answer every time it is asked', () => {
    const history = [blackBeatsWhite(6), whiteBeatsBlack(6)];
    const once = derbyTonight(TEAMS, todays(), history);
    const twice = derbyTonight(TEAMS, todays(), history);
    expect(once).toEqual(twice);
  });

  it('needs MIN_MATCHES, not MIN_MATCHES minus one', () => {
    // One short of the floor, as level as it is possible to be: still nothing.
    const short = [blackBeatsWhite(5), whiteBeatsBlack(MIN_MATCHES - 5 - 1)];
    expect(derbyTonight(TEAMS, todays(), short)).toBeNull();
    const exact = [blackBeatsWhite(5), whiteBeatsBlack(MIN_MATCHES - 5)];
    expect(derbyTonight(TEAMS, todays(), exact)!.faced).toBe(MIN_MATCHES);
  });
});
