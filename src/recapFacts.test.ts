import { describe, expect, it } from 'vitest';
import type { FixtureRecord, MatchLogEntry, Player, TeamColor } from './types';
import { nextPairing, recordMatch, winsFromLog } from './matchLog';
import { recapFacts } from './recapFacts';

// What leaves the app. Two things are being tested: that every number handed to
// the reporter is one the app already stands behind, and that nothing private
// travels with them.

const logOf = (script: string): MatchLogEntry[] => {
  let log: MatchLogEntry[] = [];
  for (const ch of script) {
    const viaPenalties = ch === ch.toLowerCase();
    const step = ch.toUpperCase();
    let winner: TeamColor;
    if (log.length === 0) {
      winner = step === 'A' ? 'black' : 'white';
    } else {
      const [staying, coming] = nextPairing(log)!;
      winner = step === 'W' ? staying : coming;
    }
    log = recordMatch(log, winner, viaPenalties, ['black', 'white']);
  }
  return log;
};

const player = (id: string, name: string): Player => ({
  id,
  name,
  rating: 4.5,
  attack: 80,
  chemistry: ['someone'],
  avoid: ['someone-else'],
});

const roster = [player('b1', 'אופק'), player('w1', 'ירין'), player('u1', 'ניב')];

const night = (script: string, over: Partial<FixtureRecord> = {}): FixtureRecord => {
  const matchLog = logOf(script);
  return {
    id: 'f1',
    date: '2026-08-11',
    teams: { black: ['b1'], white: ['w1'], blue: ['u1'] },
    players: [
      { id: 'b1', name: 'אופק', rating: 4.5 },
      { id: 'w1', name: 'ירין', rating: 2 },
      { id: 'u1', name: 'ניב', rating: 5 },
    ],
    wins: winsFromLog(matchLog),
    matchLog,
    ...over,
  };
};

