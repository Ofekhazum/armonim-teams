// Where a player's wins fall inside a night (§2.23).
//
// Everything else about a player counts nights: turned up, won, took the night.
// This counts *when* — which only exists on nights logged match by match, and
// only became askable when the log did. Three questions, all of them the same
// walk over the same sequence:
//
//   · **Coming off a loss.** Winner stays on, so losing puts you on the bench
//     for exactly one match. How did the match after that go?
//   · **Early and late.** Their first matches of a night against their last.
//   · **Across the night.** Beginning, middle or end of the evening their wins
//     land in.
//
// Two rules keep this honest, and they are the whole reason the file reads the
// way it does.
//
// **It reports counts and never a trait.** "Won 9 of 14 coming off a loss" is
// something that happened. "Mentally resilient" is a claim about a person, and
// four fixtures is about thirty matches — nowhere near enough to tell a
// resilient player from a lucky one. The app never says the second thing in its
// own voice; a description of the record is as far as it goes.
//
// **Two of the three are computed and not currently drawn.** Only the quarters
// are on the player page; early-versus-late and the bench return are counted
// here and shown nowhere, kept for the night reporter — the numbers are the
// hard part and they cost one pass over history either way. Deleting them
// would only mean writing them again.
//
// **Coming off a loss is measured against the club, not against 50%.** After
// your team loses you sit one match and come back against a team that has just
// played two in a row. *Everybody's* number is lifted by that, so the rotation
// would look like character in every single player. The baseline is what the
// whole club does in the same situation, and a player is only interesting
// against it.

import type { FixtureRecord, TeamColor } from './types';
import { TEAM_COLORS } from './balancer';

// Nights logged match by match, before any of this is about them rather than
// about a handful of matches. Same floor the player page already uses for
// everything else it says (MIN_PROFILE_NIGHTS).
export const MIN_ARC_NIGHTS = 4;
// Per-metric floors on top of the night gate: a player can clear four nights
// and still have barely come off a loss, and the halves need enough on both
// sides to be a comparison rather than a coincidence.
export const MIN_BOUNCE = 8;
export const MIN_HALF = 8;
// A gap smaller than this is not worth remarking on either way — it is well
// inside what a few dozen matches will produce by chance.
export const NOTABLE_GAP = 0.2;

export interface Tally {
  played: number;
  won: number;
}

export interface Arcs {
  loggedNights: number;
  matches: number;
  won: number;
  // Beginning, middle and end of the night — by when the match was played,
  // not by how many the player had had. Three rather than four: a quarter
  // needs roughly a dozen matches behind it before its rate means anything,
  // and most nights only run nine to thirteen — a fourth bucket was routinely
  // the thinnest slice on the card, saying the least while taking up a quarter
  // of the space. Three keeps every bucket close to a third of a typical
  // night's matches instead.
  parts: Tally[];
  early: Tally;
  late: Tally;
  bounce: Tally;
}

const empty = (): Tally => ({ played: 0, won: 0 });

const add = (t: Tally, won: boolean) => {
  t.played++;
  if (won) t.won++;
};

export const rate = (t: Tally): number | null => (t.played === 0 ? null : t.won / t.played);

/** Which team this player was in that night, if they were there at all. */
const teamIn = (fx: FixtureRecord, id: string): TeamColor | null =>
  TEAM_COLORS.find((c) => fx.teams[c].includes(id)) ?? null;

/**
 * A team's own matches that night: whether they won, and where in the night it
 * sat. Sitting out is not an entry — the bench is the gap between two of these,
 * which is exactly what makes "the match after a loss" findable.
 */
function ownMatches(fx: FixtureRecord, team: TeamColor): { won: boolean; at: number }[] {
  const log = fx.matchLog ?? [];
  const out: { won: boolean; at: number }[] = [];
  log.forEach((m, at) => {
    if (m.a === team || m.b === team) out.push({ won: m.winner === team, at });
  });
  return out;
}

function walk(fx: FixtureRecord, team: TeamColor, arcs: Arcs) {
  const total = (fx.matchLog ?? []).length;
  const own = ownMatches(fx, team);
  if (own.length === 0) return;

  arcs.loggedNights++;
  const half = Math.floor(own.length / 2);

  own.forEach((m, i) => {
    arcs.matches++;
    if (m.won) arcs.won++;

    // Third of the *night*, not of their own matches: "when their wins
    // happen" is a question about the evening, and a team that sat out the
    // middle hour did not thereby play a long first third.
    const part = total > 1 ? Math.min(2, Math.floor((m.at / total) * 3)) : 0;
    add(arcs.parts[part], m.won);

    // Their own first matches against their own last, with the middle one
    // dropped on an odd count so the two sides are the same size.
    if (i < half) add(arcs.early, m.won);
    if (i >= own.length - half) add(arcs.late, m.won);

    // The match after a loss. Winner stays on, so the previous entry being a
    // loss is exactly "they came back on after sitting one out".
    if (i > 0 && !own[i - 1].won) add(arcs.bounce, m.won);
  });
}

/** One player's shape across the nights that were logged. */
export function playerArcs(history: FixtureRecord[], id: string): Arcs {
  const arcs: Arcs = {
    loggedNights: 0,
    matches: 0,
    won: 0,
    parts: [empty(), empty(), empty()],
    early: empty(),
    late: empty(),
    bounce: empty(),
  };
  for (const fx of history) {
    if (!fx.matchLog?.length) continue;
    const team = teamIn(fx, id);
    if (team) walk(fx, team, arcs);
  }
  return arcs;
}

/**
 * What the whole club does coming off a loss — the baseline the individual
 * number only means anything against.
 *
 * Counted per team-match rather than per player, because the five players in a
 * team share one result and counting them five times would say the same thing
 * five times over.
 */
export function clubBounce(history: FixtureRecord[]): Tally {
  const t = empty();
  for (const fx of history) {
    if (!fx.matchLog?.length) continue;
    for (const c of TEAM_COLORS) {
      const own = ownMatches(fx, c);
      for (let i = 1; i < own.length; i++) {
        if (!own[i - 1].won) add(t, own[i].won);
      }
    }
  }
  return t;
}

export type Lean = 'early' | 'late' | 'level' | null;

/**
 * Which half of their nights a player's wins actually landed in — `null` until
 * both halves have enough in them to be compared, and 'level' when the two are
 * close enough that naming a direction would be reading noise.
 */
export function lean(arcs: Arcs): Lean {
  if (arcs.early.played < MIN_HALF || arcs.late.played < MIN_HALF) return null;
  const gap = (rate(arcs.late) ?? 0) - (rate(arcs.early) ?? 0);
  if (Math.abs(gap) < NOTABLE_GAP) return 'level';
  return gap > 0 ? 'late' : 'early';
}

/**
 * How a player's record coming off a loss compares with everyone's. Positive is
 * above the club, in percentage points. Null while there is not enough of it.
 */
export function bounceVsClub(arcs: Arcs, club: Tally): number | null {
  if (arcs.bounce.played < MIN_BOUNCE) return null;
  const mine = rate(arcs.bounce);
  const theirs = rate(club);
  if (mine === null || theirs === null) return null;
  return mine - theirs;
}
