// Tests for the night post-mortem (src/postMortem.ts).
//
// The load-bearing claim in that file is a measured one: winner-stays-on
// produces a lopsided tally from teams that are exactly equal. Everything the
// tool says rests on the reference distribution being right, so that is what
// most of these check — against the numbers quoted in the file's own header,
// which came from a separate 4000-night run.

import { describe, expect, it } from 'vitest';
import {
  diagnoseNight,
  diagnoseSeason,
  nightShape,
  paperAverage,
  playedFromLog,
  spreadReference,
  winSpread,
} from './postMortem';
import type { FixtureRecord, MatchLogEntry, Player, TeamColor } from './types';

const mkPlayers = (specs: { id: string; rating: number; isGk?: boolean }[]): Player[] =>
  specs.map((s) => ({
    id: s.id,
    name: s.id.toUpperCase(),
    rating: s.rating,
    attack: 50,
    chemistry: [],
    ...(s.isGk ? { isGk: true } : {}),
  }));

// Fifteen players, five a side, all rated the same unless said otherwise.
const roster = (rating = 3) =>
  mkPlayers(Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, rating })));

const teamsOf = (): Record<TeamColor, string[]> => ({
  black: ['p0', 'p1', 'p2', 'p3', 'p4'],
  white: ['p5', 'p6', 'p7', 'p8', 'p9'],
  blue: ['p10', 'p11', 'p12', 'p13', 'p14'],
});

const fixture = (over: Partial<FixtureRecord> = {}): FixtureRecord => ({
  id: 'fx1',
  date: '2026-03-01',
  teams: teamsOf(),
  players: roster().map((p) => ({ id: p.id, name: p.name, rating: p.rating })),
  wins: { black: 5, white: 4, blue: 3 },
  ...over,
});

const LEVEL = { black: 3, white: 3, blue: 3 } as Record<TeamColor, number>;
const SHAPE = { matches: 12, shootoutRate: 0.2, estimated: false };

describe('the format itself', () => {
  it('produces a lopsided tally from teams that are exactly equal', () => {
    // The whole premise. If this stops being true the tool has no reason to
    // exist — and the numbers it reports to the organiser are wrong.
    const ref = spreadReference(LEVEL, SHAPE, 12345);
    expect(ref.median).toBeGreaterThanOrEqual(3);
    expect(ref.median).toBeLessThanOrEqual(4);
    // roughly a quarter of level nights clear the 75th percentile, by
    // definition — and that percentile sits well above "a couple of wins"
    expect(ref.p75).toBeGreaterThanOrEqual(4);
    expect(ref.p90).toBeGreaterThanOrEqual(5);
  });

  it('rates a 7-win spread as unusual but not extraordinary', () => {
    const ref = spreadReference(LEVEL, SHAPE, 12345);
    const pct = ref.percentileOf(7);
    expect(pct).toBeGreaterThan(88);
    expect(pct).toBeLessThan(100);
  });

  it('rates an ordinary spread as ordinary', () => {
    const ref = spreadReference(LEVEL, SHAPE, 12345);
    expect(ref.percentileOf(3)).toBeLessThan(60);
  });

  it('says a genuinely uneven sheet should produce a wider spread', () => {
    const level = spreadReference(LEVEL, SHAPE, 999);
    const uneven = spreadReference({ black: 4.2, white: 3, blue: 2.2 }, SHAPE, 999);
    expect(uneven.median).toBeGreaterThan(level.median + 2);
  });

  it('is deterministic, so a percentile does not move between renders', () => {
    const a = spreadReference(LEVEL, SHAPE, 42);
    const b = spreadReference(LEVEL, SHAPE, 42);
    expect(a.median).toBe(b.median);
    expect(a.percentileOf(5)).toBe(b.percentileOf(5));
  });
});

