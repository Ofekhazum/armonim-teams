import { useMemo, useState } from 'react';
import type { DraftTeamWins, FixtureRecord, Player, TeamColor, TeamWins } from '../types';
import { TEAM_COLORS } from '../balancer';
import {
  MIN_NIGHTS,
  hasResult,
  playerForm,
  playerStandings,
  suggestRatings,
  totalWins,
} from '../calibration';
import { TEAM_META, Name, fmtRating } from './ui';

interface Props {
  history: FixtureRecord[];
  players: Player[];
  isAdmin: boolean;
  onApplyRating: (playerId: string, rating: number) => void;
  onDeleteFixture: (fixtureId: string) => void;
  onEditFixture: (fixtureId: string, patch: { wins: TeamWins; date: string }) => void;
}

interface Draft {
  wins: DraftTeamWins;
  date: string;
}

const fmtWins = (w: number) => (Number.isInteger(w) ? String(w) : w.toFixed(1));

export default function History({
  history,
  players,
  isAdmin,
  onApplyRating,
  onDeleteFixture,
  onEditFixture,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // the night currently being corrected, and the values as typed so far
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const startEdit = (fx: FixtureRecord) => {
    setEditId(fx.id);
    setDraft({ wins: { ...fx.wins }, date: fx.date });
  };

  const cancelEdit = () => {
    setEditId(null);
    setDraft(null);
  };

  const commitEdit = (id: string) => {
    if (!draft) return;
    onEditFixture(id, {
      // a team left blank simply didn't win any, same as on Match Day
      wins: {
        black: draft.wins.black ?? 0,
        white: draft.wins.white ?? 0,
        blue: draft.wins.blue ?? 0,
      },
      date: draft.date,
    });
    cancelEdit();
  };

  const setDraftWin = (c: TeamColor, raw: string) => {
    setDraft((d) => {
      if (!d) return d;
      if (raw === '') return { ...d, wins: { ...d.wins, [c]: null } };
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return d;
      // half-steps are meaningful (a shootout is half a win); snap anything finer
      return { ...d, wins: { ...d.wins, [c]: Math.min(99, Math.round(n * 2) / 2) } };
    });
  };

  const standings = useMemo(() => playerStandings(history), [history]);
  const form = useMemo(() => playerForm(history, players), [history, players]);
  const suggestions = useMemo(
    () => suggestRatings(history, players).filter((s) => !dismissed.has(s.id)),
    [history, players, dismissed],
  );

  const formById = new Map(form.map((f) => [f.id, f]));
  const recordedNights = history.filter((fx) => hasResult(fx.wins)).length;

  if (history.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-6 text-center shadow-sm">
        <p className="text-lg font-bold text-amber-950">No nights recorded yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-amber-900/60">
          Generate teams on Match day, tally up how many matches each team won under 🏁
          Tonight's results, and save. Standings and rating suggestions build from there.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm text-amber-900/60">
        <span className="text-base font-bold text-amber-950">
          {recordedNights} night{recordedNights === 1 ? '' : 's'} recorded
        </span>
        {history.length !== recordedNights && (
          <span>{history.length - recordedNights} saved with no result</span>
        )}
      </div>

      {isAdmin && suggestions.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-orange-600/40 bg-orange-500/10 p-4 shadow-sm">
          <h3 className="font-bold text-amber-950">📈 Rating suggestions</h3>
          <p className="text-xs text-amber-900/60">
            Based on how each player's teams do against what their rating predicts, allowing
            for who they lined up with. Early ones rest on a handful of nights — treat those
            as a nudge to look, not a verdict.
          </p>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li
                key={s.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 text-sm ${
                  s.atLimit
                    ? 'border-amber-900/10 bg-amber-900/[0.04]'
                    : 'border-amber-900/10 bg-white/70'
                }`}
              >
                <Name className="font-bold text-amber-950">{s.name}</Name>
                {s.atLimit ? (
                  <span className="font-semibold text-amber-900">
                    {s.direction === 'up' ? '⭐' : '⚓'} stays at {fmtRating(s.current)}
                  </span>
                ) : (
                  <span className="font-semibold text-amber-900">
                    {fmtRating(s.current)} → {fmtRating(s.suggested)}
                    <span className="ml-1">{s.direction === 'up' ? '⬆️' : '⬇️'}</span>
                  </span>
                )}
                <span className="text-xs text-amber-900/55">
                  {s.nights} night{s.nights === 1 ? '' : 's'} · {fmtWins(s.wins)} wins
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    s.confidence === 'strong'
                      ? 'bg-green-600/15 text-green-800'
                      : s.confidence === 'solid'
                        ? 'bg-amber-500/25 text-amber-900'
                        : 'bg-amber-900/10 text-amber-900/70'
                  }`}
                  title={
                    s.confidence === 'building'
                      ? 'Early — could still be luck'
                      : 'The pattern has held up over more football'
                  }
                >
                  {s.confidence === 'building' ? 'early' : s.confidence}
                </span>
                <div className="flex-1" />
                {/* nothing to apply when the scale has run out — only the note */}
                {!s.atLimit && (
                  <button
                    onClick={() => onApplyRating(s.id, s.suggested)}
                    className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-bold text-amber-50 hover:scale-105"
                  >
                    Apply
                  </button>
                )}
                <button
                  onClick={() => setDismissed((d) => new Set(d).add(s.id))}
                  className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                >
                  Dismiss
                </button>
                {s.atLimit && (
                  <p className="w-full text-xs text-amber-900/60">
                    {s.direction === 'up'
                      ? `Already at ${fmtRating(s.current)}★ — the scale stops here, but the results say they're further ahead than a ${fmtRating(s.current)} can show. Teams built around them are stronger than the numbers admit, so nudge the rest of the roster down if this keeps up.`
                      : `Already at ${fmtRating(s.current)}★ — the scale stops here, but the results say they're further behind than a ${fmtRating(s.current)} can show. Teams carrying them are weaker than the numbers admit.`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
        <h3 className="mb-1 font-bold text-amber-950">🏆 Standings</h3>
        <p className="mb-3 text-xs text-amber-900/60">
          Wins a player's team collected while they were on it — a penalty shootout counts as
          half. "vs rating" is how that compares with what their rating predicts: blank until a
          player has {MIN_NIGHTS} nights behind them, and greyed until there's enough of a
          pattern to read anything into it.
        </p>
        <table className="w-full min-w-[26rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-amber-900/50">
              <th className="pb-1 font-bold">Player</th>
              <th className="pb-1 text-right font-bold">Nights</th>
              <th className="pb-1 text-right font-bold">Wins</th>
              <th className="pb-1 text-right font-bold">Per night</th>
              <th className="pb-1 text-right font-bold">vs rating</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => {
              const f = formById.get(s.id);
              const d = f?.delta ?? 0;
              // below the suggestion floor there is nothing worth reading, so
              // show nothing at all rather than a number that invites reading
              const rated = s.nights >= MIN_NIGHTS;
              const meaningful = rated && Math.abs(f?.z ?? 0) >= 1.5;
              return (
                <tr key={s.id} className="border-t border-amber-900/10">
                  <td className="py-1.5">
                    <Name className="font-semibold text-amber-950">{s.name}</Name>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-amber-900/70">{s.nights}</td>
                  <td className="py-1.5 text-right font-bold tabular-nums text-amber-950">
                    {fmtWins(s.wins)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-amber-900/70">
                    {s.perNight.toFixed(2)}
                  </td>
                  <td
                    className={`py-1.5 text-right tabular-nums ${
                      !meaningful
                        ? 'text-amber-900/30'
                        : d > 0
                          ? 'font-semibold text-green-700'
                          : 'font-semibold text-red-700'
                    }`}
                    title={
                      !rated
                        ? `Needs ${MIN_NIGHTS} nights before this means anything`
                        : meaningful
                          ? 'Consistently over/under-performing their rating'
                          : 'Not enough evidence to read anything into this yet'
                    }
                  >
                    {rated ? `${d >= 0 ? '+' : ''}${d.toFixed(2)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <h3 className="font-bold text-amber-950">📅 Past nights</h3>
        {/* newest first by date, not by when it happened to be saved — a night
            filed late, or one whose date was corrected, still sorts correctly */}
        {[...history]
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
          .map((fx) => {
          const open = openId === fx.id;
          const nameOf = (id: string) => fx.players.find((p) => p.id === id)?.name ?? '?';
          const winner = [...TEAM_COLORS].sort((a, b) => (fx.wins[b] ?? 0) - (fx.wins[a] ?? 0))[0];
          return (
            <div
              key={fx.id}
              className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 shadow-sm"
            >
              <button
                onClick={() => setOpenId(open ? null : fx.id)}
                aria-expanded={open}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left"
              >
                <span className="font-bold text-amber-950">{fx.date}</span>
                {hasResult(fx.wins) ? (
                  <span className="text-sm text-amber-900/70">
                    {TEAM_COLORS.map((c) => `${TEAM_META[c].emoji} ${fmtWins(fx.wins[c] ?? 0)}`).join('  ')}
                  </span>
                ) : (
                  <span className="text-xs text-amber-900/40">no result recorded</span>
                )}
                {hasResult(fx.wins) && (
                  <span className="text-xs font-bold text-orange-700">
                    🏆 {TEAM_META[winner].label}
                  </span>
                )}
                <div className="flex-1" />
                <span className="text-amber-900/40">{open ? '▲' : '▼'}</span>
              </button>

              {open && (
                <div className="space-y-3 border-t border-amber-900/10 px-4 py-3">
                  {editId === fx.id && draft ? (
                    <>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {TEAM_COLORS.map((c) => (
                          <label
                            key={c}
                            className="flex items-center gap-2 rounded-xl border border-amber-900/10 bg-white/70 px-3 py-2"
                          >
                            <span className="flex-1 text-sm font-bold text-amber-950">
                              {TEAM_META[c].emoji} {TEAM_META[c].label}
                            </span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              max={99}
                              step={0.5}
                              value={draft.wins[c] ?? ''}
                              onChange={(e) => setDraftWin(c, e.target.value)}
                              placeholder="–"
                              aria-label={`Matches won by ${TEAM_META[c].label}`}
                              className="w-20 rounded-lg border border-amber-900/25 bg-white px-2 py-1 text-center font-bold text-amber-950"
                            />
                          </label>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 text-xs text-amber-900/70">
                        Date
                        <input
                          type="date"
                          value={draft.date}
                          onChange={(e) =>
                            setDraft((d) => (d ? { ...d, date: e.target.value } : d))
                          }
                          className="rounded-lg border border-amber-900/25 bg-white px-2 py-1 font-semibold text-amber-950"
                        />
                      </label>
                      <p className="text-xs text-amber-900/50">
                        Half a win means it was taken on penalties. The team sheet can't be
                        changed — delete the night and save it again if the teams were wrong.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => commitEdit(fx.id)}
                          className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-bold text-amber-50 hover:scale-105"
                        >
                          Save changes
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {TEAM_COLORS.map((c) => (
                          <div key={c} className="text-xs">
                            <div className="font-bold text-amber-950">
                              {TEAM_META[c].emoji} {TEAM_META[c].label} —{' '}
                              {fmtWins(fx.wins[c] ?? 0)} win{(fx.wins[c] ?? 0) === 1 ? '' : 's'}
                            </div>
                            <div className="text-amber-900/60">
                              {fx.teams[c].map((id) => nameOf(id)).join(', ') || '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-amber-900/45">
                        {totalWins(fx.wins)} wins across the night · {fx.players.length} players
                      </p>
                      {/* correcting the record is an organiser action, same as
                          editing ratings — so it sits behind admin mode */}
                      {isAdmin && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => startEdit(fx)}
                            className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                          >
                            ✏️ Edit result
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Delete the night of ${fx.date} from history?`)) {
                                onDeleteFixture(fx.id);
                              }
                            }}
                            className="rounded-lg border border-red-500/50 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                          >
                            🗑️ Delete this night
                          </button>
                        </div>
                      )}
                      {!isAdmin && (
                        // otherwise the absence of any control reads as a bug
                        // rather than as a deliberate lock
                        <p className="text-xs text-amber-900/40">
                          🔒 Unlock admin on the Roster tab to correct or delete a night.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