describe('recapFacts', () => {
  it('says nothing about a night that was only tallied', () => {
    // no sequence to describe, and a model asked to describe one anyway would
    // simply make it up
    expect(recapFacts(night('', { matchLog: [] }), [], roster)).toBeNull();
  });

  it('hands over the counts the night page already shows', () => {
    const fx = night('AWWNW');
    const f = recapFacts(fx, [fx], roster)!;
    expect(f.date).toBe('2026-08-11');
    expect(f.matches).toBe(5);
    expect(f.teams.map((t) => t.team)).toEqual(['Black', 'White', 'Blue']);
    expect(f.teams[0].points).toBe(fx.wins.black);
    expect(f.teams[0].longestRun).toBe(3);
  });

  it('carries no ratings, no chemistry and no ids', () => {
    // the private half of a player never leaves the app (§2.9), and an id is
    // no use to a reporter that writes in names
    const fx = night('AWN');
    const json = JSON.stringify(recapFacts(fx, [fx], roster));
    expect(json).not.toContain('rating');
    expect(json).not.toContain('4.5');
    expect(json).not.toContain('chemistry');
    expect(json).not.toContain('avoid');
    expect(json).not.toContain('"b1"');
  });

  it('keeps the names exactly as they are written', () => {
    const fx = night('AWN');
    const f = recapFacts(fx, [fx], roster)!;
    expect(f.players.map((p) => p.name).sort()).toEqual(['אופק', 'ירין', 'ניב']);
  });

  it('gives each player their own team’s matches', () => {
    const fx = night('AWN');
    const f = recapFacts(fx, [fx], roster)!;
    expect(f.players.find((p) => p.name === 'אופק')).toEqual({
      name: 'אופק',
      team: 'Black',
      played: 3,
      won: 2,
    });
  });

  it('names the winner, and names both on a tie', () => {
    const fx = night('AWWNW');
    expect(recapFacts(fx, [fx], roster)!.winners).toEqual(['Black']);

    const level = night('AN');
    expect(recapFacts(level, [level], roster)!.winners.sort()).toEqual(['Black', 'Blue']);
  });

  it('passes the MVP by name, or says there is not one', () => {
    const fx = night('AWN', { mvpId: 'u1' });
    expect(recapFacts(fx, [fx], roster)!.mvp).toBe('ניב');
    expect(recapFacts(night('AWN'), [], roster)!.mvp).toBeNull();
  });

  it('turns the detected moments into short factual clauses', () => {
    const fx = night('AWWWN');
    const f = recapFacts(fx, [fx], roster)!;
    expect(f.moments.some((m) => /ended .*run of 4/.test(m))).toBe(true);
  });

  it('counts milestones as of that night, not as of today', () => {
    // A page about April must not report what became true in May. Six regular
    // nights, and a new face turns up for the last of them — the recap for an
    // earlier night has never heard of them, and the last one announces them.
    const season = Array.from({ length: 6 }, (_, i) => ({
      ...night('AWN'),
      id: `n${i}`,
      date: `2026-04-0${i + 1}`,
    }));
    const withNewcomer: FixtureRecord = {
      ...night('AWN'),
      id: 'n6',
      date: '2026-04-07',
      teams: { black: ['b1'], white: ['w1'], blue: ['new-1'] },
      players: [
        { id: 'b1', name: 'אופק', rating: 4.5 },
        { id: 'w1', name: 'ירין', rating: 2 },
        { id: 'new-1', name: 'עילאי', rating: 3 },
      ],
    };
    const history = [...season, withNewcomer];
    const withRoster = [...roster, player('new-1', 'עילאי')];

    expect(recapFacts(withNewcomer, history, withRoster)!.milestones.join(' ')).toContain(
      'עילאי played their first night',
    );
    // the same history, read from an earlier night: they are not there yet
    expect(recapFacts(season[3], history, withRoster)!.milestones.join(' ')).not.toContain('עילאי');
  });

  it('marks a stranger as a guest, so they are not made a debutant every week', () => {
    // guests carry a fresh id every visit; without the roster check they debut
    // on every night page in the archive
    const fx = night('AWN', {
      teams: { black: ['b1'], white: ['w1'], blue: ['guest-9'] },
      players: [
        { id: 'b1', name: 'אופק', rating: 4.5 },
        { id: 'w1', name: 'ירין', rating: 2 },
        { id: 'guest-9', name: 'זרקא', rating: 3 },
      ],
    });
    const f = recapFacts(fx, [fx], roster)!;
    expect(f.milestones.join(' ')).not.toContain('זרקא');
    // but they are still on the team sheet and still played
    expect(f.players.some((p) => p.name === 'זרקא')).toBe(true);
  });

  it('tells the reporter who beat the opponent who usually beats them', () => {
    // The line the whole notes idea exists for. Nothing else in the app would
    // ever say it: every other view is about one player or one night, and this
    // is the two together.
    const past: FixtureRecord[] = Array.from({ length: 8 }, (_, i) => ({
      ...night('AWN'),
      id: `p${i}`,
      date: `2026-07-0${i + 1}`,
      // ירין's team beats אופק's, over and over
      teams: { black: ['b1'], white: ['w1'], blue: ['u1'] },
    }));
    const tonight: FixtureRecord = {
      ...night('BWW'), // white takes the opener and keeps the pitch
      id: 'tonight',
      date: '2026-07-20',
    };
    const f = recapFacts(tonight, [...past, tonight], roster)!;
    // whether a bogey exists depends on the fixtures above; what must always
    // hold is that a note quotes the record from *before* tonight
    // said as a story rather than as a record: at most the one thing that
    // happened, never four career numbers stacked up around the joke
    for (const n of f.notes) {
      if (n.includes('comes off worse')) expect(n).toMatch(/beat theirs$/);
    }
    // and the night's best is always there once anybody won anything
    expect(f.notes.some((n) => n.startsWith('Most matches won tonight'))).toBe(true);
  });

  it('never hands the reporter a calendar date to copy', () => {
    // The "back after missing N nights" fact used to end with the ISO date of
    // the player's last appearance, and the reporter printed it verbatim into
    // a Hebrew sentence — which is exactly what the prompt's "every number
    // comes from the record unchanged" rule tells it to do. The count is the
    // fact worth having; the date was precision nobody wanted.
    // ניב plays, misses the next four, and is back tonight — the fact this
    // bug lived in needs a real absence to fire at all (AWAY_NIGHTS = 3).
    const away = ['2026-07-09', '2026-07-16', '2026-07-23', '2026-07-30'].map((date, i) => ({
      ...night('AWAWA', { id: `gone${i}`, date }),
      teams: { black: ['b1'], white: ['w1'], blue: [] },
      players: [
        { id: 'b1', name: 'אופק', rating: 4.5 },
        { id: 'w1', name: 'ירין', rating: 2 },
      ],
    }));
    const first = night('AWAWA', { id: 'f0', date: '2026-07-02' });
    const tonight = night('AWAWA', { id: 'f1', date: '2026-08-11' });
    const history = [first, ...away, tonight];
    const f = recapFacts(tonight, history, roster)!;
    // the absence really was detected, or this test proves nothing
    expect(f.notes.some((n) => n.includes('back after missing'))).toBe(true);
    for (const line of [...f.notes, ...f.milestones, ...f.moments, ...f.duos]) {
      expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it('quotes a career record from before the night, never including it', () => {
    const fx = night('AWN');
    const f = recapFacts(fx, [fx], roster)!;
    // one night of history and nothing before it: nobody has a career record
    // to have overturned, so there is nothing of the kind to say
    expect(f.notes.some((n) => n.includes('comes off worse'))).toBe(false);
  });

  it('names a long evening with nothing to show for it', () => {
    // teasing about results is the point; the prompt is what keeps it to
    // results rather than to anybody's ability
    // black hold the pitch all night; white come back on for matches 1, 3, 5
    // and 7 and are beaten every time
    const fx = night('AWWWWWW');
    const f = recapFacts(fx, [fx], roster)!;
    expect(f.notes.some((n) => n.startsWith('Played at least 4 and won none'))).toBe(true);
  });

  it('says who spent the night watching', () => {
    // black hold the pitch and blue barely get on
    const fx = night('AWWWWWW');
    const f = recapFacts(fx, [fx], roster)!;
    expect(f.notes.some((n) => n.includes('watched more football than they played'))).toBe(true);
  });

  // The reported complaint. On a night that swings every match the teams come
  // out at 7/7/6 — the rota, not a story — and the old share-only test called
  // the 6 a bench night. The report then told a team that had just taken two
  // and a half points from those six that they had watched more football than
  // they played.
  it('does not call a one-match difference a night on the bench', () => {
    const fx = night('ANNNNNNNNN'); // 10 matches, played 7 / 7 / 6
    const f = recapFacts(fx, [fx], roster)!;
    expect(f.notes.some((n) => n.includes('watched more football than they played'))).toBe(false);
  });

  // Removed rather than reworded. A career-long early/late lean is not
  // something that happened tonight, and a reporter told to build a story out
  // of every fact turned it into "they collapsed into the night" — an event
  // that did not occur. It lives on the player's own page instead.
  it('never hands over a career habit as if it were tonight’s news', () => {
    const season = Array.from({ length: 12 }, (_, i) => ({
      ...night('AWWWWWW'),
      id: `s${i}`,
      date: `2026-0${i < 9 ? 6 : 7}-${String((i % 9) + 1).padStart(2, '0')}`,
    }));
    const f = recapFacts(season[11], season, roster)!;
    for (const note of f.notes) {
      expect(note).not.toMatch(/slow starter|fades/);
    }
  });

  it('caps how much of any one kind travels', () => {
    // fifteen players all wearing three shirts would otherwise crowd out the
    // once-a-season story before it is even looked at
    const season = Array.from({ length: 12 }, (_, i) => ({
      ...night('AWN'),
      id: `s${i}`,
      date: `2026-0${i < 9 ? 6 : 7}-${String((i % 9) + 1).padStart(2, '0')}`,
    }));
    const f = recapFacts(season[11], season, roster)!;
    expect(f.notes.length).toBeLessThanOrEqual(10);
    const shirtLines = f.notes.filter((n) => n.includes('of their'));
    expect(shirtLines.length).toBeLessThanOrEqual(2);
  });

  it('welcomes a guest who took the night off the regulars', () => {
    const past = Array.from({ length: 3 }, (_, i) => ({
      ...night('AWN'),
      id: `q${i}`,
      date: `2026-05-0${i + 1}`,
    }));
    const withGuest: FixtureRecord = {
      ...night('AWWWWWW'), // black take the night
      id: 'guest-night',
      date: '2026-05-09',
      teams: { black: ['zarka'], white: ['w1'], blue: ['u1'] },
      players: [
        { id: 'zarka', name: 'זרקא', rating: 3 },
        { id: 'w1', name: 'ירין', rating: 2 },
        { id: 'u1', name: 'ניב', rating: 5 },
      ],
    };
    const f = recapFacts(withGuest, [...past, withGuest], roster)!;
    expect(f.notes.some((n) => n.includes('זרקא') && n.includes('guest'))).toBe(true);
  });

  // The derby is on a banner the whole club reads before kick-off, so it is
  // the one fact the audience is already waiting on — and it was missing from
  // the payload entirely, which is why the report never mentioned it.
  describe('the derby', () => {
    // Alternating who holds the pitch, because a derby has a ceiling as well
    // as a floor: twelve identical nights leave אופק 44-0 up on ירין, which is
    // a bogey man and gets no banner by design (§2.33). Swapping the dominant
    // shirt each week lands them at 24-20 over 44 — a real rivalry.
    const season = Array.from({ length: 12 }, (_, i) => ({
      ...night(i % 2 === 0 ? 'AWWWWWW' : 'WWWWWWW'),
      id: `s${i}`,
      date: `2026-0${i < 9 ? 6 : 7}-${String((i % 9) + 1).padStart(2, '0')}`,
    }));

    it('travels with how it actually went', () => {
      const f = recapFacts(season[11], season, roster)!;
      expect(f.derby).toBeDefined();
      // both names, the record they were picked on, and tonight's answer
      expect(f.derby).toContain('אופק');
      expect(f.derby).toContain('ירין');
      expect(f.derby).toMatch(/derby/);
    });

    // A report went out announcing that both of them won the derby. The line
    // ended "and it finished 3-2" — no verdict, and the 3 had to be attributed
    // positionally from two names a clause earlier, next to a second,
    // similar-looking pair for the head-to-head going in. So the line now says
    // it, rather than leaving the one result the club waited all week for to be
    // reconstructed at the far end.
    it('says who won in words, not as a score to be decoded', () => {
      const f = recapFacts(season[11], season, roster)!;
      expect(f.derby).toMatch(/won tonight's derby|finished level/);
      // every count is written next to the name that owns it
      expect(f.derby).toMatch(/אופק took \d+ and ירין took \d+/);
      // and the bare trailing scoreline is gone
      expect(f.derby).not.toMatch(/it finished \d+-\d+/);
    });

    it('calls a split derby level instead of handing it to somebody', () => {
      // Two meetings, one each — the outcome with no winner, which is exactly
      // the one a model reaches for a name to fill.
      const split = {
        ...night('AWWWWWW', {
          matchLog: [
            { a: 'black', b: 'white', winner: 'black', viaPenalties: false },
            { a: 'black', b: 'white', winner: 'white', viaPenalties: false },
          ],
        }),
        id: 'split',
        date: '2026-08-01',
      };
      const f = recapFacts(split, [...season, split], roster)!;
      expect(f.derby).toContain('finished level');
      // no name is attached to a win on a night that had none
      expect(f.derby).not.toMatch(/(אופק|ירין) won tonight's derby/);
    });

    it('is absent when no pair has enough history to be picked', () => {
      const fx = night('AWWWWWW');
      expect(recapFacts(fx, [fx], roster)!.derby).toBeUndefined();
    });

    it('is absent on a night that was only tallied', () => {
      // no matchLog at all — recapFacts returns null, so there is nothing to
      // settle a derby against in the first place
      const tallied = night('AWWWWWW', { matchLog: undefined });
      expect(recapFacts(tallied, [...season, tallied], roster)).toBeNull();
    });
  });

  it('passes the organiser’s note through, and omits it when there is none', () => {
    // The only line in the payload the app did not work out for itself (§2.27),
    // and the only route by which something off the scoreboard reaches the
    // report. Absent and empty are the same thing, so an empty one does not
    // travel as a field the prompt then has to ignore.
    const fx = night('AWN', { note: '  טום העיף את הכדור מעבר לגדר 5 פעמים  ' });
    expect(recapFacts(fx, [fx], roster)!.said).toBe('טום העיף את הכדור מעבר לגדר 5 פעמים');

    expect(recapFacts(night('AWN'), [night('AWN')], roster)!.said).toBeUndefined();
    expect(recapFacts(night('AWN', { note: '   ' }), [night('AWN')], roster)!.said).toBeUndefined();
  });

  it('stays small enough to be a prompt rather than a database dump', () => {
    const fx = night('AWWNWNWWN');
    const size = JSON.stringify(recapFacts(fx, [fx], roster)).length;
    expect(size).toBeLessThan(4000);
  });
});
