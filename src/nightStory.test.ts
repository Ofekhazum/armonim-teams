import { describe, expect, it } from 'vitest';
import type { FixtureRecord, MatchLogEntry, TeamColor } from './types';
import { nextPairing, recordMatch, winsFromLog } from './matchLog';
import {
  DOMINANT_RUN,
  MANY_SHOOTOUTS,
  SWEEP_MIN,
  YO_YO,
  nightStory,
  playerNight,
} from './nightStory';

// Every log here is built through `recordMatch`, so the rotation is legal —
// winner stays on, the resting team comes in. A hand-written array could
// describe a night that could not have happened, and then the detectors would
// be tested against football that does not exist.

// A night as a script, because who *can* win match 7 is decided by matches 1-6:
// the winner stays on and the resting team comes in, so at any moment only two
// teams are even on the pitch. Naming colours would mostly produce nights that
// could not have happened.
//
//   A / B — the opening match (black v white), won by black / by white
//   W     — the team already out there wins again and stays on
//   N     — the team that has just come on wins it
//
// Lowercase means it went to penalties. So 'AWWWN' is: black takes the opener,
// wins three more without leaving the pitch, and loses the fifth.
const logOf = (script: string): MatchLogEntry[] => {
  let log: MatchLogEntry[] = [];
  for (const ch of script) {
    const viaPenalties = ch === ch.toLowerCase();
    const step = ch.toUpperCase();
    let winner: TeamColor;
    if (log.length === 0) {
      winner = step === 'A' ? 'black' : 'white';
    } else {
      // [the team staying on, the team coming in]
      const [staying, coming] = nextPairing(log)!;
      winner = step === 'W' ? staying : coming;
    }
    log = recordMatch(log, winner, viaPenalties, ['black', 'white']);
  }
  return log;
};

const night = (script: string, over: Partial<FixtureRecord> = {}): FixtureRecord => {
  const matchLog = logOf(script);
  return {
    id: 'f1',
    date: '2026-08-04',
    teams: { black: ['b1', 'b2'], white: ['w1', 'w2'], blue: ['u1', 'u2'] },
    players: [...['b1', 'b2', 'w1', 'w2', 'u1', 'u2']].map((id) => ({ id, name: id, rating: 3 })),
    wins: winsFromLog(matchLog),
    matchLog,
    ...over,
  };
};

const kinds = (fx: FixtureRecord) => nightStory(fx)!.facts.map((f) => f.kind);

describe('nightStory', () => {
  it('says nothing at all about a night that was only tallied', () => {
    // three totals from memory have no order in them, and inventing one would
    // be making it up
    expect(nightStory(night('', { matchLog: [] }))).toBeNull();
  });

  it('counts what each team played and won, which a tally cannot', () => {
    // black beats white, black beats blue, then white comes back in and wins
    const s = nightStory(night('AWN'))!;
    expect(s.matches).toBe(3);
    expect(s.teams.black).toMatchObject({ played: 3, won: 2 });
    // white sat out match 2 and came back in for match 3
    expect(s.teams.white).toMatchObject({ played: 2, won: 1 });
    expect(s.teams.blue).toMatchObject({ played: 1, won: 0 });
  });

  it('counts a shootout win as half, the way the tally does', () => {
    const s = nightStory(night('a'))!;
    expect(s.teams.black.won).toBe(1);
    expect(s.teams.black.points).toBe(0.5);
    expect(s.penalties).toBe(1);
  });

  it('finds the longest run and who it belonged to', () => {
    const s = nightStory(night('AWWNW'))!;
    expect(s.longest).toEqual({ team: 'black', length: 3 });
  });

  it('reads alternation off the sequence', () => {
    // nobody ever wins twice: every match changed hands
    const all = nightStory(night('ANNNN'))!;
    expect(all.alternation).toBe(1);
    // one team all evening: never
    const none = nightStory(night('AWWW'))!;
    expect(none.alternation).toBe(0);
  });

  it('does not count a tie at the top as the lead changing hands', () => {
    // black wins, then blue takes the next: level on one apiece, and nobody
    // has taken the lead from anybody
    const s = nightStory(night('AN'))!;
    expect(s.leadChanges).toBe(0);
  });

  it('counts the lead actually changing hands', () => {
    // black leads after 1; blue takes it with two of their own
    const s = nightStory(night('ANW'))!;
    expect(s.leadChanges).toBe(1);
  });
});

