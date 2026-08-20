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
  // unlocks admin right here rather than sending the organiser to the Roster
  // tab and back. Omitted where there's nowhere to unlock from (no REMOTE_URL).
  onUnlockAdmin?: () => void;
  unlocking?: boolean;
  // The night was logged match by match (§2.18), so these numbers were counted
  // rather than typed. Shown, not editable: a tally you can edit alongside a
  // log that disagrees with it is two records, and one of them is wrong.
  fromLog?: boolean;
}

// Nothing entered yet.
export const emptyWins = (): DraftTeamWins => ({ black: null, white: null, blue: null });

// The night's tally: how many matches each team won. Deliberately lives on the
// host's Match Day page rather than inside TeamsBoard, so a live-room guest —
// who renders that same board — never sees it and can't file a night into
// someone else's history.
export default function ResultsPanel({
  wins,
  onChange,
  onSave,
  saved,
  isAdmin,
  onUnlockAdmin,
  unlocking,
  fromLog = false,
}: Props) {
  // half-steps are meaningful (a shootout is worth half a win); anything finer
  // is a typo, so snap to the nearest half
  const clamp = (n: number) => Math.max(0, Math.min(99, Math.round(n * 2) / 2));

  const set = (c: TeamColor, raw: string) => {
    if (raw === '') return onChange({ ...wins, [c]: null });
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    onChange({ ...wins, [c]: clamp(n) });
  };

  // −/+ in half-win steps, so the common entry needs no keyboard at all —
  // typing "2.5" on a phone means switching to the numeric pad for the decimal
  const bump = (c: TeamColor, by: number) =>
    onChange({ ...wins, [c]: clamp((wins[c] ?? 0) + by) });

  const entered = TEAM_COLORS.filter((c) => wins[c] != null);
  const total = entered.reduce((n, c) => n + (wins[c] ?? 0), 0);
  const canSave = isAdmin && entered.length > 0 && total > 0;

  return (
    <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <div
        className={`flex flex-wrap items-center justify-between gap-2 ${fromLog ? 'mb-3' : 'mb-1'}`}
      >
        <h3 className="font-bold text-amber-950">🏁 Tonight's results</h3>
        {isAdmin ? (
          <button
            onClick={onSave}
            disabled={!canSave}
            className="rounded-xl bg-orange-600 px-4 py-1.5 text-sm font-bold text-amber-50 shadow-sm transition-transform enabled:hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saved ? '✓ Saved — update' : '💾 Save to history'}
          </button>
        ) : onUnlockAdmin ? (
          <button
            onClick={onUnlockAdmin}
            disabled={unlocking}
            className="rounded-xl border border-amber-900/30 px-4 py-1.5 text-sm font-bold text-amber-900 hover:border-orange-500 disabled:opacity-50"
          >
            {unlocking ? 'Checking…' : '🔒 Unlock admin to save'}
          </button>
        ) : (
          <span className="text-xs text-amber-900/40">
            🔒 Unlock admin on the Roster tab to save
          </span>
        )}
      </div>
      {/* A logged night explains itself — the matches are listed directly above
          and the boxes are read-only, so the note only repeated what the screen
          already showed. Typed-in nights still need the half-win rule spelling
          out, because nothing on screen says it. */}
      {!fromLog && (
        <p className="mb-3 text-xs text-amber-900/60">
          How many matches each team won. Won it on penalties? That's half a win — tap <b>+</b>{' '}
          twice, or type <b>0.5</b> directly. Saving shares the result with everyone, the same as
          publishing the roster.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        {TEAM_COLORS.map((c) => {
          const step = 'grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-amber-900/25 bg-white text-lg font-black text-amber-900 enabled:hover:border-orange-500 disabled:opacity-30';
          return (
            <div
              key={c}
              className="flex items-center gap-2 rounded-xl border border-amber-900/10 bg-white/60 px-3 py-2.5"
            >
              <span className="min-w-0 flex-1 truncate font-bold text-amber-950">
                {TEAM_META[c].emoji} {TEAM_META[c].label}
              </span>
              <button
                onClick={() => bump(c, -0.5)}
                disabled={fromLog || (wins[c] ?? 0) <= 0}
                aria-label={`Half a win fewer for ${TEAM_META[c].label}`}
                className={step}
              >
                −
              </button>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={99}
                step={0.5}
                value={wins[c] ?? ''}
                onChange={(e) => set(c, e.target.value)}
                readOnly={fromLog}
                placeholder="–"
                aria-label={`Matches won by ${TEAM_META[c].label}`}
                className={`w-14 rounded-lg border border-amber-900/25 px-1 py-1 text-center text-lg font-bold text-amber-950 ${
                  fromLog ? 'bg-amber-900/[0.04]' : 'bg-white'
                }`}
              />
              <button
                onClick={() => bump(c, 0.5)}
                disabled={fromLog || (wins[c] ?? 0) >= 99}
                aria-label={`Half a win more for ${TEAM_META[c].label}`}
                className={step}
              >
                +
              </button>
            </div>
          );
        })}
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
