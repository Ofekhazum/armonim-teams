import { describe, expect, it } from 'vitest';
import type { FixtureRecord, MatchLogEntry, TeamColor } from './types';
import { nextPairing, recordMatch, winsFromLog } from './matchLog';
import {
  MIN_BOUNCE,
  MIN_HALF,
  bounceVsClub,
  clubBounce,
  lean,
  playerArcs,
  rate,
} from './playerArcs';

// Same night script as nightStory.test.ts, and for the same reason: who *can*
// win match 7 is decided by matches 1-6, so naming colours would mostly
// describe football that could not have happened.
//
//   A / B — the opening match (black v white), won by black / by white
//   W     — the team already out there wins again
//   N     — the team that has just come on wins it
const logOf = (script: string): MatchLogEntry[] => {
  let log: MatchLogEntry[] = [];
  for (const ch of script) {
    let winner: TeamColor;
    if (log.length === 0) {
      winner = ch === 'A' ? 'black' : 'white';
    } else {
      const [staying, coming] = nextPairing(log)!;
      winner = ch === 'W' ? staying : coming;
    }
    log = recordMatch(log, winner, false, ['black', 'white']);
  }
  return log;
};

let seq = 0;
const night = (script: string): FixtureRecord => {
  seq++;
  const matchLog = logOf(script);
  return {
    id: `f${seq}`,
    date: `2026-05-${String(seq).padStart(2, '0')}`,
    teams: { black: ['b1'], white: ['w1'], blue: ['u1'] },
    players: ['b1', 'w1', 'u1'].map((id) => ({ id, name: id, rating: 3 })),
    wins: winsFromLog(matchLog),
    matchLog,
  };
};

// A night with no log at all — the old way, three totals typed in at the end.
const tallied = (): FixtureRecord => ({
  ...night(''),
  matchLog: [],
  wins: { black: 3, white: 2, blue: 1 },
});

describe('playerArcs', () => {
  it('ignores nights that were only tallied', () => {
    // there is no sequence in three totals, so there is no "when" to read
    const arcs = playerArcs([tallied()], 'b1');
    expect(arcs.loggedNights).toBe(0);
    expect(arcs.matches).toBe(0);
  });

  it('counts only the matches the player’s team was in', () => {
    // black plays 1, 2, 3; white plays 1 and 3; blue plays 2
    const arcs = playerArcs([night('AWN')], 'u1');
    expect(arcs.matches).toBe(1);
    expect(arcs.won).toBe(0);
  });

  it('says nothing about somebody who was not there', () => {
    expect(playerArcs([night('AWN')], 'nobody').matches).toBe(0);
  });

  describe('coming off a loss', () => {
    it('counts the match after a loss, which is the match after the bench', () => {
      // black takes the opener, loses match 2, sits out match 3, and is beaten
      // again on their way back in
      const arcs = playerArcs([night('ANNW')], 'b1');
      expect(arcs.bounce).toEqual({ played: 1, won: 0 });
    });

    it('does not count the first match of a night, which follows nothing', () => {
      const arcs = playerArcs([night('A')], 'b1');
      expect(arcs.bounce.played).toBe(0);
    });

    it('does not carry a loss over from last week', () => {
      // two separate nights: the first match of the second night follows a
      // loss only in the sense that a week went past
      const a = night('AN'); // black wins then loses
      const b = night('AN');
      const arcs = playerArcs([a, b], 'b1');
      // one bounce per night at most, and the second night's opener is not one
      expect(arcs.bounce.played).toBe(0);
    });

    it('counts the ones they win too', () => {
      // white are beaten in the opener and win the match they come back for —
      // and their next match follows a win, so it is not a return at all
      const arcs = playerArcs([night('ANNW')], 'w1');
      expect(arcs.bounce).toEqual({ played: 1, won: 1 });
    });
  });

  describe('early and late', () => {
    it('splits a team’s own matches into equal halves', () => {
      // black plays every match here and wins them all
      const arcs = playerArcs([night('AWWWWW')], 'b1');
      expect(arcs.early.played).toBe(3);
      expect(arcs.late.played).toBe(3);
      expect(arcs.early.won).toBe(3);
      expect(arcs.late.won).toBe(3);
    });

    it('drops the middle match on an odd count, so the halves are comparable', () => {
      const arcs = playerArcs([night('AWWWW')], 'b1');
      expect(arcs.early.played).toBe(2);
      expect(arcs.late.played).toBe(2);
      expect(arcs.matches).toBe(5);
    });
  });

  describe('across the night', () => {
    it('files a match by when it was played, not by how many they had had', () => {
      // eight matches: black is in the first two and the last two
      const arcs = playerArcs([night('ANWNWNWN')], 'b1');
      const played = arcs.parts.map((p) => p.played);
      expect(played.reduce((a, b) => a + b, 0)).toBe(arcs.matches);
      expect(played[0]).toBeGreaterThan(0);
    });

    it('is beginning, middle and end — three parts, not four', () => {
      const arcs = playerArcs([night('AWWWWWWWW')], 'b1');
      expect(arcs.parts).toHaveLength(3);
      expect(arcs.parts[2].played).toBeGreaterThan(0);
    });

    it('never files a match past the last part', () => {
      // nine matches split three ways is the boundary case: the ninth match
      // (index 8, total 9) is `Math.floor((8/9)*3) === 2`, the last part
      // rather than a fourth one that does not exist.
      const arcs = playerArcs([night('AWWWWWWWA')], 'b1');
      const total = arcs.parts.reduce((n, p) => n + p.played, 0);
      expect(total).toBe(arcs.matches);
    });
  });
});