describe('reading a night', () => {
  it('takes the spread from top team to bottom', () => {
    expect(winSpread({ black: 8, white: 3, blue: 1 })).toBe(7);
    expect(winSpread({ black: 4, white: 4, blue: 4 })).toBe(0);
  });

  it('reads match count and shootouts exactly off a log', () => {
    const log: MatchLogEntry[] = [
      { a: 'black', b: 'white', winner: 'black', viaPenalties: false },
      { a: 'black', b: 'blue', winner: 'blue', viaPenalties: true },
      { a: 'blue', b: 'white', winner: 'white', viaPenalties: false },
    ];
    const shape = nightShape(fixture({ matchLog: log }));
    expect(shape.matches).toBe(3);
    expect(shape.shootoutRate).toBeCloseTo(1 / 3, 5);
    expect(shape.estimated).toBe(false);
  });

  it('estimates the match count on a tally-only night, and says it did', () => {
    const shape = nightShape(fixture({ wins: { black: 5, white: 4, blue: 3 } }));
    expect(shape.matches).toBe(12);
    expect(shape.estimated).toBe(true);
  });

  it('counts matches played, which the tally alone cannot say', () => {
    const log: MatchLogEntry[] = [
      { a: 'black', b: 'white', winner: 'black', viaPenalties: false },
      { a: 'black', b: 'blue', winner: 'black', viaPenalties: false },
      { a: 'black', b: 'white', winner: 'white', viaPenalties: false },
    ];
    const played = playedFromLog(log);
    // black stayed on for all three; the other two came and went
    expect(played.black).toBe(3);
    expect(played.white).toBe(2);
    expect(played.blue).toBe(1);
  });
});

describe('the sheet as it was scored', () => {
  it('averages the ratings the night was actually built from', () => {
    const fx = fixture({
      players: [
        { id: 'p0', name: 'P0', rating: 5 },
        { id: 'p1', name: 'P1', rating: 4 },
        { id: 'p2', name: 'P2', rating: 3 },
        { id: 'p3', name: 'P3', rating: 2 },
        { id: 'p4', name: 'P4', rating: 1 },
      ],
      teams: { black: ['p0', 'p1', 'p2', 'p3', 'p4'], white: [], blue: [] },
    });
    expect(paperAverage(fx, 'black', new Map())).toBe(3);
  });

  it('leaves a stand-in keeper out of the outfield average, as the balancer did', () => {
    // p0 is a 5★ outfield player who kept goal. teamStats excludes their
    // rating entirely, so the sheet the balancer scored averaged the other
    // four — and without gkIds this would read 3.0 instead of 2.5.
    const fx = fixture({
      players: [
        { id: 'p0', name: 'P0', rating: 5 },
        { id: 'p1', name: 'P1', rating: 4 },
        { id: 'p2', name: 'P2', rating: 3 },
        { id: 'p3', name: 'P3', rating: 2 },
        { id: 'p4', name: 'P4', rating: 1 },
      ],
      teams: { black: ['p0', 'p1', 'p2', 'p3', 'p4'], white: [], blue: [] },
      gkIds: ['p0'],
    });
    const byId = new Map(mkPlayers([{ id: 'p0', rating: 5 }]).map((p) => [p.id, p]));
    expect(paperAverage(fx, 'black', byId)).toBe(2.5);
  });

  it('counts a permanent keeper normally', () => {
    const fx = fixture({
      players: [
        { id: 'p0', name: 'P0', rating: 5 },
        { id: 'p1', name: 'P1', rating: 3 },
      ],
      teams: { black: ['p0', 'p1'], white: [], blue: [] },
      gkIds: ['p0'],
    });
    const byId = new Map(mkPlayers([{ id: 'p0', rating: 5, isGk: true }]).map((p) => [p.id, p]));
    expect(paperAverage(fx, 'black', byId)).toBe(4);
  });
});

