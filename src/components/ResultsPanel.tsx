import type { DraftTeamWins, TeamColor } from '../types';
import { TEAM_COLORS } from '../balancer';
import { TEAM_META } from './ui';

interface Props {
  wins: DraftTeamWins;
  onChange: (wins: DraftTeamWins) => void;
  onSave: () => void;
  saved: boolean;
  // saving now publishes to everyone's history, not just this device, so it
  // needs the same admin word as any other organiser action
  isAdmin: boolean;
}

// Nothing entered yet.
export const emptyWins = (): DraftTeamWins => ({ black: null, white: null, blue: null });

// The night's tally: how many matches each team won. Deliberately lives on the
// host's Match Day page rather than inside TeamsBoard, so a live-room guest —
// who renders that same board — never sees it and can't file a night into
// someone else's history.
export default function ResultsPanel({ wins, onChange, onSave, saved, isAdmin }: Props) {
  const set = (c: TeamColor, raw: string) => {
    if (raw === '') return onChange({ ...wins, [c]: null });
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    // half-steps are meaningful (a shootout is worth half a win); anything
    // finer is a typo, so snap to the nearest half
    onChange({ ...wins, [c]: Math.min(99, Math.round(n * 2) / 2) });
  };

  const entered = TEAM_COLORS.filter((c) => wins[c] != null);
  const total = entered.reduce((n, c) => n + (wins[c] ?? 0), 0);
  const canSave = isAdmin && entered.length > 0 && total > 0;

  return (
    <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-amber-950">🏁 Tonight's results</h3>
        {isAdmin ? (
          <button
            onClick={onSave}
            disabled={!canSave}
            className="rounded-xl bg-orange-600 px-4 py-1.5 text-sm font-bold text-amber-50 shadow-sm transition-transform enabled:hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saved ? '✓ Saved — update' : '💾 Save to history'}
          </button>
        ) : (
          <span className="text-xs text-amber-900/40">
            🔒 Unlock admin on the Roster tab to save
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-amber-900/60">
        How many matches each team won. Won it on penalties? That's half a win — type{' '}
        <b>0.5</b>, <b>1.5</b>, and so on. Saving shares the result with everyone, the same as
        publishing the roster.
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        {TEAM_COLORS.map((c) => (
          <label
            key={c}
            className="flex items-center gap-3 rounded-xl border border-amber-900/10 bg-white/60 px-3 py-2.5"
          >
            <span className="flex-1 font-bold text-amber-950">
              {TEAM_META[c].emoji} {TEAM_META[c].label}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={99}
              step={0.5}
              value={wins[c] ?? ''}
              onChange={(e) => set(c, e.target.value)}
              placeholder="–"
              aria-label={`Matches won by ${TEAM_META[c].label}`}
              className="w-20 rounded-lg border border-amber-900/25 bg-white px-2 py-1 text-center text-lg font-bold text-amber-950"
            />
          </label>
        ))}
      </div>

      {canSave && (
        <p className="mt-2 text-xs text-amber-900/50">
          {total} {total === 1 ? 'win' : 'wins'} recorded tonight
          {entered.length < TEAM_COLORS.length && ' — the blank teams count as none'}.
        </p>
      )}
    </div>
  );
}
