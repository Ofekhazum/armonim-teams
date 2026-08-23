import { useEffect, useMemo, useRef, useState } from 'react';
import type { DraftTeamWins, FixtureRecord, Player, TeamColor, TeamWins } from '../types';
import { NOTE_MAX } from '../types';
import { TEAM_COLORS } from '../balancer';
import {
  MIN_NIGHTS,
  hasResult,
  playerForm,
  playerStandings,
  suggestRatings,
} from '../calibration';
import { nightStory } from '../nightStory';
import { buildWrapped, periodLabel, wrappedPeriods } from '../wrapped';
import { announceMonth, clearMonth, fetchAwards, type Awards } from '../awards';
import { shareWrappedImage } from '../wrappedImage';
import { mvpCandidates, mvpCounts, winningTeams } from '../mvp';
import { getNightsShelfOpen, setNightsShelfOpen } from '../storage';
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
    patch: { wins: TeamWins; date: string; mvpId?: string; note?: string },
  ) => void;
}

interface Draft {
  wins: DraftTeamWins;
  date: string;
  mvpId: string | null;
  note: string;
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

// How far the pointer has to travel before it counts as a drag rather than a
// click. Below this, a hand that moves two pixels while pressing a card still
// opens that night.
const DRAG_SLOP = 6;

/**
 * Drag the shelf with a mouse.
 *
 * Only with a *mouse*: touch already has momentum scrolling and a native feel,
 * and taking that over would make it worse. A mouse is the case with nothing
 * left — there is no scrollbar under the strip any more, and a trackpad's
 * sideways gesture is not something every mouse has.
 */
function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ down: false, moved: false, startX: 0, startLeft: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current;
    // Cleared for *every* pointer, not just the mouse: a stale `moved` left
    // over from a drag is a swallowed tap on the touch that follows it.
    drag.current = { down: false, moved: false, startX: 0, startLeft: 0 };
    if (!el || e.pointerType !== 'mouse' || e.button !== 0) return;
    drag.current = { down: true, moved: false, startX: e.clientX, startLeft: el.scrollLeft };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!drag.current.down || !el) return;
    const dx = e.clientX - drag.current.startX;
    if (!drag.current.moved) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      drag.current.moved = true;
      // Captured here, and NOT on pointerdown. Capturing at the start
      // retargets the whole gesture to this container, so the click ending an
      // ordinary press fires on the strip instead of on the card under it —
      // which is exactly how the cards stopped opening. Capture once the drag
      // is real, and an ordinary click is never touched; a drag still gets
      // the thing capture is for, which is a button released off the edge
      // still ending the drag instead of leaving the shelf glued to the mouse.
      el.setPointerCapture(e.pointerId);
    }
    el.scrollLeft = drag.current.startLeft - dx;
  };

  const onPointerUp = () => {
    drag.current.down = false;
  };

  // A drag that finishes over a card would otherwise open that night: the
  // pointer went down on it and came up on it, which is a click by every
  // definition the browser has. Caught on the way down, before the card's own
  // handler runs, and cleared as it is spent — one drag swallows one click.
  const onClickCapture = (e: React.MouseEvent) => {
    if (!drag.current.moved) return;
    drag.current.moved = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onClickCapture,
  };
}

// Nights before a player appears in the table at all.
//
// One, which is to say no floor: everybody who has played is in. This was two,
// on the reasoning that a per-night number from a single result sorts to the
// top of the table and means nothing — true, but the wrong trade. The table is
// a record of who has played, and a guest who came once and never came back is
// part of that record; leaving them out means the tab quietly disagrees with
// the night pages they appear on. The per-night oddity is the price, and it is
// visible rather than hidden.
//
// Kept as a constant rather than deleted so the floor is one edit away, and so
// this reasoning has somewhere to live.
const MIN_STANDINGS_NIGHTS = 1;

