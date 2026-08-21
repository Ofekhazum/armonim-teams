import { describe, expect, it } from 'vitest';
import {
  consecutiveMatches,
  loserOf,
  nextPairing,
  playedCounts,
  pointsFor,
  recordMatch,
  restingTeam,
  sameLog,
  winsFromLog,
} from './matchLog';
import type { MatchLogEntry } from './types';

// The rule that makes logging worth doing is that after the first pairing
// nobody has to decide anything: the winner stays on, the team that has been
// standing about comes in. Everything here is really one question — does the
// night drive itself correctly from the results?

const m = (a: string, b: string, winner: string, viaPenalties = false) =>
  ({ a, b, winner, viaPenalties }) as MatchLogEntry;

describe('restingTeam', () => {
  it('names the third team whichever two are playing', () => {
    expect(restingTeam('black', 'white')).toBe('blue');
    expect(restingTeam('blue', 'black')).toBe('white');
    expect(restingTeam('white', 'blue')).toBe('black');
  });
});

describe('nextPairing', () => {
  it('has no answer before the first match, because that one is chosen', () => {
    expect(nextPairing([])).toBeNull();
  });

  it('keeps the winner on and brings the resting team in', () => {
    // the example from the brief: blue beat white, so blue play black next
    expect(nextPairing([m('white', 'blue', 'blue')])).toEqual(['blue', 'black']);
  });

  it('sends the loser off no matter which side of the pairing they were', () => {
    expect(nextPairing([m('black', 'white', 'black')])).toEqual(['black', 'blue']);
    expect(nextPairing([m('white', 'black', 'black')])).toEqual(['black', 'blue']);
  });

  it('treats a win on penalties exactly like any other for who stays on', () => {
    // it is worth half a win, not half a stay
    expect(nextPairing([m('black', 'white', 'white', true)])).toEqual(['white', 'blue']);
  });

  it('only ever looks at the last match', () => {
    const log = [m('black', 'white', 'black'), m('black', 'blue', 'blue')];
    expect(nextPairing(log)).toEqual(['blue', 'white']);
  });
});

describe('winsFromLog', () => {
  it('gives a win before penalties one point and one on penalties a half', () => {
    const log = [m('black', 'white', 'black'), m('black', 'blue', 'black', true)];
    expect(winsFromLog(log)).toEqual({ black: 1.5, white: 0, blue: 0 });
  });

  it('gives the beaten team nothing, penalties or not', () => {
    expect(winsFromLog([m('black', 'white', 'black', true)])).toEqual({
      black: 0.5,
      white: 0,
      blue: 0,
    });
  });

  it('is zero all round before anything is played', () => {
    expect(winsFromLog([])).toEqual({ black: 0, white: 0, blue: 0 });
  });
});

describe('playedCounts', () => {
  it('counts matches played, which a win tally alone can never say', () => {
    // two wins from two is not two wins from six, and only the log knows
    const log = [m('black', 'white', 'black'), m('black', 'blue', 'black')];
    expect(playedCounts(log)).toEqual({ black: 2, white: 1, blue: 1 });
  });
});

describe('consecutiveMatches', () => {
  it('counts the run a team is currently on', () => {
    const log = [m('black', 'white', 'black'), m('black', 'blue', 'black')];
    expect(consecutiveMatches(log, 'black')).toBe(2);
  });

  it('is zero for the team that is off', () => {
    const log = [m('black', 'white', 'black'), m('black', 'blue', 'black')];
    expect(consecutiveMatches(log, 'white')).toBe(0);
  });

  it('resets after a team has been off, rather than totalling their night', () => {
    const log = [
      m('black', 'white', 'white'), // black off
      m('white', 'blue', 'blue'), // white off
      m('blue', 'black', 'black'), // black back on
    ];
    expect(consecutiveMatches(log, 'black')).toBe(1);
  });
});

describe('recordMatch', () => {
  it('uses the chosen pairing for the very first match', () => {
    const log = recordMatch([], 'blue', false, ['white', 'blue']);
    expect(log).toEqual([m('white', 'blue', 'blue')]);
  });

  it('works out the pairing itself from then on', () => {
    let log = recordMatch([], 'blue', false, ['white', 'blue']);
    log = recordMatch(log, 'black', false);
    expect(log[1]).toEqual(m('blue', 'black', 'black'));
  });

  it('refuses a winner who was not on the pitch', () => {
    // the pairing stops being the organiser's to choose after the first match,
    // so this is the guard that keeps the log honest about who played whom
    const log = recordMatch([], 'blue', false, ['white', 'blue']);
    expect(() => recordMatch(log, 'white', false)).toThrow(/not playing/);
  });

  it('refuses to invent an opening pairing', () => {
    expect(() => recordMatch([], 'blue', false)).toThrow(/chosen/);
  });

  it('leaves the log it was given alone', () => {
    // the session is React state; mutating it in place is how a screen ends up
    // not re-rendering the thing that just changed
    const before = recordMatch([], 'blue', false, ['white', 'blue']);
    const snapshot = JSON.parse(JSON.stringify(before));
    recordMatch(before, 'black', false);
    expect(before).toEqual(snapshot);
  });

  it('drives a whole night from one choice and a string of results', () => {
    let log = recordMatch([], 'black', false, ['black', 'white']);
    for (const winner of ['blue', 'blue', 'black'] as const) {
      const pair = nextPairing(log)!;
      expect(pair).toContain(winner);
      log = recordMatch(log, winner, false);
    }
    expect(log.map((e) => `${e.a}v${e.b}:${e.winner}`)).toEqual([
      'blackvwhite:black',
      'blackvblue:blue',
      'bluevwhite:blue',
      'bluevblack:black',
    ]);
    // white lost their opener and did not get back on until someone beat blue
    expect(winsFromLog(log)).toEqual({ black: 2, white: 0, blue: 2 });
    expect(playedCounts(log)).toEqual({ black: 3, white: 2, blue: 3 });
  });
});

describe('pointsFor and loserOf', () => {
  it('are the two things the rest of the app asks of an entry', () => {
    expect(pointsFor(m('black', 'white', 'black'))).toBe(1);
    expect(pointsFor(m('black', 'white', 'black', true))).toBe(0.5);
    expect(loserOf(m('black', 'white', 'black'))).toBe('white');
    expect(loserOf(m('white', 'black', 'black'))).toBe('white');
  });
});

// Two copies of the night arrive from different places — one polled off the
// Worker, one held in the session — so they are never the same object even when
// they say the same thing. Without this check they chase each other every poll.
describe('sameLog', () => {
  it('sees two separately-built copies of the same night as equal', () => {
    const a = [m('black', 'white', 'black'), m('black', 'blue', 'blue', true)];
    const b = [m('black', 'white', 'black'), m('black', 'blue', 'blue', true)];
    expect(sameLog(a, b)).toBe(true);
    expect(a === b).toBe(false); // the point: reference equality would say no
  });

  it('two empty nights are the same night', () => {
    expect(sameLog([], [])).toBe(true);
  });

  it('notices a different length', () => {
    expect(sameLog([m('black', 'white', 'black')], [])).toBe(false);
  });

  it('notices a different winner', () => {
    expect(sameLog([m('black', 'white', 'black')], [m('black', 'white', 'white')])).toBe(false);
  });

  it('notices a win that became a shootout', () => {
    expect(sameLog([m('black', 'white', 'black')], [m('black', 'white', 'black', true)])).toBe(
      false,
    );
  });

  it('notices a different pairing', () => {
    expect(sameLog([m('black', 'white', 'black')], [m('black', 'blue', 'black')])).toBe(false);
  });
});
