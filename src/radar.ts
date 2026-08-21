// What tonight could turn into (§2.20).
//
// `milestones.ts` announces a threshold the moment it is crossed. This is the
// other half of the same idea, pointed forwards: who is *one night* away from
// something, said before the football rather than after it. It needs no new
// data — the same appearances ledger, read one step short of the line.
//
// The distinction that keeps this honest: everything here is a **condition**,
// never a prediction. "Wins tonight and it's three in a row" is arithmetic on
// the record. "Likely to win tonight" would be a claim about people that three
// win totals a night cannot support (§2.9), and is the reason this file has no
// probabilities in it.

import type { FixtureRecord, Player } from './types';
import { hasResult } from './calibration';
import {
  MIN_ATTEND_STREAK,
  MIN_WIN_STREAK,
  appearances,
  isWinMilestone,
  teamOf,
} from './milestones';

// A run has to be genuinely on the brink to be worth saying: `MIN_WIN_STREAK`
// is 3, so two-in-a-row qualifies and one does not. Sitting at exactly one
// short is the whole idea — a radar that fires three nights early is noise.
// Everything here is **conditional on how tonight goes**. That is the line
// between this strip and the milestone row under it: milestones state what is
// already true coming in ("has won 3 nights running", "hasn't won in 6"), and
// this states what tonight could turn into. A fact that is certain the moment
// someone is on the team sheet belongs to the row below, not here — which is
// why "tonight is their 10th night" was removed after it appeared in both
// strips at once, word for word.
export type PendingFact =
  // their team winning tonight makes it a run
  | { kind: 'win-streak'; id: string; name: string; current: number }
  // turning up tonight makes the attendance streak
  | { kind: 'iron-man'; id: string; name: string; current: number }
  // this many match wins short of a career milestone, and tonight could cover it
  | { kind: 'nth-win'; id: string; name: string; target: number; away: number };

// A night banks roughly four or five wins per player (see isWinMilestone's
// note), so a milestone within this many is genuinely reachable tonight rather
// than a number someone will pass in a fortnight.
export const WINS_WITHIN_REACH = 5;

// Rarest first, so a capped list drops the ordinary facts rather than the
// remarkable ones — the same ranking idea `milestones.ts` uses.
const RANK: Record<PendingFact['kind'], number> = {
  'nth-win': 0,
  'iron-man': 1,
  'win-streak': 2,
};

export const MAX_PENDING = 4;

// How many recorded nights, counting back, this player has appeared at without
// a gap. Attendance doesn't depend on whether anyone remembered to tally the
// score, so every recorded night counts here — same rule as milestones.ts.
function attendanceRun(id: string, chronological: FixtureRecord[]): number {
  let n = 0;
  for (let i = chronological.length - 1; i >= 0; i--) {
    if (!teamOf(chronological[i], id)) break;
    n++;
  }
  return n;
}

// The run of winning nights at the end of a player's ledger.
function winRun(apps: { won: boolean }[]): number {
  let n = 0;
  for (let i = apps.length - 1; i >= 0 && apps[i].won; i--) n++;
  return n;
}

/**
 * What is one night away, for the players on tonight's sheet.
 *
 * `tonightId` is tonight's own fixture record if it has already been saved —
 * excluded throughout, because tonight is the night being asked about and
 * counting it would have the radar describe a thing that has already happened.
 */
export function pendingTonight(
  todays: Player[],
  history: FixtureRecord[],
  tonightId?: string | null,
): PendingFact[] {
  const past = history
    .filter((fx) => fx.id !== tonightId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const withResult = past.filter((fx) => hasResult(fx.wins));

  const out: PendingFact[] = [];
  for (const p of todays) {
    const apps = appearances(p.id, withResult);
    const wins = apps.reduce((sum, a) => sum + a.wins, 0);

    // the next win milestone above where they stand, if tonight could reach it
    for (let w = Math.floor(wins) + 1; w <= Math.floor(wins) + WINS_WITHIN_REACH; w++) {
      if (!isWinMilestone(w)) continue;
      out.push({ kind: 'nth-win', id: p.id, name: p.name, target: w, away: w - Math.floor(wins) });
      break;
    }

    const run = winRun(apps);
    if (run === MIN_WIN_STREAK - 1) {
      out.push({ kind: 'win-streak', id: p.id, name: p.name, current: run });
    }

    const attend = attendanceRun(p.id, past);
    if (attend === MIN_ATTEND_STREAK - 1) {
      out.push({ kind: 'iron-man', id: p.id, name: p.name, current: attend });
    }
  }

  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind]).slice(0, MAX_PENDING);
}

// --- Tonight's bounty --------------------------------------------------------

export interface Bounty {
  id: string;
  name: string;
  nights: number; // winning nights they are currently on
}

/**
 * The longest active winning run among tonight's players — the one everyone
 * else has a reason to end.
 *
 * Deliberately about a *streak* rather than about a player: the copy is "on
 * three winning nights", which is a count, and the fun comes from the number
 * rather than from any claim about how they play. Returns nothing until a run
 * clears `MIN_WIN_STREAK`, so this stays quiet on an ordinary week instead of
 * manufacturing a rivalry out of one good night.
 *
 * Ties go to nobody: two players level on the longest run is not a bounty on
 * one of them, and picking arbitrarily would invent a target.
 */
export function bountyTonight(
  todays: Player[],
  history: FixtureRecord[],
  tonightId?: string | null,
): Bounty | null {
  const past = history
    .filter((fx) => fx.id !== tonightId && hasResult(fx.wins))
    .sort((a, b) => a.date.localeCompare(b.date));

  const runs = todays
    .map((p) => ({ id: p.id, name: p.name, nights: winRun(appearances(p.id, past)) }))
    .filter((r) => r.nights >= MIN_WIN_STREAK)
    .sort((a, b) => b.nights - a.nights);

  if (runs.length === 0) return null;
  if (runs.length > 1 && runs[1].nights === runs[0].nights) return null;
  return runs[0];
}
