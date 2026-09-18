import { describe, expect, it } from 'vitest';
import { TEAM_COLORS, generateTeams, teamStats } from './balancer';
import { ATTACK_DEFAULT } from './types';
import type { Player, TeamColor, Teams } from './types';

// "No keeper on my team, please" (§2.59).
//
// The balancer is a hill-climber over random restarts, so these assert the
// *outcome* rather than a single arrangement, and they ask for it several times
// — a rule that only holds on a lucky restart is not a rule the organiser can
// rely on for their night.

const mk = (id: string, over: Partial<Player> = {}): Player => ({
  id,
  name: id,
  rating: 3,
  attack: ATTACK_DEFAULT,
  chemistry: [],
  avoid: [],
  ...over,
});

/** Fifteen players: `keepers` of them in goal, `wanters` of them asking. */
const squad = (keepers: number, wanters: number): Player[] =>
  Array.from({ length: 15 }, (_, i) =>
    mk(`p${i}`, {
      ...(i < keepers ? { isGk: true } : {}),
      // drawn from the far end, so a wanter is never also a keeper
      ...(i >= 15 - wanters ? { noGkTeammate: true } : {}),
    }),
  );

const gkSet = (keepers: number) =>
  new Set(Array.from({ length: keepers }, (_, i) => `p${i}`));

/** The colour each player ended up wearing. */
const teamOf = (teams: Teams): Map<string, TeamColor> => {
  const out = new Map<string, TeamColor>();
  for (const c of TEAM_COLORS) for (const id of teams[c]) out.set(id, c);
  return out;
};

/** How many of the asking players got a team with the gloves still free. */
function honoured(players: Player[], keepers: number): { ok: number; want: number } {
  const gkIds = gkSet(keepers);
  const byId = new Map(players.map((p) => [p.id, p]));
  const [teams] = generateTeams(players, gkIds, 1);
  const where = teamOf(teams);
  const free = new Set(
    TEAM_COLORS.filter((c) => teamStats(teams[c], byId, gkIds).gkCount === 0),
  );
  const wanters = players.filter((p) => p.noGkTeammate);
  return {
    ok: wanters.filter((p) => free.has(where.get(p.id)!)).length,
    want: wanters.length,
  };
}

describe('keeping a team’s gloves free (noGkTeammate)', () => {
  it('puts the asking player on a team with nobody in goal', () => {
    // One keeper, so two of the three teams are keeper-free — the request is
    // cheap and should simply be met, every time.
    for (let run = 0; run < 12; run++) {
      expect(honoured(squad(1, 1), 1)).toEqual({ ok: 1, want: 1 });
    }
  });

  it('holds with two keepers, where only one team is left free', () => {
    for (let run = 0; run < 12; run++) {
      expect(honoured(squad(2, 1), 2)).toEqual({ ok: 1, want: 1 });
    }
  });

  it('rescues several askers, not just the first', () => {
    // Priced per player on purpose: a team holding two of them has to cost
    // twice as much as one, or the balancer has no reason to move the second
    // once the first is stuck.
    for (let run = 0; run < 8; run++) {
      expect(honoured(squad(1, 4), 1)).toEqual({ ok: 4, want: 4 });
    }
  });

  it('fills the free team to the brim when more ask than fit', () => {
    // Two keepers leaves one free team of five, and six are asking. Five is
    // the arithmetic maximum, so the fifth must still be rescued rather than
    // the balancer giving up once it cannot satisfy everybody.
    for (let run = 0; run < 8; run++) {
      const { ok } = honoured(squad(2, 6), 2);
      expect(ok).toBe(5);
    }
  });

  // The organiser's own rule: "if there are 3 permanent GK in the squad so it
  // is what it is."
  describe('when every team has a keeper', () => {
    it('accepts the night as it is rather than chasing the impossible', () => {
      for (let run = 0; run < 8; run++) {
        expect(honoured(squad(3, 2), 3).ok).toBe(0);
      }
    });

    it('never stacks two keepers on one team to free another', () => {
      // The failure this guards against was real and measured: at 120 a point,
      // three disappointed players outbid `gkStack`, so the balancer started
      // doubling up keepers to empty a team. That reshapes where the *keepers*
      // go, which is no longer a preference about where this player goes.
      const players = squad(3, 3);
      const gkIds = gkSet(3);
      const byId = new Map(players.map((p) => [p.id, p]));
      for (let run = 0; run < 8; run++) {
        const [teams] = generateTeams(players, gkIds, 1);
        for (const c of TEAM_COLORS) {
          expect(teamStats(teams[c], byId, gkIds).gkCount).toBe(1);
        }
      }
    });
  });

  it('ignores the flag on somebody who is themselves in goal', () => {
    // Asking for the gloves to be free while holding them is not a request the
    // night can answer, and left in it would be a penalty on every arrangement
    // — a constant that buys nothing and distorts the terms that matter.
    const players = Array.from({ length: 15 }, (_, i) =>
      mk(`p${i}`, i === 0 ? { isGk: true, noGkTeammate: true } : {}),
    );
    const gkIds = gkSet(1);
    const byId = new Map(players.map((p) => [p.id, p]));
    for (let run = 0; run < 8; run++) {
      const [teams] = generateTeams(players, gkIds, 1);
      // the keeper is still placed normally, and no team is left empty around
      // them trying to satisfy a request about themselves
      const sizes = TEAM_COLORS.map((c) => teamStats(teams[c], byId, gkIds).size);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it('does not buy the preference with a lopsided night', () => {
    // It outranks an ordinary rating trade, which is the point — but the teams
    // still have to be teams. Ratings spread across the squad so that a careless
    // arrangement would show up as a gap.
    const players = Array.from({ length: 15 }, (_, i) =>
      mk(`p${i}`, {
        rating: (i % 5) + 1,
        ...(i < 2 ? { isGk: true } : {}),
        ...(i >= 12 ? { noGkTeammate: true } : {}),
      }),
    );
    const gkIds = gkSet(2);
    const byId = new Map(players.map((p) => [p.id, p]));
    for (let run = 0; run < 8; run++) {
      const [teams] = generateTeams(players, gkIds, 1);
      const avgs = TEAM_COLORS.map((c) => teamStats(teams[c], byId, gkIds).avg).filter(Boolean);
      expect(Math.max(...avgs) - Math.min(...avgs)).toBeLessThan(1);
    }
  });

  it('changes nothing for a squad where nobody asked', () => {
    const players = squad(1, 0);
    const gkIds = gkSet(1);
    const byId = new Map(players.map((p) => [p.id, p]));
    const [teams] = generateTeams(players, gkIds, 1);
    const sizes = TEAM_COLORS.map((c) => teamStats(teams[c], byId, gkIds).size).sort();
    expect(sizes).toEqual([5, 5, 5]);
  });
});
