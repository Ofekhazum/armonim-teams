import { useState } from 'react';
import type { MatchLogEntry, TeamColor } from '../types';
import { TEAM_COLORS } from '../balancer';
import {
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
//
// Anyone at the pitch can do it, not only the organiser — the same call the
// clock makes (§2.15). A match ends and whoever is nearest a phone writes it
// down; funnelling that through one person is how a log ends up with holes in
// it. The shared record is one step behind the safest concurrent write the
// Worker will accept, so two people recording the same result is fine and a
// stale phone can't erase somebody else's match.

interface Props {
  log: MatchLogEntry[];
  onChange: (log: MatchLogEntry[]) => void;
  /**
   * Whether to offer "Undo last match". Organiser only.
   *
   * **Recording is shared; taking something back is not**, and the asymmetry is
   * the point. Writing down who won is additive and self-correcting — the
   * worst a wrong tap does is add a match everyone can see is wrong, and two
   * people recording the same result is explicitly fine (see `isLogStep`).
   * An undo deletes a result somebody else wrote, and after the fact there is
   * nothing on screen to show it ever existed.
   *
   * Defaults to `false` so a new caller has to opt in deliberately. A
   * permission that defaults to "granted" is one forgotten prop away from
   * being no permission at all.
   */
  canUndo?: boolean;
}

const Chip = ({ color }: { color: TeamColor }) => (
  <span className="whitespace-nowrap font-bold">
    {TEAM_META[color].emoji} {TEAM_META[color].label}
  </span>
);

const SELECT =
  'rounded-lg border border-amber-900/25 bg-white px-2 py-1.5 text-sm font-semibold text-amber-950 outline-none focus:border-orange-500';

export default function MatchLog({ log, onChange, canUndo = false }: Props) {
  const pair = nextPairing(log);
  // Only ever used for the opening pairing — every later one is decided by the
  // result, not by anybody choosing.
  const [openA, setOpenA] = useState<TeamColor | ''>('');
  const [openB, setOpenB] = useState<TeamColor | ''>('');

  const pickA = (next: TeamColor | '') => {
    setOpenA(next);
    // a team cannot play itself, so choosing whatever was already in the second
    // box has to empty it rather than leave an impossible pairing on screen
    if (next !== '' && next === openB) setOpenB('');
  };

  const record = (winner: TeamColor, viaPenalties: boolean, opening?: [TeamColor, TeamColor]) =>
    onChange(recordMatch(log, winner, viaPenalties, opening));

  // Tap the shirt of whoever won. The team's own colour does the labelling —
  // at a pitch you are looking for the shirt, not reading a sentence — and the
  // half-win case hangs underneath it rather than beside it, so the two are
  // never a choice you have to make *before* saying who won. Getting that
  // order wrong is worth half a win.
  const Outcome = ({ a, b, opening }: { a: TeamColor; b: TeamColor; opening?: [TeamColor, TeamColor] }) => (
    <div className="grid gap-3 sm:grid-cols-2">
      {[a, b].map((winner) => {
        const m = TEAM_META[winner];
        return (
          <div key={winner} className="flex flex-col gap-1">
            <button
              onClick={() => record(winner, false, opening)}
              className={`rounded-xl border px-4 py-3 text-base font-black shadow-md transition-transform hover:scale-[1.02] ${m.card}`}
              title={`${m.label} won it in play — a full win`}
            >
              <span className="mr-1.5">{m.emoji}</span>
              {m.label}
              <span className={`ml-2 text-xs font-bold ${m.sub}`}>1 point</span>
            </button>
            <button
              onClick={() => record(winner, true, opening)}
              className="rounded-lg border border-amber-900/25 px-3 py-1.5 text-xs font-bold text-amber-900/80 transition-colors hover:border-orange-500 hover:text-orange-700"
              title={`${m.label} took it on penalties — half a win, per the house rule`}
            >
              penalties · ½
            </button>
          </div>
        );
      })}
    </div>
  );

  const streak = pair ? consecutiveMatches(log, pair[0]) : 0;

  return (
    <div className="space-y-3 rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-amber-950">📋 Matches</h3>
        {log.length > 0 && (
          <span className="text-xs text-amber-900/60">
            {log.length} played
          </span>
        )}
      </div>

      {/* Recording comes before the list of what's already been recorded. The
          list only grows, so anything under it drifts further down the page as
          the night goes on — and the thing being pushed away is the one part
          anybody touches, roughly every ten minutes, usually standing up. What
          has already happened can be scrolled to; what happens next cannot. */}
      {pair === null ? (
        <div className="space-y-2">
          <p className="text-sm text-amber-900/70">
            Who kicks off? This is the only pairing anyone picks — after it, the winner stays on
            and the resting team comes in.
          </p>
          {/* Two pickers rather than a button per possible pairing: three teams
              make three pairings, but the shape "these two play" is what the
              organiser is actually thinking, and it does not grow. Whichever
              team is chosen first drops out of the second list, so the two can
              never name the same side. */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={openA} onChange={(e) => pickA(e.target.value as TeamColor | '')} className={SELECT} aria-label="First team">
              <option value="">Pick a team…</option>
              {TEAM_COLORS.map((c) => (
                <option key={c} value={c}>
                  {TEAM_META[c].emoji} {TEAM_META[c].label}
                </option>
              ))}
            </select>
            <span className="text-sm font-bold text-amber-900/50">v</span>
            <select
              value={openB}
              onChange={(e) => setOpenB(e.target.value as TeamColor | '')}
              disabled={openA === ''}
              className={`${SELECT} disabled:opacity-40`}
              aria-label="Second team"
            >
              <option value="">Pick a team…</option>
              {TEAM_COLORS.filter((c) => c !== openA).map((c) => (
                <option key={c} value={c}>
                  {TEAM_META[c].emoji} {TEAM_META[c].label}
                </option>
              ))}
            </select>
            {openA !== '' && openB !== '' && (
              <span className="text-xs text-amber-900/50">
                <Chip color={restingTeam(openA, openB)} /> rests
              </span>
            )}
          </div>
          {openA !== '' && openB !== '' && <Outcome a={openA} b={openB} opening={[openA, openB]} />}
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
          {/* Organiser only — see `canUndo`. Everyone at the pitch can record
              a result; only the person who owns the night can take one back. */}
          {canUndo && (
            <button
              onClick={() => onChange(log.slice(0, -1))}
              className="text-xs font-semibold text-amber-900/60 underline underline-offset-2 hover:text-orange-700"
            >
              Undo last match
            </button>
          )}
        </div>
      )}

      {log.length > 0 && (
        <ol className="space-y-1 border-t border-amber-900/10 pt-3 text-sm">
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
    </div>
  );
}
