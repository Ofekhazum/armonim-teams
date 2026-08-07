import type { MatchResult, TeamColor, Teams } from '../types';
import { MATCH_PAIRINGS } from '../balancer';
import { TEAM_META } from './ui';

interface Props {
  teams: Teams;
  results: MatchResult[];
  onChange: (results: MatchResult[]) => void;
  onSave: () => void;
  saved: boolean;
}

// Blank sheet for the night: the three pairings, no scores yet.
export const emptyResults = (): MatchResult[] =>
  MATCH_PAIRINGS.map(({ a, b }) => ({ a, b, scoreA: null, scoreB: null, penaltyWinner: null }));

// Scores as entered for tonight's three matches. Deliberately lives on the
// host's Match Day page rather than inside TeamsBoard, so a live-room guest —
// who renders the same board — never sees it and can't file a night into
// someone else's history.
export default function ResultsPanel({ teams, results, onChange, onSave, saved }: Props) {
  const rows = results.length === MATCH_PAIRINGS.length ? results : emptyResults();

  const setScore = (i: number, side: 'scoreA' | 'scoreB', raw: string) => {
    const v = raw === '' ? null : Math.max(0, Math.min(99, Math.floor(Number(raw))));
    const next = rows.map((r, j) =>
      j === i ? { ...r, [side]: Number.isFinite(v as number) ? v : null } : r,
    );
    // a score change can un-level a match — drop a now-meaningless shootout
    const row = next[i];
    if (row.scoreA !== row.scoreB) row.penaltyWinner = null;
    onChange(next);
  };

  const setPenalty = (i: number, winner: TeamColor | null) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, penaltyWinner: winner } : r)));

  const anyScore = rows.some((r) => r.scoreA != null && r.scoreB != null);

  return (
    <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-amber-950">🏁 Tonight's results</h3>
        <button
          onClick={onSave}
          disabled={!anyScore}
          className="rounded-xl bg-orange-600 px-4 py-1.5 text-sm font-bold text-amber-50 shadow-sm transition-transform enabled:hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saved ? '✓ Saved — update' : '💾 Save to history'}
        </button>
      </div>
      <p className="mb-3 text-xs text-amber-900/60">
        Leave a match blank if it wasn't played. A level match goes to penalties — tap the
        winner, and it counts as half a win.
      </p>

      <ul className="space-y-2">
        {rows.map((r, i) => {
          const level = r.scoreA != null && r.scoreB != null && r.scoreA === r.scoreB;
          const resting = MATCH_PAIRINGS[i].resting;
          return (
            <li
              key={`${r.a}-${r.b}`}
              className="rounded-xl border border-amber-900/10 bg-white/60 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                <span className="font-bold text-amber-950">
                  {TEAM_META[r.a].emoji} {TEAM_META[r.a].label}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={99}
                  value={r.scoreA ?? ''}
                  onChange={(e) => setScore(i, 'scoreA', e.target.value)}
                  aria-label={`${TEAM_META[r.a].label} score`}
                  className="w-14 rounded-lg border border-amber-900/25 bg-white px-2 py-1 text-center font-bold text-amber-950"
                />
                <span className="text-amber-900/40">–</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={99}
                  value={r.scoreB ?? ''}
                  onChange={(e) => setScore(i, 'scoreB', e.target.value)}
                  aria-label={`${TEAM_META[r.b].label} score`}
                  className="w-14 rounded-lg border border-amber-900/25 bg-white px-2 py-1 text-center font-bold text-amber-950"
                />
                <span className="font-bold text-amber-950">
                  {TEAM_META[r.b].emoji} {TEAM_META[r.b].label}
                </span>
                <span className="text-xs text-amber-900/45">
                  ({TEAM_META[resting].label} rests · {teams[resting].length})
                </span>
              </div>

              {level && (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
                  <span className="font-semibold text-amber-900/70">Penalties won by:</span>
                  {[r.a, r.b].map((c) => (
                    <button
                      key={c}
                      onClick={() => setPenalty(i, r.penaltyWinner === c ? null : c)}
                      aria-pressed={r.penaltyWinner === c}
                      className={`rounded-full border px-3 py-1 font-bold transition-colors ${
                        r.penaltyWinner === c
                          ? 'border-orange-600 bg-orange-600 text-amber-50'
                          : 'border-amber-900/25 text-amber-900 hover:border-orange-500'
                      }`}
                    >
                      {TEAM_META[c].emoji} {TEAM_META[c].label}
                    </button>
                  ))}
                  {r.penaltyWinner && (
                    <span className="text-amber-900/50">— counts as ½ a win</span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
