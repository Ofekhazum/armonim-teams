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
import { mvpCandidates, mvpCounts, winningTeams } from '../mvp';
import { VETERAN_NIGHTS, playerAchievements, type AchievementKind } from '../achievements';
import { TEAM_META, Name, fmtRating } from './ui';
import MvpPicker from './MvpPicker';

interface Props {
  history: FixtureRecord[];
  players: Player[];
  isAdmin: boolean;
  onApplyRating: (playerId: string, rating: number) => void;
  onDeleteFixture: (fixtureId: string) => void;
  onEditFixture: (
    fixtureId: string,
    patch: { wins: TeamWins; date: string; mvpId?: string },
  ) => void;
}

interface Draft {
  wins: DraftTeamWins;
  date: string;
  mvpId: string | null;
}

type SortKey = 'name' | 'nights' | 'wins' | 'fixtures' | 'mvps' | 'perNight' | 'vsRating';

// "vs rating" is the one column that is an opinion about a player rather than
// a count of what happened — it says someone is over- or under-performing the
// number the organiser gave them. That's a working note for whoever maintains
// the ratings, not something to publish next to everyone's name, so the whole
// column only exists in admin mode (§2.14).
const sortColumns = (isAdmin: boolean): { key: SortKey; label: string }[] => [
  { key: 'name', label: 'Player' },
  { key: 'nights', label: 'Nights' },
  { key: 'wins', label: 'Wins' },
  { key: 'fixtures', label: 'Fixtures' },
  { key: 'perNight', label: 'Per night' },
  { key: 'mvps', label: 'MVPs' },
  ...(isAdmin ? [{ key: 'vsRating' as SortKey, label: 'vs rating' }] : []),
];

const fmtWins = (w: number) => (Number.isInteger(w) ? String(w) : w.toFixed(1));

// Nights before a player appears in the standings at all. Deliberately low —
// this is about keeping one-night entries out of a career table, not about
// statistical confidence, which `MIN_NIGHTS` handles separately for the
// "vs rating" column.
const MIN_STANDINGS_NIGHTS = 2;

