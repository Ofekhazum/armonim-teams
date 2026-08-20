import type { MatchLogEntry, TeamColor } from '../types';
import {
  OPENING_PAIRS,
  consecutiveMatches,
  loserOf,
  nextPairing,
  recordMatch,
  restingTeam,
} from '../matchLog';
import { TEAM_META } from './ui';

// Writing the night down as it happens (§2.18).
//
// The interaction is built around the one rule that makes this cheap: after
// the opening pairing, the winner stays on and the resting team comes in, so
// there is never a pairing to choose again. Recording a match is therefore one
// question — who won — and one toggle for whether it went to penalties. Two
// taps, between matches, while the teams are swapping over.

interface Props {
  log: MatchLogEntry[];
  onChange: (log: MatchLogEntry[]) => void;
  // saving the night is the organiser's, and so is writing down what happened
  isAdmin: boolean;
}

const Chip = ({ color }: { color: TeamColor }) => (
  <span className="whitespace-nowrap font-bold">
    {TEAM_META[color].emoji} {TEAM_META[color].label}
  </span>
);

export default function MatchLog({ log, onChange, isAdmin }: Props) {
  const pair = nextPairing(log);

  const record = (winner: TeamColor, viaPenalties: boolean, opening?: [TeamColor, TeamColor]) =>
    onChange(recordMatch(log, winner, viaPenalties, opening));

  // One row per way this match can end: won outright, or taken on penalties.
  // Deliberately four buttons rather than a winner picker plus a checkbox —
  // a checkbox you have to set *before* tapping the winner is a checkbox that
  // gets forgotten, and the difference is half a win.
  const Outcome = ({ a, b, opening }: { a: TeamColor; b: TeamColor; opening?: [TeamColor, TeamColor] }) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {[a, b].map((winner) => (
        <div
          key={winner}
          className="flex flex-col gap-1.5 rounded-xl border border-amber-900/15 bg-white/70 p-2.5"
        >
          <span className="text-sm text-amber-900/70">
            <Chip color={winner} /> won
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => record(winner, false, opening)}
              className="flex-1 rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-amber-50 shadow-sm transition-transform hover:scale-105"
            >
              in play · 1
            </button>
            <button
              onClick={() => record(winner, true, opening)}
              className="flex-1 rounded-lg border border-amber-900/30 px-3 py-2 text-sm font-bold text-amber-900 transition-colors hover:border-orange-500"
              title="Won on penalties — half a win, per the house rule"
            >
              penalties · ½
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  const streak = pair ? consecutiveMatches(log, pair[0]) : 0;

  return (
    <div className="space-y-3 rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-amber-950">📋 Matches</h3>
        {log.length > 0 && (
          <span className="text-xs text-amber-900/60">
            {log.length} played{isAdmin ? ' · tally below is counted from these' : ''}
          </span>
        )}
      </div>

      {log.length > 0 && (
        <ol className="space-y-1 text-sm">
          {log.map((entry, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-white/50 px-2.5 py-1.5"
            >
              <span className="w-5 shrink-0 text-xs font-bold text-amber-900/40">{i + 1}</span>
              <Chip color={entry.winner} />
              <span className="text-amber-900/60">beat</span>
              <Chip color={loserOf(entry)} />
              <span className="ml-auto text-xs font-bold text-amber-900/70">
                {entry.viaPenalties ? 'on penalties · ½' : '1'}
              </span>
            </li>
          ))}
        </ol>
      )}

      {!isAdmin ? (
        log.length === 0 && (
          <p className="text-sm text-amber-900/60">Nothing played yet.</p>
        )
      ) : pair === null ? (
        <div className="space-y-2">
          <p className="text-sm text-amber-900/70">
            Who kicks off? This is the only pairing anyone picks — after it, the winner stays on
            and the resting team comes in.
          </p>
          {OPENING_PAIRS.map(([a, b]) => (
            <div key={`${a}-${b}`} className="space-y-1.5 border-t border-amber-900/10 pt-2">
              <div className="text-sm font-semibold text-amber-950">
                <Chip color={a} /> <span className="text-amber-900/50">v</span> <Chip color={b} />
                <span className="ml-2 text-xs font-normal text-amber-900/50">
                  <Chip color={restingTeam(a, b)} /> rests
                </span>
              </div>
              <Outcome a={a} b={b} opening={[a, b]} />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-amber-950">
            <span className="text-amber-900/60">On now:</span>
            <Chip color={pair[0]} /> <span className="text-amber-900/50">v</span>{' '}
            <Chip color={pair[1]} />
            <span className="text-xs font-normal text-amber-900/50">
              · <Chip color={restingTeam(pair[0], pair[1])} /> rests
            </span>
          </div>
          {/* the one unfairness winner-stays-on creates, and only the organiser
              can call it — so say it rather than let it go unnoticed */}
          {streak >= 3 && (
            <p className="text-xs font-bold text-amber-900">
              <Chip color={pair[0]} /> are on their {streak}
              {streak === 3 ? 'rd' : 'th'} in a row.
            </p>
          )}
          <Outcome a={pair[0]} b={pair[1]} />
          <button
            onClick={() => onChange(log.slice(0, -1))}
            className="text-xs font-semibold text-amber-900/60 underline underline-offset-2 hover:text-orange-700"
          >
            Undo last match
          </button>
        </div>
      )}
    </div>
  );
}
