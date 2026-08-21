import type { MatchLogEntry, TeamColor, TeamWins } from './types';
import { TEAM_COLORS } from './balancer';

// Logging the night match by match (§2.18).
//
// The tally used to be typed in at the end: three numbers, from memory, after
// two hours of football. `types.ts` called that a deliberate trade — less
// analytical power, but it is what actually gets written down. Logging as you
// go turns out to be *less* work rather than more, because of the one rule
// that makes it nearly automatic: the winner stays on and the resting team
// comes in. So after the first pairing is chosen, every subsequent match is
// already known, and recording one is a single tap on whoever won.
//
// Everything here is derived from the log rather than stored alongside it.
// Two records that can disagree is how a night ends up with a tally that
// doesn't match the matches.

// Who is left out when these two play. Three teams, one pitch: there is always
// exactly one, which is what makes the rotation self-driving.
export function restingTeam(a: TeamColor, b: TeamColor): TeamColor {
  const rest = TEAM_COLORS.find((c) => c !== a && c !== b);
  if (!rest) throw new Error(`no resting team for ${a} v ${b}`);
  return rest;
}

// The three ways a night can open. Only this first one is a choice — after it,
// the results decide.
export const OPENING_PAIRS: [TeamColor, TeamColor][] = [
  ['black', 'white'],
  ['black', 'blue'],
  ['white', 'blue'],
];

// A win before penalties is worth one; taking it on penalties is worth half.
// The same house rule the end-of-night tally already used, so a logged night
// and a typed one produce numbers that mean the same thing and can sit in the
// same history table.
export const pointsFor = (entry: MatchLogEntry): number => (entry.viaPenalties ? 0.5 : 1);

export const loserOf = (entry: MatchLogEntry): TeamColor =>
  entry.winner === entry.a ? entry.b : entry.a;

// Who plays next. Null before the first pairing has been chosen — that one is
// the organiser's, and nothing can infer it.
export function nextPairing(log: MatchLogEntry[]): [TeamColor, TeamColor] | null {
  const last = log[log.length - 1];
  if (!last) return null;
  // winner stays on, the team that has been standing about comes in
  return [last.winner, restingTeam(last.a, last.b)];
}

export function winsFromLog(log: MatchLogEntry[]): TeamWins {
  const wins: TeamWins = { black: 0, white: 0, blue: 0 };
  for (const entry of log) wins[entry.winner] += pointsFor(entry);
  return wins;
}

// How many matches each team actually played, which the win tally alone can
// never say — a team on two wins from two is not the same as two from six, and
// the difference only exists once the night is logged.
export function playedCounts(log: MatchLogEntry[]): Record<TeamColor, number> {
  const played: Record<TeamColor, number> = { black: 0, white: 0, blue: 0 };
  for (const entry of log) {
    played[entry.a]++;
    played[entry.b]++;
  }
  return played;
}

// A team that has just won two on the trot is about to play a third without
// leaving the pitch. Worth surfacing: it is the one unfairness winner-stays-on
// creates, and the organiser is the only one who can call it.
export function consecutiveMatches(log: MatchLogEntry[], team: TeamColor): number {
  let run = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry.a !== team && entry.b !== team) break;
    run++;
  }
  return run;
}

// Are these the same night's matches? Compared field by field rather than by
// reference or JSON, because the two copies being compared arrive from
// different places — one polled off the Worker, one held in the session — and
// are never the same object even when they say the same thing. Used to stop a
// poll and a local write chasing each other round every three seconds.
export function sameLog(a: MatchLogEntry[], b: MatchLogEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (m, i) =>
        m.a === b[i].a &&
        m.b === b[i].b &&
        m.winner === b[i].winner &&
        m.viaPenalties === b[i].viaPenalties,
    )
  );
}

// Recording a result. Kept as a function rather than an array push so the
// caller cannot file a match between two teams that were not the ones on the
// pitch — the pairing is not the organiser's to choose after the first one.
export function recordMatch(
  log: MatchLogEntry[],
  winner: TeamColor,
  viaPenalties: boolean,
  opening?: [TeamColor, TeamColor],
): MatchLogEntry[] {
  const pair = nextPairing(log) ?? opening;
  if (!pair) throw new Error('no pairing: the first match has to be chosen');
  const [a, b] = pair;
  if (winner !== a && winner !== b) throw new Error(`${winner} is not playing this match`);
  return [...log, { a, b, winner, viaPenalties }];
}
