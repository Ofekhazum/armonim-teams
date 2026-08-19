import { useEffect, useMemo, useState } from 'react';
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
import { buildWrapped, periodLabel, wrappedPeriods } from '../wrapped';
import { shareWrappedImage } from '../wrappedImage';
import { MIN_TRUST_NIGHTS, trustCorrelation, trustPoints, type TrustPoint } from '../trust';
import { mvpCounts } from '../mvp';
import { TEAM_META, Name, fmtRating } from './ui';

interface Props {
  history: FixtureRecord[];
  players: Player[];
  isAdmin: boolean;
  onApplyRating: (playerId: string, rating: number) => void;
  onDeleteFixture: (fixtureId: string) => void;
  onEditFixture: (fixtureId: string, patch: { wins: TeamWins; date: string }) => void;
}

// Predicted-vs-actual balance, one dot per recorded night — see src/trust.ts
// for what the two axes mean and why no chart library is pulled in for one
// scatter plot.
function TrustChart({ points }: { points: TrustPoint[] }) {
  const W = 320;
  const H = 190;
  const PAD_L = 30;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 22;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const maxX = Math.max(0.5, ...points.map((p) => p.predictedGap)) * 1.1;
  const x = (v: number) => PAD_L + (v / maxX) * plotW;
  const y = (v: number) => PAD_T + plotH - v * plotH;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-md"
      role="img"
      aria-label="Predicted rating gap versus actual win-share gap, one dot per recorded night"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <line
          key={v}
          x1={PAD_L}
          x2={W - PAD_R}
          y1={y(v)}
          y2={y(v)}
          stroke="rgba(120,53,15,0.10)"
          strokeWidth={1}
        />
      ))}
      <line
        x1={PAD_L}
        x2={PAD_L}
        y1={PAD_T}
        y2={H - PAD_B}
        stroke="rgba(120,53,15,0.35)"
        strokeWidth={1}
      />
      <line
        x1={PAD_L}
        x2={W - PAD_R}
        y1={H - PAD_B}
        y2={H - PAD_B}
        stroke="rgba(120,53,15,0.35)"
        strokeWidth={1}
      />
      {[0, 0.5, 1].map((v) => (
        <text key={v} x={PAD_L - 5} y={y(v) + 3} textAnchor="end" fontSize={8} fill="rgba(120,53,15,0.55)">
          {v * 100}%
        </text>
      ))}
      {points.map((p) => (
        <circle
          key={p.fixtureId}
          cx={x(p.predictedGap)}
          cy={y(p.actualGap)}
          r={4.5}
          fill="rgba(234,88,12,0.6)"
          stroke="#ea580c"
          strokeWidth={1}
        >
          <title>
            {`${p.date} — predicted gap ${p.predictedGap.toFixed(2)}★, actual gap ${(p.actualGap * 100).toFixed(0)}%`}
          </title>
        </circle>
      ))}
      <text
        x={(PAD_L + (W - PAD_R)) / 2}
        y={H - 4}
        textAnchor="middle"
        fontSize={8}
        fill="rgba(120,53,15,0.55)"
      >
        predicted rating gap (★) →
      </text>
    </svg>
  );
}

interface Draft {
  wins: DraftTeamWins;
  date: string;
}

