import { describe, expect, it } from 'vitest';
import { TEAM_COLORS } from './balancer';
import { restingTeam, winsFromLog } from './matchLog';
import { playerStandings } from './calibration';
import { playerAchievements } from './achievements';
import { computeDuoRecords } from './duos';
import { playerTimeline } from './playerTimeline';
import { buildTestClub, testHistory, testPlayers } from './testData';

// The invented club (§2.32).
//
// Two things are being checked, and the second matters more. The first is that
// the data is *valid* — a night the app could actually have produced, since a
// sandbox full of records the real code paths reject tests nothing but the
// error handling.
//
// The second is that it is *interesting*. Almost everything this exists to
// exercise is gated on a pattern rather than a count: a run of three, a duo
// past its shrinkage, a plus-minus with signal in it. A season of coin flips
// satisfies every structural assertion below and still leaves every page as
// blank as it was with real data — at which point the sandbox has cost a day
// and tested nothing.

const club = buildTestClub();

describe('the invented roster', () => {
  it('is twenty players, each marked as invented', () => {
    expect(club.players).toHaveLength(20);
    expect(new Set(club.players.map((p) => p.id)).size).toBe(20);
    expect(club.players.every((p) => p.id.startsWith('test-'))).toBe(true);
  });

  it('spreads the ratings, so teams are not all the same team', () => {
    const ratings = club.players.map((p) => p.rating);
    expect(Math.min(...ratings)).toBeLessThan(2);
    expect(Math.max(...ratings)).toBeGreaterThan(4.5);
  });
});

describe('the invented season', () => {
  it('is a full season, oldest first', () => {
    expect(club.history).toHaveLength(40);
    const dates = club.history.map((fx) => fx.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('puts fifteen players out in three fives, nobody twice', () => {
    for (const fx of club.history) {
      const all = TEAM_COLORS.flatMap((c) => fx.teams[c]);
      expect(all).toHaveLength(15);
      expect(new Set(all).size).toBe(15);
      for (const c of TEAM_COLORS) expect(fx.teams[c]).toHaveLength(5);
      // and the sheet matches the shirts — a fixture whose `players` and
      // `teams` disagree breaks every count that joins them
      expect(new Set(fx.players.map((p) => p.id))).toEqual(new Set(all));
    }
  });

  it('never contradicts itself about the score', () => {
    // The one thing `matchLog.ts` opens by warning about: two records that can
    // disagree is how a night ends up with a tally that does not match the
    // matches.
    for (const fx of club.history) {
      if (!fx.matchLog) continue;
      expect(fx.wins).toEqual(winsFromLog(fx.matchLog));
    }
  });

  it('logs nights the way the fixture page would have', () => {
    // Winner stays on, the resting team comes in. A log that breaks the
    // rotation is one the app could not have produced, so anything reading it
    // is being tested against a situation that cannot occur.
    for (const fx of club.history) {
      if (!fx.matchLog) continue;
      for (let i = 1; i < fx.matchLog.length; i++) {
        const prev = fx.matchLog[i - 1];
        const next = fx.matchLog[i];
        expect(new Set([next.a, next.b])).toEqual(
          new Set([prev.winner, restingTeam(prev.a, prev.b)]),
        );
      }
    }
  });

  it('contains both kinds of night', () => {
    // Tallied-only nights are not legacy trivia — every night before the match
    // log existed is one, and the app has to keep reading them.
    const logged = club.history.filter((fx) => fx.matchLog).length;
    expect(logged).toBeGreaterThan(5);
    expect(logged).toBeLessThan(club.history.length);
  });

  it('picks an MVP most weeks, and always someone who played', () => {
    const picked = club.history.filter((fx) => fx.mvpId);
    expect(picked.length).toBeGreaterThan(club.history.length * 0.6);
    for (const fx of picked) {
      expect(fx.players.some((p) => p.id === fx.mvpId)).toBe(true);
    }
  });

  it('leaves a note on a few nights, for the reporter to find', () => {
    expect(club.history.filter((fx) => fx.note).length).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('is the same club every time it is built', () => {
    // A sandbox that reshuffled on reload would make "did that change?"
    // unanswerable, which is the one question a fixture exists to answer.
    expect(testHistory(testPlayers())).toEqual(club.history);
  });
});

describe('the season is worth reviewing', () => {
  it('varies attendance, so the presence thresholds do something', () => {
    const standings = playerStandings(club.history);
    const nights = standings.map((s) => s.nights);
    expect(Math.max(...nights)).toBeGreaterThan(30);
    expect(Math.min(...nights)).toBeLessThan(25);
  });

  it('has real signal in it, not twenty coin flips', () => {
    // The better players have to actually win more, or the ridge solver, the
    // impact term in a price and the whole calibration panel are being shown a
    // season of noise and will correctly say nothing about it.
    const standings = playerStandings(club.history);
    const rating = new Map(club.players.map((p) => [p.id, p.rating]));
    const rate = (min: number, max: number) => {
      const group = standings.filter((s) => {
        const r = rating.get(s.id)!;
        return r >= min && r <= max;
      });
      return group.reduce((sum, s) => sum + s.perNight, 0) / group.length;
    };
    expect(rate(4, 5)).toBeGreaterThan(rate(1, 2.5));
  });

  it('produces badges, so the roster is not a wall of blanks', () => {
    const records = playerAchievements(club.history);
    const withBadges = [...records.values()].filter((r) => r.achievements.length > 0);
    expect(withBadges.length).toBeGreaterThan(0);
  });

  it('produces duos that clear their own shrinkage', () => {
    // The assertion that set NIGHTS. Teams are redrawn weekly, so a pair only
    // line up together about a third of the nights they both attend, and
    // `duos.ts` shrinks a short record back to the base rate on purpose. At
    // twenty nights this was 0 of 20 players; see the note on NIGHTS.
    const ids = new Set(club.players.map((p) => p.id));
    const names = new Map(club.players.map((p) => [p.id, p.name]));
    const found = club.players.filter((p) => {
      const { best, worst } = computeDuoRecords(club.history, ids, names, p.id);
      return best !== null || worst !== null;
    });
    expect(found.length).toBeGreaterThan(0);
  });

  it('takes somebody past the long-service badge', () => {
    // VETERAN_NIGHTS is 25, so no club with twenty nights on record can ever
    // show it — and it would have gone unreviewed for another six months.
    const records = playerAchievements(club.history);
    const kinds = new Set([...records.values()].flatMap((r) => r.achievements.map((a) => a.kind)));
    expect(kinds.has('veteran')).toBe(true);
  });

  it('gives a regular a career worth reading', () => {
    // The timeline is the thing hardest to review on a short history: no
    // milestones reached, no run long enough to break, no record to beat.
    const busiest = playerStandings(club.history)[0];
    const events = playerTimeline(club.history, busiest.id);
    expect(events.length).toBeGreaterThan(3);
    expect(new Set(events.map((e) => e.kind)).size).toBeGreaterThan(2);
  });
});