describe('the flavour of a night', () => {
  it('calls a long reign a dictatorship', () => {
    const s = nightStory(night('AWWWW'))!;
    expect(s.flavour).toBe('dictatorship');
  });

  it('calls constant alternation chaos', () => {
    const s = nightStory(night('ANNNNN'))!;
    expect(s.flavour).toBe('chaos');
  });

  it('gives two different nights different headlines from the same bank', () => {
    // the bank is picked by flavour, the line within it by the fixture's id —
    // so a page does not read identically week after week
    const a = nightStory(night('AWWWW', { id: 'aaa' }))!;
    const b = nightStory(night('AWWWW', { id: 'zzz' }))!;
    expect(a.flavour).toBe(b.flavour);
    expect(a.headline).not.toBe(b.headline);
  });

  it('gives the same night the same headline every time it is read', () => {
    const once = nightStory(night('ANNN'))!;
    const twice = nightStory(night('ANNN'))!;
    expect(once.headline).toBe(twice.headline);
  });
});

describe('the detectors', () => {
  it('reports a dominant run only once somebody ends it', () => {
    const reign = 'A' + 'W'.repeat(DOMINANT_RUN - 1);
    // still going when the night finished — nobody broke anything
    expect(kinds(night(reign))).not.toContain('streak-broken');

    const s = nightStory(night(`${reign}N`))!;
    expect(s.facts).toContainEqual({
      kind: 'streak-broken',
      // black played white, blue, white, blue: the fifth is white's turn again
      by: 'white',
      over: 'black',
      length: DOMINANT_RUN,
      at: DOMINANT_RUN + 1,
    });
  });

  it('ignores a short run being ended, which is just football', () => {
    expect(kinds(night('AWN'))).not.toContain('streak-broken');
  });

  it('finds a team that went on at the first whistle and stayed on', () => {
    const s = nightStory(night('AWWN'))!;
    expect(s.facts).toContainEqual({ kind: 'break-and-run', team: 'black', through: 3 });
  });

  it('does not call it a break and run if they were not in the opening match', () => {
    // blue comes in at match 2 and wins three
    const s = nightStory(night('ANWW'))!;
    expect(s.facts.some((f) => f.kind === 'break-and-run' && f.team === 'blue')).toBe(false);
  });

  it('finds a team that won everything it played', () => {
    const sweep = 'A' + 'W'.repeat(SWEEP_MIN - 1);
    expect(nightStory(night(sweep))!.facts).toContainEqual({
      kind: 'perfect',
      team: 'black',
      played: SWEEP_MIN,
    });
  });

  it('finds a team that lost everything it played', () => {
    // white is beaten in the opener and beaten every time they come back on
    const s = nightStory(night('ANWNWNW'))!;
    expect(s.facts.some((f) => f.kind === 'blanked' && f.team === 'white')).toBe(true);
  });

  it('finds a team alternating win, loss, win, loss', () => {
    // every match is won by whoever has just come on, which makes black's own
    // results read win, loss, win, loss
    const s = nightStory(night('ANNNN'))!;
    const yo = s.facts.find((f) => f.kind === 'yo-yo');
    expect(yo).toBeDefined();
    if (yo?.kind === 'yo-yo') expect(yo.run).toBeGreaterThanOrEqual(YO_YO);
  });

  it('calls three shootouts a night about nerve', () => {
    expect(kinds(night('a' + 'n'.repeat(MANY_SHOOTOUTS - 1)))).toContain('shootouts');
  });

  it('stays quiet about shootouts below the line', () => {
    expect(kinds(night('an'))).not.toContain('shootouts');
  });

  it('puts the rarer facts first, so a trimmed list keeps the good one', () => {
    const s = nightStory(night('AWWWN'))!;
    const rank = s.facts.map((f) => f.kind);
    expect(rank.indexOf('streak-broken')).toBeLessThan(rank.indexOf('break-and-run'));
  });
});

describe('playerNight', () => {
  it('gives a player their own team’s matches', () => {
    const fx = night('AWN');
    expect(playerNight(fx, 'b1')).toEqual({ team: 'black', played: 3, won: 2 });
    expect(playerNight(fx, 'u1')).toEqual({ team: 'blue', played: 1, won: 0 });
  });

  it('is null for somebody who was not there', () => {
    expect(playerNight(night('A'), 'nobody')).toBeNull();
  });
});