type SortKey = 'name' | 'nights' | 'wins' | 'mvps' | 'perNight' | 'vsRating';

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Player' },
  { key: 'nights', label: 'Nights' },
  { key: 'wins', label: 'Wins' },
  { key: 'mvps', label: 'MVPs' },
  { key: 'perNight', label: 'Per night' },
  { key: 'vsRating', label: 'vs rating' },
];

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
  const periods = useMemo(() => wrappedPeriods(history), [history]);
  const [wrappedPeriod, setWrappedPeriod] = useState('');
  const [sharingWrapped, setSharingWrapped] = useState(false);
  // periods only appear once a month's first night is saved — pick the newest
  // as soon as one shows up, rather than leaving the picker on nothing
  useEffect(() => {
    if (!wrappedPeriod && periods.length > 0) setWrappedPeriod(periods[0]);
  }, [periods, wrappedPeriod]);
  const trust = useMemo(() => trustPoints(history), [history]);
  const correlation = useMemo(() => trustCorrelation(trust), [trust]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // the night currently being corrected, and the values as typed so far
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // collapsed by default — a season's worth of nights is a wall of rows nobody
  // wants on landing in the tab, and the standings above already summarise them
  const [nightsExpanded, setNightsExpanded] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'perNight',
    dir: 'desc',
  });

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
  const mvpById = new Map(mvpCounts(history).map((m) => [m.id, m.count]));
  const recordedNights = history.filter((fx) => hasResult(fx.wins)).length;

  // clicking the same header flips direction; a new column starts in whatever
  // direction is useful first — biggest-first for numbers, A→Z for the name
  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );

  const sortedStandings = [...standings].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    switch (sort.key) {
      case 'name':
        return dir * a.name.localeCompare(b.name);
      case 'nights':
        return dir * (a.nights - b.nights);
      case 'wins':
        return dir * (a.wins - b.wins);
      case 'mvps':
        return dir * ((mvpById.get(a.id) ?? 0) - (mvpById.get(b.id) ?? 0));
      case 'perNight':
        return dir * (a.perNight - b.perNight);
      case 'vsRating':
        return dir * ((formById.get(a.id)?.delta ?? 0) - (formById.get(b.id)?.delta ?? 0));
    }
  });

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

      {periods.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-3 shadow-sm">
          <span className="text-sm font-bold text-amber-950">📊 Monthly recap</span>
          <select
            value={wrappedPeriod}
            onChange={(e) => setWrappedPeriod(e.target.value)}
            className="rounded-lg border border-amber-900/25 bg-white px-2 py-1.5 text-sm font-semibold text-amber-950 outline-none focus:border-orange-500"
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </select>
          <button
            onClick={async () => {
              if (!wrappedPeriod) return;
              setSharingWrapped(true);
              await shareWrappedImage(buildWrapped(history, wrappedPeriod));
              setSharingWrapped(false);
            }}
            disabled={sharingWrapped || !wrappedPeriod}
            className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-bold text-amber-50 shadow-sm transition-transform enabled:hover:scale-105 disabled:opacity-40"
          >
            {sharingWrapped ? '…' : '🖼️ Share recap'}
          </button>
        </div>
      )}

      {isAdmin && trust.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
          <h3 className="font-bold text-amber-950">⚖️ Balancer trust</h3>
          <p className="text-xs text-amber-900/60">
            Does "balanced by rating" actually mean "close on the pitch"? Each dot is one
            recorded night: further right means the ratings predicted a bigger gap between the
            strongest and weakest team that night; further up means the result actually was
            more lopsided.
          </p>
          <TrustChart points={trust} />
          <p className="text-xs text-amber-900/60">
            {correlation == null
              ? `Needs ${MIN_TRUST_NIGHTS} recorded nights before a correlation means anything — ${trust.length} so far.`
              : correlation > 0.3
                ? `Predicted and actual gaps track together (r = ${correlation.toFixed(2)}) — the rating gap is a real signal for how close a night turns out.`
                : correlation < -0.1
                  ? `Predicted and actual gaps move in opposite directions (r = ${correlation.toFixed(2)}) — worth a second look at the balancer's weights.`
                  : `Predicted and actual gaps barely track (r = ${correlation.toFixed(2)}) — at this match length, results may just be noisier than the rating gap can predict.`}
          </p>
        </div>
      )}

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
          half. MVPs is the one column here that isn't derived from a result — it's just a tally
          of the organiser's own pick for standout player, night by night. "vs rating" is a
          different measure, not a rescaling of per-night: it accounts for the strength of who
          they played <i>with</i> and <i>against</i> each night, so it can rank someone above a
          teammate with a higher per-night number if that teammate's wins came from stronger
          sides. Blank until a player has {MIN_NIGHTS} nights behind them, and greyed until
          there's enough of a pattern to read anything into it.
        </p>
        <table className="w-full min-w-[26rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-amber-900/50">
              {SORT_COLUMNS.map(({ key, label }) => (
                <th key={key} className={`pb-1 font-bold ${key === 'name' ? '' : 'text-right'}`}>
                  <button
                    onClick={() => toggleSort(key)}
                    aria-sort={
                      sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                    className={`inline-flex items-center gap-0.5 hover:text-amber-900 ${
                      key !== 'name' ? 'flex-row-reverse' : ''
                    } ${sort.key === key ? 'text-amber-900' : ''}`}
                  >
                    {label}
                    <span className="w-3 text-[9px]">
                      {sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedStandings.map((s) => {
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
                    {mvpById.get(s.id) ? `🌟 ${mvpById.get(s.id)}` : '—'}
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
        <button
          onClick={() => setNightsExpanded((v) => !v)}
          aria-expanded={nightsExpanded}
          className="flex items-center gap-2 font-bold text-amber-950"
        >
          📅 Past nights
          <span className="text-sm font-normal text-amber-900/50">({history.length})</span>
          <span className="text-xs text-amber-900/40">{nightsExpanded ? '▲ hide' : '▼ show'}</span>
        </button>
        {/* newest first by date, not by when it happened to be saved — a night
            filed late, or one whose date was corrected, still sorts correctly */}
        {nightsExpanded &&
          [...history]
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
            .map((fx) => {
          const open = openId === fx.id;
          const nameOf = (id: string) => fx.players.find((p) => p.id === id)?.name ?? '?';
          // a night can genuinely end level, so take everyone on the top score
          // rather than whoever a sort happened to put first
          const top = Math.max(...TEAM_COLORS.map((c) => fx.wins[c] ?? 0));
          const winners = TEAM_COLORS.filter((c) => (fx.wins[c] ?? 0) === top);
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
                  <span className="flex items-center gap-1 text-xs font-bold">
                    🏆
                    {winners.length > 1 && (
                      <span className="text-amber-900/60">tied</span>
                    )}
                    {winners.map((c) => (
                      // the team's own card palette rather than a tinted text
                      // colour: white-on-cream would be unreadable, and these
                      // three combinations are already contrast-checked because
                      // the teams board uses them
                      <span
                        key={c}
                        className={`rounded-full border px-2 py-0.5 ${TEAM_META[c].card}`}
                      >
                        {TEAM_META[c].label}
                      </span>
                    ))}
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
