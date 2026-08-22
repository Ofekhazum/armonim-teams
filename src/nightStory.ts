// Reading a night back off its match log (§2.22).
//
// A tallied night is three numbers. A logged night is the order things happened
// in, and the order is where everything interesting lives: a team that won five
// on the trot and a team that won five spread across the evening file the same
// result and were not remotely the same night.
//
// Everything here describes the **sequence**, never a player. That is what makes
// it safe to be loud about: one night's log is not a sample of anything, it is
// the whole population of that night, so "the lead changed nine times" is a
// description rather than an estimate. Claims about people need many nights and
// live behind the floors in playerProfile.ts.
//
// The detectors below emit **structured facts, not sentences**. Hand-written
// strings are the thing that goes stale — six patterns and a dozen matches a
// night means the same three lines every week by about week five. A fact with
// its numbers attached can be written up differently every time by whatever
// does the writing.

import type { FixtureRecord, MatchLogEntry, TeamColor } from './types';
import { TEAM_COLORS } from './balancer';
import { loserOf, pointsFor } from './matchLog';

// --- Thresholds --------------------------------------------------------------
//
// Winner-stays-on means a team on a run plays every match, so with three even
// teams a run is roughly a coin flip repeated: fours turn up most weeks, fives
// are worth a mention, sixes are the story of the night. These are the numbers
// to move if the moments start feeling routine — that is the failure mode to
// watch for, not a missing one.

// A run has to be this long before ending it counts as ending something.
export const DOMINANT_RUN = 4;
// Matches from the opening whistle without leaving the pitch.
export const BREAK_AND_RUN = 3;
// Alternating results this many matches deep before it is a pattern and not
// just what happens.
export const YO_YO = 4;
// A team needs this many of its own matches before its two halves are worth
// comparing at all.
export const HALVES_MIN = 6;
// Played this many and won them all, or lost them all.
export const SWEEP_MIN = 4;
// Penalties this often and the night was about nerve.
export const MANY_SHOOTOUTS = 3;

export interface TeamNight {
  played: number;
  won: number;
  points: number; // half a win for a shootout, as the tally counts it
  longestRun: number;
}

export type NightFact =
  // somebody finally beat the team that had taken over the evening
  | { kind: 'streak-broken'; by: TeamColor; over: TeamColor; length: number; at: number }
  // on from the first whistle and stayed on
  | { kind: 'break-and-run'; team: TeamColor; through: number }
  // win, lose, win, lose — a team that could not decide what it was
  | { kind: 'yo-yo'; team: TeamColor; run: number }
  // nowhere early, everywhere late
  | { kind: 'heist'; team: TeamColor; early: number; earlyOf: number; late: number; lateOf: number }
  | { kind: 'perfect'; team: TeamColor; played: number }
  | { kind: 'blanked'; team: TeamColor; played: number }
  | { kind: 'shootouts'; count: number };

// Rarest first, so anything that has to be cut loses the ordinary end.
const FACT_RANK: Record<NightFact['kind'], number> = {
  perfect: 0,
  'streak-broken': 1,
  heist: 2,
  'break-and-run': 3,
  blanked: 4,
  'yo-yo': 5,
  shootouts: 6,
};

export type Flavour = 'dictatorship' | 'chaos' | 'tug-of-war' | 'ordinary';

export interface NightStory {
  matches: number;
  penalties: number;
  // how often the team on top of the tally changed hands
  leadChanges: number;
  // 0–1: how often the winner differed from the previous winner. 1 is nobody
  // ever winning twice, 0 is one team taking the whole evening.
  alternation: number;
  teams: Record<TeamColor, TeamNight>;
  longest: { team: TeamColor; length: number } | null;
  flavour: Flavour;
  headline: string;
  facts: NightFact[];
}

// Several headlines per flavour, picked by the fixture's own id — so it is
// stable for a given night and different from the night before it. The cheapest
// possible defence against a page that reads identically every week; the real
// one is that the numbers underneath differ.
const HEADLINES: Record<Flavour, string[]> = {
  dictatorship: ['A dictatorship', 'One team, one evening', 'Somebody took over', 'A reign'],
  chaos: ['Complete chaos', 'Nobody could hold the pitch', 'All change, every match', 'Anarchy'],
  'tug-of-war': ['A tug of war', 'Nothing in it', 'Traded all night', 'Toe to toe'],
  ordinary: ['An ordinary Tuesday', 'A night of football', 'Business as usual', 'Just football'],
};

const seedOf = (id: string): number => {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return n;
};

// The run of consecutive matches a team won, ending at (and including) `end`.
const runEndingAt = (log: MatchLogEntry[], end: number): number => {
  let n = 0;
  for (let i = end; i >= 0 && log[i].winner === log[end].winner; i--) n++;
  return n;
};

/** Every match this team was in, in order, and whether they won it. */
function ownMatches(log: MatchLogEntry[], team: TeamColor): boolean[] {
  const out: boolean[] = [];
  for (const m of log) {
    if (m.a === team || m.b === team) out.push(m.winner === team);
  }
  return out;
}