// The key under the standings. Deliberately worded as what was counted rather
// than what it proves — "most wins in the club" and not "best player" — which
// is the same line the milestones and duo records hold (§2.9).
const BADGE_KEY: { kind: AchievementKind; icon: string; text: string }[] = [
  { kind: 'most-wins', icon: '🥇', text: 'most wins' },
  { kind: 'most-fixtures', icon: '🏅', text: 'most nights won' },
  { kind: 'mvp', icon: '🌟', text: 'most MVP picks' },
  { kind: 'shootouts', icon: '🎯', text: 'most shootouts won' },
  { kind: 'iron-man', icon: '🦾', text: 'never misses' },
  { kind: 'win-streak', icon: '📈', text: 'longest winning run' },
  { kind: 'active-run', icon: '🔥', text: 'on a run right now' },
  { kind: 'ever-present', icon: '✨', text: 'played every night' },
  { kind: 'veteran', icon: '🎖️', text: `${VETERAN_NIGHTS}+ nights` },
];

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
    setDraft({ wins: { ...fx.wins }, date: fx.date, mvpId: fx.mvpId ?? null });
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
      // always present, even as undefined — the edit form is how a wrong
      // pick gets *cleared*, and if this key were simply omitted for "no
      // pick" the patch spread in App.tsx would leave the old id in place
      // instead of clearing it
      mvpId: draft.mvpId ?? undefined,
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

  // A one-off — a guest who came once, a player's first night — has a per-night
  // number computed from a single result, which sits at the top of the table
  // saying nothing. Two nights is not a sample either, but it is the point at
  // which a row is about a person rather than about an evening.
  const standings = useMemo(
    () => playerStandings(history).filter((p) => p.nights >= MIN_STANDINGS_NIGHTS),
    [history],
  );
  const form = useMemo(() => playerForm(history, players), [history, players]);
  const suggestions = useMemo(
    () => suggestRatings(history, players).filter((s) => !dismissed.has(s.id)),
    [history, players, dismissed],
  );

  const formById = new Map(form.map((f) => [f.id, f]));
  const mvpById = new Map(mvpCounts(history).map((m) => [m.id, m.count]));
  const achievements = useMemo(() => playerAchievements(history), [history]);
  const fixturesWon = (id: string) => achievements.get(id)?.fixturesWon ?? 0;
  const recordedNights = history.filter((fx) => hasResult(fx.wins)).length;
  const columns = sortColumns(isAdmin);
  const earnedBadges = BADGE_KEY.filter(({ kind }) =>
    [...achievements.values()].some((a) => a.achievements.some((x) => x.kind === kind)),
  );
  // leaving admin while sorted by the admin-only column would sort the table
  // by something no longer on screen
  const sortKey: SortKey = !isAdmin && sort.key === 'vsRating' ? 'perNight' : sort.key;

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
    switch (sortKey) {
      case 'name':
        return dir * a.name.localeCompare(b.name);
      case 'nights':
        return dir * (a.nights - b.nights);
      case 'wins':
        return dir * (a.wins - b.wins);
      case 'fixtures':
        return dir * (fixturesWon(a.id) - fixturesWon(b.id));
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

      {/* The recap is a produced thing — a shareable image the organiser sends
          out when a month is done, complete with the banter records. Leaving
          the generator on everyone's screen turns it from a monthly moment
          into a button, so it lives in admin mode (§2.14). */}
      {isAdmin && periods.length > 0 && (
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
              // shirt numbers live on the roster, never in a fixture record —
              // the Team of the Month card wants them
              await shareWrappedImage(
                buildWrapped(history, wrappedPeriod),
                new Map(players.map((p) => [p.id, p.number])),
              );
              setSharingWrapped(false);
            }}
            disabled={sharingWrapped || !wrappedPeriod}
            className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-bold text-amber-50 shadow-sm transition-transform enabled:hover:scale-105 disabled:opacity-40"
          >
            {sharingWrapped ? '…' : '🖼️ Share recap'}
          </button>
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
        {isAdmin && (
          <p className="mb-3 text-xs text-amber-900/60">
            <b>vs rating</b> accounts for who they played with and against, so it can rank someone
            above a teammate on a higher per-night number. Blank under {MIN_NIGHTS} nights.
          </p>
        )}
        <table className="w-full min-w-[26rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-amber-900/50">
              {columns.map(({ key, label }) => (
                <th key={key} className={`pb-1 font-bold ${key === 'name' ? '' : 'text-right'}`}>
                  <button
                    onClick={() => toggleSort(key)}
                    aria-sort={
                      sortKey === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                    className={`inline-flex items-center gap-0.5 hover:text-amber-900 ${
                      key !== 'name' ? 'flex-row-reverse' : ''
                    } ${sortKey === key ? 'text-amber-900' : ''}`}
                  >
                    {label}
                    <span className="w-3 text-[9px]">
                      {sortKey === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
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
                    <div className="flex flex-wrap items-center gap-x-1.5">
                      <Name className="font-semibold text-amber-950">{s.name}</Name>
                      {/* every badge is a count with a sentence behind it —
                          hover (or long-press) gives the sentence */}
                      {(achievements.get(s.id)?.achievements ?? []).map((a) => (
                        <span key={a.kind} title={a.label} className="text-xs leading-none">
                          {a.icon}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-amber-900/70">{s.nights}</td>
                  <td className="py-1.5 text-right font-bold tabular-nums text-amber-950">
                    {fmtWins(s.wins)}
                  </td>
                  <td
                    className="py-1.5 text-right tabular-nums text-amber-900/70"
                    title="Whole nights this player's team finished top of"
                  >
                    {fixturesWon(s.id) || '—'}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-amber-900/70">
                    {s.perNight.toFixed(2)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-amber-900/70">
                    {mvpById.get(s.id) ? `🌟 ${mvpById.get(s.id)}` : '—'}
                  </td>
                  {isAdmin && (
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
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* A badge nobody can decode is decoration. Only the kinds actually
            earned are listed, so the key stays short and every line on it
            points at someone in the table above. */}
        {earnedBadges.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-amber-900/10 pt-2 text-[11px] text-amber-900/55">
            {earnedBadges.map(({ icon, text }) => (
              <span key={icon}>
                {icon} {text}
              </span>
            ))}
          </div>
        )}
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
          // a night written down match by match, rather than tallied from
          // memory at the end — the record is the matches, and the wins are
          // just their sum (§2.18)
          const logged = (fx.matchLog?.length ?? 0) > 0;
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
                            {/* A logged night counts itself, so its tally is
                                read-only here. Typing over it would leave the
                                record saying one thing and the matches it is
                                made of saying another — and the matches are
                                what head-to-head and everything else per-match
                                gets counted from. */}
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              max={99}
                              step={0.5}
                              value={draft.wins[c] ?? ''}
                              onChange={(e) => setDraftWin(c, e.target.value)}
                              readOnly={logged}
                              placeholder="–"
                              aria-label={`Matches won by ${TEAM_META[c].label}`}
                              className={`w-20 rounded-lg border border-amber-900/25 px-2 py-1 text-center font-bold text-amber-950 ${
                                logged ? 'bg-amber-900/[0.06]' : 'bg-white'
                              }`}
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
                      {/* the only place the MVP is picked — the fixture page
                          asks nothing about it, because the night isn't over
                          while you're on that page. The list is the winning
                          side only; see mvpCandidates. */}
                      <MvpPicker
                        players={mvpCandidates(fx, draft.wins)}
                        winners={winningTeams(draft.wins)}
                        mvpId={draft.mvpId}
                        onChange={(mvpId) => setDraft((d) => (d ? { ...d, mvpId } : d))}
                      />
                      <p className="text-xs text-amber-900/50">
                        {logged
                          ? 'This night was logged match by match, so its wins are counted from the matches and can’t be typed over. '
                          : 'Half a win means it was taken on penalties. '}
                        The team sheet can't be changed — delete the night and save it again if the
                        teams were wrong.
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
                      {/* The matches themselves are *not* listed here. Eighteen
                          rows of "Blue beat White" is a wall to scroll past on
                          the way to anything else, and nobody re-reads a night
                          match by match. The count is the part worth showing —
                          it says the log is on file without being the file. */}
                      <p className="text-xs text-amber-900/45">
                        {logged ? `${fx.matchLog!.length} matches logged · ` : ''}
                        {totalWins(fx.wins)} wins across the night · {fx.players.length} players
                        {fx.mvpId && nameOf(fx.mvpId) !== '?' && (
                          <>
                            {' '}
                            · 🌟 MVP: <Name className="font-semibold text-amber-900/70">{nameOf(fx.mvpId)}</Name>
                          </>
                        )}
                      </p>
                      {/* correcting the record is an organiser action, same as
                          editing ratings — so it sits behind admin mode */}
                      {isAdmin && (
                        <div className="flex flex-wrap gap-2">
                          {/* Same drawer as Edit result, named after the thing
                              that's missing. Since the fixture page stopped
                              asking, nothing else would ever mention that this
                              night has no MVP — and a prompt nobody sees is a
                              feature that quietly stops happening. */}
                          {!fx.mvpId && (
                            <button
                              onClick={() => startEdit(fx)}
                              className="rounded-lg border border-amber-500/60 bg-amber-100/60 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                            >
                              🌟 Pick MVP
                            </button>
                          )}
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
