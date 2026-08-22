import { useEffect, useMemo, useState } from 'react';
import type {
  DraftTeamWins,
  FixtureRecord,
  MatchLogEntry,
  Player,
  TeamColor,
  TeamWins,
} from '../types';
import { TEAM_COLORS } from '../balancer';
import {
  MIN_NIGHTS,
  hasResult,
  playerForm,
  playerStandings,
  suggestRatings,
  totalWins,
} from '../calibration';
import { nightStory } from '../nightStory';
import { buildWrapped, periodLabel, wrappedPeriods } from '../wrapped';
import { announceMonth } from '../awards';
import { shareWrappedImage } from '../wrappedImage';
import { mvpCandidates, mvpCounts, winningTeams } from '../mvp';
import { VETERAN_NIGHTS, playerAchievements, type AchievementKind } from '../achievements';
import { Name, TEAM_META, fmtRating, fmtWins } from './ui';
import MvpPicker from './MvpPicker';
import NightPage from './NightPage';

interface Props {
  history: FixtureRecord[];
  players: Player[];
  isAdmin: boolean;
  // Present only for an organiser. Handed through to the night page, which
  // needs the word rather than the flag: the recap it writes is a guarded
  // write on the worker, not a locally hidden button.
  adminWord?: string | null;
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


/**
 * A night's shape as a fingerprint: one bar per *run*, widths in proportion,
 * no numbers and no losers.
 *
 * Sharing the row's width is right here and wrong on the night page (§2.22)
 * for the same reason — nothing on this one is meant to be read. A wide bar is
 * a team that would not come off; a row of thin ones is an evening nobody
 * could hold. It is `aria-hidden` because the counts beside it already say in
 * words everything a screen reader could get from it.
 */
function MiniRibbon({ log }: { log: MatchLogEntry[] }) {
  const runs: { team: TeamColor; length: number }[] = [];
  for (const m of log) {
    const last = runs[runs.length - 1];
    if (last && last.team === m.winner) last.length++;
    else runs.push({ team: m.winner, length: 1 });
  }
  return (
    <div className="flex h-2.5 w-full gap-1" aria-hidden>
      {runs.map((r, i) => (
        <span
          key={i}
          style={{ flexGrow: r.length }}
          className={`basis-0 rounded-sm ${TEAM_META[r.team].tile}`}
        />
      ))}
    </div>
  );
}

// Top three, and nothing louder than a tinted disc behind the position. Medal
// emoji were tried and are wrong here: the table already carries per-player
// badges (🥇 most wins, 🌟 most MVPs) that mean specific things, and a second
// gold circle beside them competing for the same glance is how a key becomes
// necessary — which is the thing the player page's medal key was deleted for.
const RANK_TINT = [
  'bg-amber-300/70 text-amber-950',
  'bg-stone-300/70 text-stone-700',
  'bg-orange-800/25 text-orange-900',
];

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
  adminWord = null,
  onApplyRating,
  onDeleteFixture,
  onEditFixture,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  // the night being read back in full, over the top of everything — same
  // overlay pattern as a player page (§2.22)
  const [storyId, setStoryId] = useState<string | null>(null);
  // Newest first by date, not by when a night happened to be saved — one filed
  // late, or one whose date was corrected, still sorts where it belongs. The
  // same order the list is drawn in, so stepping through the overlay walks the
  // rows in the order they are on screen.
  const nights = useMemo(
    () => [...history].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [history],
  );
  const at = storyId === null ? -1 : nights.findIndex((fx) => fx.id === storyId);
  const story = at >= 0 ? nights[at] : null;
  const periods = useMemo(() => wrappedPeriods(history), [history]);
  const [wrappedPeriod, setWrappedPeriod] = useState('');
  const [sharingWrapped, setSharingWrapped] = useState(false);
  const [registering, setRegistering] = useState<'busy' | 'done' | 'failed' | null>(null);
  // periods only appear once a month's first night is saved — pick the newest
  // as soon as one shows up, rather than leaving the picker on nothing
  useEffect(() => {
    if (!wrappedPeriod && periods.length > 0) setWrappedPeriod(periods[0]);
  }, [periods, wrappedPeriod]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // the night currently being corrected, and the values as typed so far
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
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
          Generate teams on Match day, log the matches as they're won, and file the night with
          🗂️ Save to history when you end it. Standings and rating suggestions build from there.
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
            onChange={(e) => {
              setWrappedPeriod(e.target.value);
              setRegistering(null);
            }}
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
          {/* Registering the month by hand (§2.25). The cron on the 1st is the
              usual registrar and this is not a second way of doing the same
              job — it is the two cases the cron cannot cover: seeding the
              archive, which should not have to wait a month for its first
              entry, and correcting a month the automatic pick got wrong.
              Since the cron never overwrites, whatever is set here stays. */}
          <button
            onClick={async () => {
              if (!wrappedPeriod || !adminWord) return;
              setRegistering('busy');
              const ok = await announceMonth(wrappedPeriod, adminWord);
              setRegistering(ok ? 'done' : 'failed');
            }}
            disabled={registering === 'busy' || !wrappedPeriod || !adminWord}
            title="Write this month's five down. Normally the 1st of the month does this by itself."
            className="rounded-lg border border-amber-900/25 px-3 py-1.5 text-xs font-bold text-amber-900 transition-colors enabled:hover:border-orange-500 disabled:opacity-40"
          >
            {registering === 'busy' ? '…' : '👕 Register team'}
          </button>
          {registering === 'done' && (
            <span className="text-xs font-bold text-green-700">registered</span>
          )}
          {registering === 'failed' && (
            <span className="text-xs font-bold text-red-700">couldn't register that month</span>
          )}
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

      {/* Opaque rather than the usual `/70`, because the name column is sticky:
          a translucent cell lets the rows it is holding still scroll visibly
          underneath it, which reads as a rendering fault. */}
      <div className="overflow-hidden rounded-2xl border border-amber-900/15 bg-[#fffdf4] shadow-sm">
        <div className="px-4 pt-4">
          <h3 className="mb-1 font-bold text-amber-950">🏆 Standings</h3>
          {isAdmin && (
            <p className="mb-2 text-xs text-amber-900/60">
              <b>vs rating</b> accounts for who they played with and against, so it can rank someone
              above a teammate on a higher per-night number. Blank under {MIN_NIGHTS} nights.
            </p>
          )}
        </div>
        {/* Seven columns will not fit a phone and never did. What changed is
            that the name no longer scrolls away with them: pin it, and reading
            a number sideways still tells you whose it is. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-amber-900/50">
                {columns.map(({ key, label }) => (
                  <th
                    key={key}
                    className={`border-b border-amber-900/15 bg-[#fffdf4] pb-1.5 font-bold ${
                      key === 'name' ? 'sticky left-0 z-10 pl-4 pr-3' : 'px-3 text-right'
                    }`}
                  >
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
              {sortedStandings.map((s, i) => {
                // Position in whatever order is on screen, which is the only
                // thing a rank can honestly mean on a sortable table. The
                // top-three tint comes off entirely under an A→Z sort, where a
                // gold disc on row one would be claiming something about a
                // name beginning with aleph.
                const podium = sortKey !== 'name' && sort.dir === 'desc' ? RANK_TINT[i] : undefined;
                const stripe = i % 2 === 1 ? 'bg-[#f8f3e4]' : 'bg-[#fffdf4]';
                const f = formById.get(s.id);
              const d = f?.delta ?? 0;
              // below the suggestion floor there is nothing worth reading, so
              // show nothing at all rather than a number that invites reading
                const rated = s.nights >= MIN_NIGHTS;
                const meaningful = rated && Math.abs(f?.z ?? 0) >= 1.5;
                const cell = `border-t border-amber-900/10 px-3 py-2 text-right tabular-nums ${stripe}`;
                return (
                  <tr key={s.id}>
                    <td
                      className={`sticky left-0 z-10 border-t border-amber-900/10 py-2 pl-4 pr-3 ${stripe}`}
                    >
                      <div className="flex flex-wrap items-center gap-x-1.5">
                        <span
                          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black tabular-nums ${
                            podium ?? 'text-amber-900/35'
                          }`}
                        >
                          {i + 1}
                        </span>
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
                    <td className={`${cell} text-amber-900/70`}>{s.nights}</td>
                    <td className={`${cell} font-bold text-amber-950`}>{fmtWins(s.wins)}</td>
                    <td
                      className={`${cell} text-amber-900/70`}
                      title="Whole nights this player's team finished top of"
                    >
                      {fixturesWon(s.id) || '—'}
                    </td>
                    <td className={`${cell} text-amber-900/70`}>{s.perNight.toFixed(2)}</td>
                    <td className={`${cell} text-amber-900/70`}>
                      {mvpById.get(s.id) ? `🌟 ${mvpById.get(s.id)}` : '—'}
                    </td>
                    {isAdmin && (
                      <td
                        className={`${cell} pr-4 ${
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
        </div>

        {/* A badge nobody can decode is decoration. Only the kinds actually
            earned are listed, so the key stays short and every line on it
            points at someone in the table above. */}
        {earnedBadges.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-amber-900/10 px-4 py-2 text-[11px] text-amber-900/55">
            {earnedBadges.map(({ icon, text }) => (
              <span key={icon}>
                {icon} {text}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h3 className="font-bold text-amber-950">📅 Past nights</h3>
          <span className="text-sm text-amber-900/50">({history.length})</span>
        </div>
        {nights.map((fx) => {
          const drawer = openId === fx.id;
          // a night written down match by match, rather than tallied from
          // memory at the end — the record is the matches, and the wins are
          // just their sum (§2.18)
          const logged = (fx.matchLog?.length ?? 0) > 0;
          const summary = logged ? nightStory(fx) : null;
          const nameOf = (id: string) => fx.players.find((p) => p.id === id)?.name ?? '?';
          // a night can genuinely end level, so take everyone on the top score
          // rather than whoever a sort happened to put first
          const top = Math.max(...TEAM_COLORS.map((c) => fx.wins[c] ?? 0));
          const winners = TEAM_COLORS.filter((c) => (fx.wins[c] ?? 0) === top);
          const mvpName = fx.mvpId ? nameOf(fx.mvpId) : null;
          return (
            <div
              key={fx.id}
              className="overflow-hidden rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 shadow-sm transition-shadow hover:shadow-md"
            >
              {/* The whole card is the way through to the night. This was an
                  accordion whose payload was three team sheets and a row of
                  admin buttons, with "Read the night" a small button two taps
                  in — the right shape back when there was no night page to go
                  to, and the wrong one the moment there was. The team sheets
                  are not lost: they are on the page this opens, next to the
                  ribbon and the report, which is where somebody looking them
                  up actually wants to be. */}
              <div className="relative">
                <button
                  onClick={() => setStoryId(fx.id)}
                  aria-label={`Read the night of ${fx.date}`}
                  className="absolute inset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500"
                />
                {/* scenery: clicks fall through to the button above, so there
                    is no dead patch anywhere on the card */}
                <div className="pointer-events-none relative space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-sm font-bold text-amber-950">{fx.date}</span>
                    {hasResult(fx.wins) ? (
                      <span className="flex flex-wrap items-center gap-1 text-xs font-bold">
                        👑
                        {winners.length > 1 && <span className="text-amber-900/60">tied</span>}
                        {winners.map((c) => (
                          // the team's own card palette rather than a tinted
                          // text colour: white-on-cream would be unreadable,
                          // and these three are already contrast-checked
                          <span
                            key={c}
                            className={`rounded-full border px-2 py-0.5 ${TEAM_META[c].card}`}
                          >
                            {TEAM_META[c].label} {fmtWins(fx.wins[c] ?? 0)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-900/40">no result recorded</span>
                    )}
                  </div>

                  {/* The hook, and the reason the list is worth scrolling: the
                      same headline the night page opens with, so a card and
                      the page behind it never tell two different stories. */}
                  {summary && (
                    <div className="text-lg font-black leading-tight text-amber-950">
                      {summary.headline}
                    </div>
                  )}

                  {logged && <MiniRibbon log={fx.matchLog!} />}

                  <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-amber-900/50">
                    <span>
                      {logged
                        ? `${fx.matchLog!.length} matches`
                        : `${totalWins(fx.wins)} wins, tallied at the end`}
                    </span>
                    <span>·</span>
                    <span>{fx.players.length} played</span>
                    {mvpName && mvpName !== '?' && (
                      <>
                        <span>·</span>
                        <span>
                          🌟 <Name className="font-semibold text-amber-900/70">{mvpName}</Name>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Correcting a night is an organiser action and a rare one,
                    so it is a corner of the card rather than a row across the
                    bottom of every one of them. Nothing here for anyone else:
                    a locked device sees a clean card instead of a padlock
                    repeated down the whole season. */}
                {isAdmin && (
                  <button
                    onClick={() => {
                      setOpenId(drawer ? null : fx.id);
                      if (drawer) cancelEdit();
                    }}
                    aria-expanded={drawer}
                    aria-label={`Organiser actions for the night of ${fx.date}`}
                    className={`absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full text-lg leading-none hover:bg-amber-900/10 hover:text-amber-900 ${
                      drawer ? 'bg-amber-900/10 text-amber-900' : 'text-amber-900/35'
                    }`}
                  >
                    ⋯
                  </button>
                )}
              </div>

              {drawer && isAdmin && (
                <div className="space-y-3 border-t border-amber-900/10 bg-amber-900/[0.03] px-4 py-3">
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
                </div>
              )}
            </div>
          );
        })}
      </div>

      {story && (
        <NightPage
          fixture={story}
          history={history}
          players={players}
          adminWord={adminWord}
          // newest first, so the next entry along is the older night
          older={nights[at + 1] ?? null}
          newer={nights[at - 1] ?? null}
          onGo={setStoryId}
          onClose={() => setStoryId(null)}
        />
      )}
    </div>
  );
}