function detect(log: MatchLogEntry[]): NightFact[] {
  const facts: NightFact[] = [];

  // The Danger — a run of real length, ended. Only the *ending* is the fact:
  // a run still going when the night finished was never broken by anybody.
  for (let i = 0; i < log.length; i++) {
    const beaten = loserOf(log[i]);
    if (i === 0 || log[i - 1].winner !== beaten) continue;
    const length = runEndingAt(log, i - 1);
    if (length >= DOMINANT_RUN) {
      facts.push({ kind: 'streak-broken', by: log[i].winner, over: beaten, length, at: i + 1 });
    }
  }

  for (const c of TEAM_COLORS) {
    const own = ownMatches(log, c);
    if (own.length === 0) continue;

    // Break and run — in the opening match and still out there after a full
    // rotation, which in three teams means beating both of the others.
    if ((log[0].a === c || log[0].b === c) && own.length >= BREAK_AND_RUN) {
      let through = 0;
      while (through < own.length && own[through]) through++;
      if (through >= BREAK_AND_RUN) facts.push({ kind: 'break-and-run', team: c, through });
    }

    if (own.length >= SWEEP_MIN && own.every(Boolean)) {
      facts.push({ kind: 'perfect', team: c, played: own.length });
    }
    if (own.length >= SWEEP_MIN && !own.some(Boolean)) {
      facts.push({ kind: 'blanked', team: c, played: own.length });
    }

    // Yo-yo — the longest stretch of strictly alternating results.
    let alt = 1;
    let bestAlt = 1;
    for (let i = 1; i < own.length; i++) {
      alt = own[i] === own[i - 1] ? 1 : alt + 1;
      bestAlt = Math.max(bestAlt, alt);
    }
    if (bestAlt >= YO_YO) facts.push({ kind: 'yo-yo', team: c, run: bestAlt });

    // The heist — nothing early, everything late. Compared as halves of *their*
    // matches rather than of the night, because a team that sat out the middle
    // hour has a different night from the one the clock had.
    if (own.length >= HALVES_MIN) {
      const half = Math.floor(own.length / 2);
      const early = own.slice(0, half).filter(Boolean).length;
      const late = own.slice(own.length - half).filter(Boolean).length;
      if (early * 3 <= half && late * 3 >= half * 2) {
        facts.push({ kind: 'heist', team: c, early, earlyOf: half, late, lateOf: half });
      }
    }
  }

  const penalties = log.filter((m) => m.viaPenalties).length;
  if (penalties >= MANY_SHOOTOUTS) facts.push({ kind: 'shootouts', count: penalties });

  return facts.sort((a, b) => FACT_RANK[a.kind] - FACT_RANK[b.kind]);
}

function flavourOf(log: MatchLogEntry[], longestRun: number, alternation: number): Flavour {
  // One team taking five in a row, or better than half of everything played,
  // is the evening belonging to somebody.
  const dominant = TEAM_COLORS.some(
    (c) => log.filter((m) => m.winner === c).length * 2 > log.length,
  );
  if (longestRun >= 5 || (dominant && longestRun >= 4)) return 'dictatorship';
  if (alternation >= 0.75 && longestRun <= 2) return 'chaos';
  if (alternation >= 0.5) return 'tug-of-war';
  return 'ordinary';
}

/**
 * The night, read off its own log. Null for a night that was tallied from
 * memory — there is no sequence to describe, and inventing one from three
 * totals would be making it up.
 */
export function nightStory(fx: FixtureRecord): NightStory | null {
  const log = fx.matchLog ?? [];
  if (log.length === 0) return null;

  const teams = Object.fromEntries(
    TEAM_COLORS.map((c) => [c, { played: 0, won: 0, points: 0, longestRun: 0 }]),
  ) as Record<TeamColor, TeamNight>;

  let alternations = 0;
  let leadChanges = 0;
  let leader: TeamColor | null = null;
  let longestLen = 0;
  let longestTeam: TeamColor | null = null;

  log.forEach((m, i) => {
    teams[m.a].played++;
    teams[m.b].played++;
    teams[m.winner].won++;
    teams[m.winner].points += pointsFor(m);

    const run = runEndingAt(log, i);
    teams[m.winner].longestRun = Math.max(teams[m.winner].longestRun, run);
    if (run > longestLen) {
      longestLen = run;
      longestTeam = m.winner;
    }

    if (i > 0 && log[i - 1].winner !== m.winner) alternations++;

    // who is top of the tally after this match; ties leave the lead where it
    // was rather than counting a change to nobody
    const top = Math.max(...TEAM_COLORS.map((c) => teams[c].points));
    const atTop = TEAM_COLORS.filter((c) => teams[c].points === top);
    if (atTop.length === 1 && atTop[0] !== leader) {
      if (leader !== null) leadChanges++;
      leader = atTop[0];
    }
  });

  const alternation = log.length > 1 ? alternations / (log.length - 1) : 0;
  const flavour = flavourOf(log, longestLen, alternation);
  const bank = HEADLINES[flavour];

  return {
    matches: log.length,
    penalties: log.filter((m) => m.viaPenalties).length,
    leadChanges,
    alternation,
    teams,
    longest: longestTeam ? { team: longestTeam, length: longestLen } : null,
    flavour,
    headline: bank[seedOf(fx.id) % bank.length],
    facts: detect(log),
  };
}

/** Which matches a given player was in, and how many they won. */
export function playerNight(
  fx: FixtureRecord,
  id: string,
): { team: TeamColor; played: number; won: number } | null {
  const team = TEAM_COLORS.find((c) => fx.teams[c].includes(id));
  if (!team) return null;
  const own = ownMatches(fx.matchLog ?? [], team);
  return { team, played: own.length, won: own.filter(Boolean).length };
}