describe('clubBounce', () => {
  it('counts a team-match once, not once per player in the team', () => {
    // the five in a team share one result; counting each of them would say the
    // same thing five times and make the baseline look better sampled than it is
    const fx = night('ANNW');
    const club = clubBounce([fx]);
    const perTeam = ['b1', 'w1', 'u1']
      .map((id) => playerArcs([fx], id).bounce.played)
      .reduce((a, b) => a + b, 0);
    expect(club.played).toBe(perTeam);
    // black lost m2 and came back to lose m4; white lost m1 and came back to
    // win m3. Two returns from the bench in the night, and the club won one.
    expect(club).toEqual({ played: 2, won: 1 });
  });

  it('is empty when nothing was logged', () => {
    expect(clubBounce([tallied()])).toEqual({ played: 0, won: 0 });
  });
});

describe('what the numbers are allowed to say', () => {
  it('holds the early/late comparison until both halves have enough in them', () => {
    const thin = playerArcs([night('AWWWW')], 'b1');
    expect(thin.early.played).toBeLessThan(MIN_HALF);
    expect(lean(thin)).toBeNull();
  });

  it('calls a small gap level rather than naming a direction', () => {
    const arcs = playerArcs([], 'b1');
    arcs.early = { played: MIN_HALF, won: 5 };
    arcs.late = { played: MIN_HALF, won: 5 };
    expect(lean(arcs)).toBe('level');
  });

  it('names the direction only when the gap is worth remarking on', () => {
    const arcs = playerArcs([], 'b1');
    arcs.early = { played: 20, won: 4 };
    arcs.late = { played: 20, won: 15 };
    expect(lean(arcs)).toBe('late');
  });

  it('holds the bounce-back number until there is enough of it', () => {
    const arcs = playerArcs([], 'b1');
    arcs.bounce = { played: MIN_BOUNCE - 1, won: 9 };
    expect(bounceVsClub(arcs, { played: 100, won: 50 })).toBeNull();
  });

  it('compares with the club rather than with a coin', () => {
    // the rotation lifts everybody's number: after a loss you sit one out and
    // come back against a team that has just played two. A player level with
    // the club is ordinary, however good the raw rate looks.
    const arcs = playerArcs([], 'b1');
    arcs.bounce = { played: 20, won: 12 }; // 60%, which sounds like something
    expect(bounceVsClub(arcs, { played: 200, won: 120 })).toBeCloseTo(0);
    expect(rate(arcs.bounce)).toBe(0.6);
  });
});