// The key under the table. Deliberately worded as what was counted rather
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
  const shelf = useDragScroll();
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
  // What has been registered, and which month is mid-write. Read once when an
  // organiser opens the tab — an award is a record rather than a calculation,
  // so the only way to know is to ask (§2.25).
  const [awards, setAwards] = useState<Awards>({});
  const [busyMonth, setBusyMonth] = useState<string | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    fetchAwards().then((a) => live && setAwards(a));
    return () => {
      live = false;
    };
  }, [isAdmin]);

  // Re-read rather than patch the copy in state. One extra request, and it is
  // the difference between the panel showing what is stored and the panel
  // showing what we believe we stored.
  const afterWrite = async (ok: boolean) => {
    if (ok) setAwards(await fetchAwards());
    setBusyMonth(null);
  };
  // periods only appear once a month's first night is saved — pick the newest
  // as soon as one shows up, rather than leaving the picker on nothing
  useEffect(() => {
    if (!wrappedPeriod && periods.length > 0) setWrappedPeriod(periods[0]);
  }, [periods, wrappedPeriod]);
  // Open by default and remembered per device — the shelf is what the tab is
  // for, but forty cards is still forty cards on the way to the numbers, and
  // somebody who only wants the table should be able to say so once.
  const [shelfOpen, setShelfOpen] = useState(getNightsShelfOpen);
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
    setDraft({ wins: { ...fx.wins }, date: fx.date, mvpId: fx.mvpId ?? null, note: fx.note ?? '' });
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
      // Emptying the box is how a note is deleted — see the comment above for
      // why this key is always present rather than omitted when there is none.
      note: draft.note.trim() || undefined,
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

  // Everybody who has played a night with a result recorded — see
  // MIN_STANDINGS_NIGHTS for why there is no floor on this any more.
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
  // the night whose organiser drawer is open under the strip, if any
  const editing = openId ? (nights.find((fx) => fx.id === openId) ?? null) : null;
  const editingLogged = (editing?.matchLog?.length ?? 0) > 0;
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
          🗂️ Save to history when you end it. The career numbers and rating suggestions build
          from there.
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

      {/* Team of the Month (§2.25). The cron on the 1st is the usual registrar
          and this panel is not a second way of doing its job — it covers the
          two cases the cron cannot: seeding the archive, which should not have
          to wait a month for its first entry, and correcting a month the
          automatic pick got wrong. Since the cron never overwrites, whatever
          is set here stays set — and removing a month hands it back, so the
          1st will register it afresh. */}
      {isAdmin && periods.length > 0 && (
        <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
          <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
            <h3 className="font-bold text-amber-950">👕 Team of the Month</h3>
            <span className="text-xs text-amber-900/45">
              registers itself on the 1st — this is for seeding and corrections
            </span>
          </div>
          <div className="divide-y divide-amber-900/10">
            {periods.map((period) => {
              const award = awards[period];
              const busy = busyMonth === period;
              // The month still being played. Registering it is allowed on
              // purpose — it is the only way to see what the shelf looks like
              // without waiting for the 1st — but it is worth saying out loud
              // that the number will move until the month is over.
              const running = period >= new Date().toISOString().slice(0, 7);
              return (
                <div key={period} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                  <span className="w-28 shrink-0 text-sm font-bold text-amber-950">
                    {periodLabel(period)}
                  </span>
                  <div className="min-w-[10rem] flex-1 text-xs">
                    {award ? (
                      <>
                        <span className="text-amber-900/70">{award.names.join(', ')}</span>
                        <span className="text-amber-900/35">
                          {' '}
                          · registered {new Date(award.at).toLocaleDateString()}
                        </span>
                      </>
                    ) : (
                      <span className="text-amber-900/35">
                        not registered{running ? ' · still being played' : ''}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      if (!adminWord) return;
                      // Registering a month still being played is the way to
                      // try this out without waiting for the 1st — but the
                      // cron never overwrites, so a half-month team would sit
                      // there for good. Said once, here, rather than
                      // discovered in October.
                      if (
                        running &&
                        !confirm(
                          `${periodLabel(period)} isn't over. You'll get the team as it stands ` +
                            `today, and the 1st won't replace it — remove it when you're done ` +
                            `testing and it'll register itself properly. Go ahead?`,
                        )
                      ) {
                        return;
                      }
                      setBusyMonth(period);
                      await afterWrite(await announceMonth(period, adminWord));
                    }}
                    disabled={busy}
                    title={
                      award
                        ? 'Score this month again and overwrite what is stored'
                        : 'Write this month’s five down now'
                    }
                    className="rounded-lg border border-amber-900/25 px-2.5 py-1 text-xs font-bold text-amber-900 transition-colors enabled:hover:border-orange-500 disabled:opacity-40"
                  >
                    {busy ? '…' : award ? 'Re-register' : 'Register'}
                  </button>
                  {award && (
                    <button
                      onClick={async () => {
                        if (!adminWord) return;
                        if (!confirm(`Remove the Team of the Month for ${periodLabel(period)}?`)) {
                          return;
                        }
                        setBusyMonth(period);
                        await afterWrite(await clearMonth(period, adminWord));
                      }}
                      disabled={busy}
                      title="Forget it. The 1st will register this month again if it is over."
                      className="rounded-lg border border-red-500/40 px-2.5 py-1 text-xs font-bold text-red-700 transition-colors enabled:hover:bg-red-50 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
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

      {/* Above the numbers, because this is what the tab is *for* now — the
          table is reference, a night is a story. And sideways rather than
          down: a season is forty nights, and forty full-width cards is a wall
          to scroll past on the way to anything else. Same gesture as the night
          page's own ribbon, which is where the scrolling strip started. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <button
            onClick={() => {
              const next = !shelfOpen;
              setShelfOpen(next);
              setNightsShelfOpen(next);
              // a drawer belonging to a card nobody can see any more
              if (!next) {
                setOpenId(null);
                cancelEdit();
              }
            }}
            aria-expanded={shelfOpen}
            className="flex items-baseline gap-2 font-bold text-amber-950"
          >
            📅 Past nights
            <span className="text-sm font-normal text-amber-900/50">({history.length})</span>
            <span className="text-xs font-normal text-amber-900/40">
              {shelfOpen ? '▲ hide' : '▼ show'}
            </span>
          </button>
        </div>

        {shelfOpen && (
          <>

          {/* Bleeds through the page gutter so the strip scrolls edge to edge
              rather than inside a narrower window. */}
          <div
              {...shelf}
              className="no-scrollbar -mx-3 flex cursor-grab select-none gap-3 overflow-x-auto px-3 pb-1 active:cursor-grabbing sm:-mx-6 sm:px-6"
            >
            {nights.map((fx) => {
              // a night written down match by match, rather than tallied from
              // memory at the end — the record is the matches, and the wins are
              // just their sum (§2.18)
              const logged = (fx.matchLog?.length ?? 0) > 0;
              const summary = logged ? nightStory(fx) : null;
              const nameOf = (id: string) => fx.players.find((p) => p.id === id)?.name ?? '?';
              // a night can genuinely end level, so take everyone on the top
              // score rather than whoever a sort happened to put first
              const top = Math.max(...TEAM_COLORS.map((c) => fx.wins[c] ?? 0));
              const winners = TEAM_COLORS.filter((c) => (fx.wins[c] ?? 0) === top);
              const mvpName = fx.mvpId ? nameOf(fx.mvpId) : null;
              return (
                <div
                  key={fx.id}
                  className={`relative h-44 w-40 shrink-0 overflow-hidden rounded-2xl border bg-[#fffdf4]/70 shadow-sm transition-shadow hover:shadow-md ${
                    openId === fx.id ? 'border-orange-500/70' : 'border-amber-900/15'
                  }`}
                >
                  {/* The whole card is the way through to the night. What is on
                      it is a *summary* and deliberately not the evening itself:
                      the shape of it, match by match, is the first thing the
                      page behind this draws, and printing it twice at two sizes
                      made the strip a worse copy of a better view. */}
                  {/* Who won, as a band across the top. At shelf size a chip
                      is something you *read* and a band is something you see —
                      and seeing it is the point, because scanning the shelf for
                      a run of one colour is a thing the chips could not do. A
                      tie splits the band between them. */}
                  {hasResult(fx.wins) && (
                    <div className="absolute inset-x-0 top-0 flex h-1.5" aria-hidden>
                      {winners.map((c) => (
                        <span key={c} className={`flex-1 ${TEAM_META[c].tile}`} />
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => setStoryId(fx.id)}
                    aria-label={`Read the night of ${fx.date}`}
                    className="absolute inset-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500"
                  />
                  {/* scenery: clicks fall through to the button above, so there
                      is no dead patch anywhere on the card */}
                  <div className="pointer-events-none relative flex h-full flex-col p-3 pt-3.5">
                    <div className="font-mono text-[11px] font-bold text-amber-900/45">{fx.date}</div>
                    {/* the hook, and the reason the strip is worth scrolling:
                        the same headline the night page opens with */}
                    <div className="mt-0.5 line-clamp-3 flex-1 text-[15px] font-black leading-tight text-amber-950">
                      {summary?.headline ??
                        (hasResult(fx.wins) ? 'A night on the books' : 'No result recorded')}
                    </div>
                    {hasResult(fx.wins) && (
                      <div className="flex flex-wrap items-center gap-1 text-[11px] font-black">
                        <span className="text-sm leading-none">👑</span>
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
                      </div>
                    )}
                    {/* No counts. This line went from "18 matches · 15 played"
                        to "18 matches" to nothing, which is the right end of
                        that road: a card in a shelf is scanned, not read, and
                        the four things worth scanning are the date, what kind
                        of night it was, who won it and who was the best of
                        them. How many matches it took is on the page one tap
                        away, where the ribbon shows every one of them. */}
                    {/* The MVP is the one *person* on this card, and it was the
                        faintest thing on it — the same size and grey as the
                        counts that used to sit above. A star on its own tint
                        carries the name. */}
                    {mvpName && mvpName !== '?' && (
                      <div className="mt-1 flex max-w-full items-center gap-1 self-start rounded-full bg-amber-400/25 px-1.5 py-0.5 text-[11px] ring-1 ring-inset ring-amber-500/30">
                        <span className="leading-none">⭐</span>
                        <Name className="truncate font-black text-amber-900">{mvpName}</Name>
                      </div>
                    )}
                  </div>

                  {isAdmin && (
                    <button
                      onClick={() => {
                        setOpenId(openId === fx.id ? null : fx.id);
                        cancelEdit();
                      }}
                      aria-expanded={openId === fx.id}
                      aria-label={`Organiser actions for the night of ${fx.date}`}
                      className={`absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full text-base leading-none hover:bg-amber-900/10 hover:text-amber-900 ${
                        openId === fx.id ? 'bg-amber-900/10 text-amber-900' : 'text-amber-900/30'
                      }`}
                    >
                      ⋯
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* One drawer under the strip rather than one inside every card: a
              card in a sideways strip has nowhere to open downwards without
              shoving the row about, and correcting a night is rare enough that
              it does not need to be reachable without a second tap. */}
          {isAdmin && editing && (
            <div className="space-y-3 rounded-2xl border border-orange-500/40 bg-amber-100/40 p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-sm font-bold text-amber-950">{editing.date}</span>
                <span className="text-xs text-amber-900/45">organiser actions</span>
                <div className="flex-1" />
                <button
                  onClick={() => {
                    setOpenId(null);
                    cancelEdit();
                  }}
                  className="text-xs font-bold text-amber-900/50 hover:text-amber-900"
                >
                  × close
                </button>
              </div>
              {editId === editing.id && draft ? (
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
                            read-only here. Typing over it would leave the record
                            saying one thing and the matches it is made of saying
                            another — and the matches are what head-to-head and
                            everything else per-match gets counted from. */}
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={99}
                          step={0.5}
                          value={draft.wins[c] ?? ''}
                          onChange={(e) => setDraftWin(c, e.target.value)}
                          readOnly={editingLogged}
                          placeholder="–"
                          aria-label={`Matches won by ${TEAM_META[c].label}`}
                          className={`w-20 rounded-lg border border-amber-900/25 px-2 py-1 text-center font-bold text-amber-950 ${
                            editingLogged ? 'bg-amber-900/[0.06]' : 'bg-white'
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
                      onChange={(e) => setDraft((d) => (d ? { ...d, date: e.target.value } : d))}
                      className="rounded-lg border border-amber-900/25 bg-white px-2 py-1 font-semibold text-amber-950"
                    />
                  </label>
                  {/* the only place the MVP is picked — the fixture page asks
                      nothing about it, because the night isn't over while you're
                      on that page. The list is the winning side only. */}
                  <MvpPicker
                    players={mvpCandidates(editing, draft.wins)}
                    winners={winningTeams(draft.wins)}
                    mvpId={draft.mvpId}
                    onChange={(mvpId) => setDraft((d) => (d ? { ...d, mvpId } : d))}
                  />
                  {/* The organiser's note (§2.27). Written as the night was
                      filed, and editable only here, by an admin — it is never
                      rendered for anyone, including them: it exists to be
                      handed to the reporter, and a note printed on the page it
                      describes is the punchline printed above the joke.
                      Emptying the box deletes it. */}
                  <label className="block text-xs text-amber-900/70">
                    Note for the reporter
                    <textarea
                      value={draft.note}
                      onChange={(e) =>
                        setDraft((d) =>
                          d ? { ...d, note: e.target.value.slice(0, NOTE_MAX) } : d,
                        )
                      }
                      rows={2}
                      placeholder="Something the results can't say — empty to delete"
                      className="mt-1 w-full rounded-lg border border-amber-900/25 bg-white px-2 py-1.5 text-sm text-amber-950 outline-none focus:border-orange-500"
                    />
                    <span className="text-[10px] text-amber-900/35">
                      {draft.note.trim().length}/{NOTE_MAX} · never shown on any page — it only goes
                      to the reporter
                    </span>
                  </label>
                  <p className="text-xs text-amber-900/50">
                    {editingLogged
                      ? 'This night was logged match by match, so its wins are counted from the matches and can’t be typed over. '
                      : 'Half a win means it was taken on penalties. '}
                    The team sheet can't be changed — delete the night and save it again if the teams
                    were wrong.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => commitEdit(editing.id)}
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
                  {/* Same drawer as Edit result, named after the thing that's
                      missing. Since the fixture page stopped asking, nothing
                      else would ever mention that this night has no MVP — and a
                      prompt nobody sees is a feature that quietly stops
                      happening. */}
                  {!editing.mvpId && (
                    <button
                      onClick={() => startEdit(editing)}
                      className="rounded-lg border border-amber-500/60 bg-amber-100/60 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                    >
                      🌟 Pick MVP
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(editing)}
                    className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                  >
                    ✏️ Edit result
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete the night of ${editing.date} from history?`)) {
                        onDeleteFixture(editing.id);
                        setOpenId(null);
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
          </>
        )}
      </div>

      {/* Opaque rather than the usual `/70`, because the name column is sticky:
          a translucent cell lets the rows it is holding still scroll visibly
          underneath it, which reads as a rendering fault. */}
      <div className="overflow-hidden rounded-2xl border border-amber-900/15 bg-[#fffdf4] shadow-sm">
        <div className="px-4 pt-4">
          <h3 className="mb-1 font-bold text-amber-950">📊 Career numbers</h3>
          {isAdmin && (
            <p className="mb-2 text-xs text-amber-900/60">
              <b>vs rating</b> accounts for who they played with and against, so it can put someone
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
