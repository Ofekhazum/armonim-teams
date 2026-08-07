import { useMemo, useState } from 'react';
import type { FixtureRecord, Player } from '../types';
import { playerForm, playerStandings, suggestRatings, winShare } from '../calibration';
import { TEAM_META, Name, fmtRating } from './ui';

interface Props {
  history: FixtureRecord[];
  players: Player[];
  isAdmin: boolean;
  onApplyRating: (playerId: string, rating: number) => void;
  onDeleteFixture: (fixtureId: string) => void;
}

const fmtWins = (w: number) => (Number.isInteger(w) ? String(w) : w.toFixed(1));

export default function History({
  history,
  players,
  isAdmin,
  onApplyRating,
  onDeleteFixture,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const standings = useMemo(() => playerStandings(history), [history]);
  const form = useMemo(() => playerForm(history, players), [history, players]);
  const suggestions = useMemo(
    () => suggestRatings(history, players).filter((s) => !dismissed.has(s.id)),
    [history, players, dismissed],
  );

  const formById = new Map(form.map((f) => [f.id, f]));
  const recorded = history.reduce(
    (n, fx) => n + fx.matches.filter((m) => winShare(m)).length,
    0,
  );

  if (history.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-6 text-center shadow-sm">
        <p className="text-lg font-bold text-amber-950">No nights recorded yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-amber-900/60">
          Generate teams on Match day, type in the scores under 🏁 Tonight's results, and
          save. Standings and rating suggestions build up from there.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm text-amber-900/60">
        <span className="text-base font-bold text-amber-950">
          {history.length} night{history.length === 1 ? '' : 's'}
        </span>
        <span>{recorded} matches recorded</span>
      </div>

      {isAdmin && suggestions.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-orange-600/40 bg-orange-500/10 p-4 shadow-sm">
          <h3 className="font-bold text-amber-950">📈 Rating suggestions</h3>
          <p className="text-xs text-amber-900/60">
            Drawn from results, controlling for who each player lined up with and against.
            These are prompts, not verdicts — accept the ones that match what you've seen.
          </p>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-900/10 bg-white/70 px-3 py-2.5 text-sm"
              >
                <Name className="font-bold text-amber-950">{s.name}</Name>
                <span className="font-semibold text-amber-900">
                  {fmtRating(s.current)} → {fmtRating(s.suggested)}
                  <span className="ml-1">{s.direction === 'up' ? '⬆️' : '⬇️'}</span>
                </span>
                <span className="text-xs text-amber-900/55">
                  {s.played} matches · {fmtWins(s.wins)}W {s.draws}D {s.losses}L ·{' '}
                  {s.confidence} evidence
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => onApplyRating(s.id, s.suggested)}
                  className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-bold text-amber-50 hover:scale-105"
                >
                  Apply
                </button>
                <button
                  onClick={() => setDismissed((d) => new Set(d).add(s.id))}
                  className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
        <h3 className="mb-1 font-bold text-amber-950">🏆 Standings</h3>
        <p className="mb-3 text-xs text-amber-900/60">
          A penalty shootout counts as half a win. "vs rating" is how a player's results
          compare with what their rating predicts — it needs a lot of football before it
          means much, so treat small numbers as noise.
        </p>
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-amber-900/50">
              <th className="pb-1 font-bold">Player</th>
              <th className="pb-1 text-right font-bold">P</th>
              <th className="pb-1 text-right font-bold">W</th>
              <th className="pb-1 text-right font-bold">D</th>
              <th className="pb-1 text-right font-bold">L</th>
              <th className="pb-1 text-right font-bold">Win %</th>
              <th className="pb-1 text-right font-bold">vs rating</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => {
              const f = formById.get(s.id);
              const d = f?.delta ?? 0;
              const meaningful = Math.abs(f?.z ?? 0) >= 1.5;
              return (
                <tr key={s.id} className="border-t border-amber-900/10">
                  <td className="py-1.5">
                    <Name className="font-semibold text-amber-950">{s.name}</Name>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-amber-900/70">{s.played}</td>
                  <td className="py-1.5 text-right font-bold tabular-nums text-amber-950">
                    {fmtWins(s.wins)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-amber-900/70">{s.draws}</td>
                  <td className="py-1.5 text-right tabular-nums text-amber-900/70">{s.losses}</td>
                  <td className="py-1.5 text-right tabular-nums text-amber-900/70">
                    {((s.wins / (s.played || 1)) * 100).toFixed(0)}%
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
                      meaningful
                        ? 'Consistently over/under-performing their rating'
                        : 'Not enough evidence to read anything into this yet'
                    }
                  >
                    {d >= 0 ? '+' : ''}
                    {d.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <h3 className="font-bold text-amber-950">📅 Past nights</h3>
        {[...history].reverse().map((fx) => {
          const open = openId === fx.id;
          const nameOf = (id: string) => fx.players.find((p) => p.id === id)?.name ?? '?';
          return (
            <div
              key={fx.id}
              className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 shadow-sm"
            >
              <button
                onClick={() => setOpenId(open ? null : fx.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="font-bold text-amber-950">{fx.date}</span>
                <span className="text-xs text-amber-900/55">
                  {fx.matches.filter((m) => winShare(m)).length} matches ·{' '}
                  {fx.players.length} players
                </span>
                <div className="flex-1" />
                <span className="text-amber-900/40">{open ? '▲' : '▼'}</span>
              </button>

              {open && (
                <div className="space-y-3 border-t border-amber-900/10 px-4 py-3">
                  <ul className="space-y-1 text-sm">
                    {fx.matches.map((m, i) => {
                      const share = winShare(m);
                      return (
                        <li key={i} className="text-amber-900">
                          {TEAM_META[m.a].emoji} {m.scoreA ?? '–'} – {m.scoreB ?? '–'}{' '}
                          {TEAM_META[m.b].emoji}
                          {m.penaltyWinner && (
                            <span className="ml-2 text-xs text-orange-700">
                              {TEAM_META[m.penaltyWinner].label} on penalties (½)
                            </span>
                          )}
                          {!share && <span className="ml-2 text-xs text-amber-900/40">not played</span>}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(['black', 'white', 'blue'] as const).map((c) => (
                      <div key={c} className="text-xs">
                        <div className="font-bold text-amber-950">
                          {TEAM_META[c].emoji} {TEAM_META[c].label}
                        </div>
                        <div className="text-amber-900/60">
                          {fx.teams[c].map((id) => nameOf(id)).join(', ') || '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => {
                        if (confirm(`Delete the night of ${fx.date} from history?`)) {
                          onDeleteFixture(fx.id);
                        }
                      }}
                      className="rounded-lg border border-red-500/50 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                    >
                      Delete this night
                    </button>
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