describe('diagnosing a night', () => {
  const noErrors = () => undefined;

  it('blames the format for a spread the format routinely produces', () => {
    const fx = fixture({ wins: { black: 4, white: 3, blue: 3 } });
    const d = diagnoseNight(fx, new Map(roster().map((p) => [p.id, p])), noErrors);
    expect(d.cause).toBe('format');
    expect(d.percentile).toBeLessThan(75);
  });

  it('blames the sheet when the teams were uneven before kick-off', () => {
    // black is stacked: five 5★ against two teams of 1★
    const players = mkPlayers([
      ...['p0', 'p1', 'p2', 'p3', 'p4'].map((id) => ({ id, rating: 5 })),
      ...['p5', 'p6', 'p7', 'p8', 'p9'].map((id) => ({ id, rating: 1 })),
      ...['p10', 'p11', 'p12', 'p13', 'p14'].map((id) => ({ id, rating: 1 })),
    ]);
    const fx = fixture({
      players: players.map((p) => ({ id: p.id, name: p.name, rating: p.rating })),
      wins: { black: 9, white: 2, blue: 1 },
    });
    const d = diagnoseNight(fx, new Map(players.map((p) => [p.id, p])), noErrors);
    expect(d.paperGap).toBe(4);
    expect(d.cause).toBe('sheet');
    // and the model should have expected it: a stacked sheet predicts a much
    // wider spread than level teams do
    expect(d.paperSpread).toBeGreaterThan(d.equalSpread);
  });

  it('will not blame the ratings while the rating evidence is still wide', () => {
    // A big measured error, but with an error bar bigger than itself — which
    // is what five nights of football actually looks like (§2.50).
    const fx = fixture({ wins: { black: 9, white: 2, blue: 1 } });
    const d = diagnoseNight(fx, new Map(roster().map((p) => [p.id, p])), (id) =>
      ['p0', 'p1', 'p2', 'p3', 'p4'].includes(id) ? { delta: 1.5, se: 2.4 } : { delta: 0, se: 2.4 },
    );
    expect(d.ratingVerdict).toBe('blind');
    expect(d.cause).not.toBe('ratings');
  });

  it('blames the ratings when the sheet was level but the players were not', () => {
    const fx = fixture({ wins: { black: 9, white: 2, blue: 1 } });
    const d = diagnoseNight(fx, new Map(roster().map((p) => [p.id, p])), (id) =>
      ['p0', 'p1', 'p2', 'p3', 'p4'].includes(id) ? { delta: 1.5, se: 0.3 } : { delta: 0, se: 0.3 },
    );
    expect(d.paperGap).toBe(0); // level on paper
    expect(d.realGap).toBeCloseTo(1.5, 5); // not level in life
    expect(d.cause).toBe('ratings');
  });

  it('reports win rate alongside win count on a logged night', () => {
    const log: MatchLogEntry[] = [
      { a: 'black', b: 'white', winner: 'black', viaPenalties: false },
      { a: 'black', b: 'blue', winner: 'black', viaPenalties: false },
      { a: 'black', b: 'white', winner: 'white', viaPenalties: false },
    ];
    const fx = fixture({ matchLog: log, wins: { black: 2, white: 1, blue: 0 } });
    const d = diagnoseNight(fx, new Map(roster().map((p) => [p.id, p])), noErrors);
    expect(d.played).toEqual({ black: 3, white: 2, blue: 1 });
    expect(d.winRate!.black).toBeCloseTo(2 / 3, 5);
    expect(d.winRate!.blue).toBe(0);
  });

  it('has no win rate for a tally-only night', () => {
    const d = diagnoseNight(fixture(), new Map(roster().map((p) => [p.id, p])), noErrors);
    expect(d.played).toBeNull();
    expect(d.winRate).toBeNull();
  });
});

describe('diagnosing a season', () => {
  it('states the baseline it is judging against, not just the count', () => {
    // A quarter of nights clear the bar however good the teams are. Reporting
    // the share without this beside it turns an ordinary season into an
    // accusation.
    const s = diagnoseSeason([fixture()], roster());
    expect(s.expectedLopsidedShare).toBeCloseTo(0.25, 5);
  });

  it('knows five nights is not enough to conclude anything', () => {
    const hist = Array.from({ length: 5 }, (_, i) =>
      fixture({ id: `fx${i}`, date: `2026-03-0${i + 1}` }),
    );
    const s = diagnoseSeason(hist, roster());
    expect(s.nights).toHaveLength(5);
    expect(s.inconclusive).toBe(true);
    expect(s.nightsForConfidence).toBeGreaterThan(5);
  });

  it('skips nights with no result recorded', () => {
    const hist = [fixture({ id: 'a' }), fixture({ id: 'b', wins: { black: 0, white: 0, blue: 0 } })];
    expect(diagnoseSeason(hist, roster()).nights).toHaveLength(1);
  });

  it('lists nights newest first', () => {
    const hist = [
      fixture({ id: 'a', date: '2026-01-01' }),
      fixture({ id: 'b', date: '2026-02-01' }),
    ];
    expect(diagnoseSeason(hist, roster()).nights.map((n) => n.date)).toEqual([
      '2026-02-01',
      '2026-01-01',
    ]);
  });
});
