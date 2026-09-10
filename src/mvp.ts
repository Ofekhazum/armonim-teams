// How many times each player has been named MVP — the one deliberately
// subjective input in this app. Everywhere else a fact has to be derived
// from the three win counts (§2.6) precisely because a human declaring
// "this player was good tonight" is a claim the data can't support (§2.9's
// whole design rule). MVP is the opposite: the organiser's own judgment,
// recorded as-is and simply counted afterwards — the count is honest
// because it's counting a real pick, not manufacturing one.

import type {
  DraftTeamWins,
  FixturePlayer,
  FixtureRecord,
  TeamColor,
  TeamWins,
} from './types';
import { TEAM_COLORS } from './balancer';

export interface MvpCount {
  id: string;
  name: string;
  count: number;
}

// --- The night's vote ------------------------------------------------------
//
// One pick was the whole record until §2.46. It answered "who was best" and
// threw away everything else the room said — a 3–2 and a 5–0 filed as the same
// fact, and the player two votes short of it filed as nobody.
//
// The tally is kept *beside* `mvpId` rather than replacing it, and that split
// is the point: `mvpId` is still the pick, still one name a night, and still
// the only thing Team of the Month, the leaderboards, the badges and the
// monthly recap count. The votes are read by exactly one thing — the mark out
// of ten (`grades.ts`) — because that is the one place a margin has anywhere to
// go. Widening the honour itself was not asked for and would quietly re-weight
// half the app.

/** One row of the sheet. Zero-vote players are not rows — see `FixtureRecord`. */
export interface MvpVote {
  id: string;
  name: string;
  votes: number;
}

/** How many were cast in total. 0 both for "no sheet" and for an empty one. */
export const totalVotes = (votes: Record<string, number> | undefined): number =>
  votes ? Object.values(votes).reduce((s, n) => s + (n > 0 ? n : 0), 0) : 0;

/**
 * The sheet as rows, most votes first, names as the night recorded them.
 *
 * Ties are left in name order rather than broken here. Who won a tied vote is
 * the organiser's call and is recorded in `mvpId`; a function that counted
 * would be guessing at it.
 */
export function voteTally(fx: FixtureRecord): MvpVote[] {
  const votes = fx.mvpVotes;
  if (!votes) return [];
  return Object.entries(votes)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({
      id,
      name: fx.players.find((p) => p.id === id)?.name ?? '?',
      votes: n,
    }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'he'));
}

/**
 * Everyone level at the top of the sheet — one id normally, more on a tie.
 *
 * Empty when nobody has a vote, which is what makes "has the sheet decided
 * anything yet" a question the caller can ask without special-casing.
 */
export function voteLeaders(votes: Record<string, number> | undefined): string[] {
  if (!votes) return [];
  const cast = Object.entries(votes).filter(([, n]) => n > 0);
  if (cast.length === 0) return [];
  const top = Math.max(...cast.map(([, n]) => n));
  return cast.filter(([, n]) => n === top).map(([id]) => id);
}

/**
 * Who the sheet says is MVP, given who was picked before it was typed.
 *
 * The pick follows the votes — that is the whole feature — except on a tie,
 * where the votes genuinely do not answer it. There the existing pick stands if
 * it is one of the tied names, and otherwise nobody is picked until the
 * organiser says. Silently crowning whichever of two level names sorts first
 * would be the app inventing the one judgement it is supposed to be recording.
 */
export function mvpFromVotes(
  votes: Record<string, number> | undefined,
  current: string | null | undefined,
): string | null {
  const leaders = voteLeaders(votes);
  if (leaders.length === 0) return current ?? null;
  if (leaders.length === 1) return leaders[0];
  return current && leaders.includes(current) ? current : null;
}

// Ranked most MVP nights first. Works over any fixture list — the whole
// history for a career total (History's standings table), or an
// already-month-filtered list for the monthly recap (wrapped.ts).
export function mvpCounts(fixtures: FixtureRecord[]): MvpCount[] {
  const counts = new Map<string, number>();
  const nameOf = new Map<string, string>();
  for (const fx of fixtures) {
    if (!fx.mvpId) continue;
    const player = fx.players.find((p) => p.id === fx.mvpId);
    if (!player) continue; // defensive: a malformed record shouldn't crash the count
    nameOf.set(fx.mvpId, player.name);
    counts.set(fx.mvpId, (counts.get(fx.mvpId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: nameOf.get(id)!, count }))
    .sort((a, b) => b.count - a.count);
}

// Who topped the night. Plural because a tie is ordinary — three teams sharing
// a night's matches between them land level often enough that "the winner" is
// the wrong shape for this. All the tied teams are returned, in shirt order.
export function winningTeams(wins: TeamWins | DraftTeamWins): TeamColor[] {
  const best = Math.max(...TEAM_COLORS.map((c) => wins[c] ?? 0));
  return TEAM_COLORS.filter((c) => (wins[c] ?? 0) === best);
}

// Who can be picked MVP for a night: the winning team's players, or every tied
// team's players when the night finished level. The house rule — the pick comes
// from the team that won — enforced by not offering anyone else, rather than
// by remembering. Ties nobody breaks, because the tally didn't.
//
// A pick already on file is always included even when the tally no longer makes
// their team a winner. That happens when a result is corrected after the fact,
// and a dropdown whose current value isn't among its own options shows blank —
// which would quietly clear a real pick on the next save. Correcting the score
// is not a reason to silently un-name somebody.
// `wins` is a parameter rather than simply `fx.wins` so the edit form can pass
// the tally being typed: correcting a score and picking the MVP happen in the
// same drawer, and the list has to follow the correction rather than the
// version on file.
export function mvpCandidates(
  fx: FixtureRecord,
  wins: TeamWins | DraftTeamWins = fx.wins,
): FixturePlayer[] {
  const eligible = new Set<string>();
  for (const c of winningTeams(wins)) for (const id of fx.teams[c]) eligible.add(id);
  if (fx.mvpId) eligible.add(fx.mvpId);
  // Anyone already holding votes, for the same reason as the pick above: a
  // corrected scoreline must not drop a name off the sheet and take their
  // votes with it on the next save.
  for (const [id, n] of Object.entries(fx.mvpVotes ?? {})) if (n > 0) eligible.add(id);
  return fx.players.filter((p) => eligible.has(p.id));
}

// Filing a night that may already be filed. The fixture page rebuilds the
// whole record from the session every time it saves, which is right for
// everything it knows about — the teams, the tally, the match log — and wrong
// for the one field it doesn't: the MVP is picked afterwards, on History, and
// a second save (another match logged, the date corrected, the button pressed
// twice) would otherwise write a record with no pick straight over one that
// had it. Filing is idempotent; forgetting is not.
export function preserveMvp(
  existing: FixtureRecord | undefined,
  fixture: FixtureRecord,
): FixtureRecord {
  // an explicit pick on the incoming record still wins — this only fills a gap
  const mvpId = fixture.mvpId || existing?.mvpId;
  // The vote sheet is filed in the same drawer as the pick and is lost the same
  // way — a re-save from the fixture page knows nothing about either.
  const mvpVotes = fixture.mvpVotes ?? existing?.mvpVotes;
  if (!mvpId && !mvpVotes) return fixture;
  return {
    ...fixture,
    ...(mvpId ? { mvpId } : {}),
    ...(mvpVotes ? { mvpVotes } : {}),
  };
}
