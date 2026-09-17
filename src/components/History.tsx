import { useEffect, useMemo, useRef, useState } from 'react';
import type { DraftTeamWins, FixtureRecord, Player, TeamColor, TeamWins } from '../types';
import { NOTE_MAX } from '../types';
import { TEAM_COLORS } from '../balancer';
import { MIN_NIGHTS, hasResult, playerForm, playerStandings } from '../calibration';
import { nightStory } from '../nightStory';
import { RATING_PANEL_READY } from '../ratingPanel';
import { mvpCandidates, mvpCounts, mvpFromVotes, winningTeams } from '../mvp';
import { getNightsShelfOpen, setNightsShelfOpen } from '../storage';
import { playerAchievements } from '../achievements';
import { leaderboards } from '../leaderboards';
import { fmtWins, FoldHeader, Name, Section, TEAM_META, teamLabel } from './ui';
import Leaderboards from './Leaderboards';
import PlayerCompare from './PlayerCompare';
import MvpPicker from './MvpPicker';
import NightPage from './NightPage';
import EventsEditor from './EventsEditor';
import { t } from '../i18n';

interface Props {
  history: FixtureRecord[];
  players: Player[];
  isAdmin: boolean;
  // Present only for an organiser. Handed through to the night page, which
  // needs the word rather than the flag: the recap it writes is a guarded
  // write on the worker, not a locally hidden button.
  adminWord?: string | null;
  onDeleteFixture: (fixtureId: string) => void;
  onEditFixture: (
    fixtureId: string,
    patch: {
      wins: TeamWins;
      date: string;
      mvpId?: string;
      mvpVotes?: Record<string, number>;
      note?: string;
    },
  ) => void;
}

interface Draft {
  wins: DraftTeamWins;
  date: string;
  // The pick, kept alongside the sheet rather than derived on read. It follows
  // the votes as they are typed (`mvpFromVotes`), and holds the value the
  // votes cannot supply: the standing pick on a level sheet, and the pick on a
  // night filed before the sheet existed (§2.46).
  mvpId: string | null;
  mvpVotes: Record<string, number>;
  note: string;
}

type SortKey = 'name' | 'nights' | 'wins' | 'fixtures' | 'mvps' | 'perNight' | 'vsRating';

// "vs rating" is the one column that is an opinion about a player rather than
// a count of what happened — it says someone is over- or under-performing the
// number the organiser gave them. That's a working note for whoever maintains
// the ratings, not something to publish next to everyone's name, so the whole
// column only exists in admin mode (§2.14).
const sortColumns = (isAdmin: boolean): { key: SortKey; label: string }[] => [
  { key: 'name', label: t('hist.col.name') },
  { key: 'nights', label: t('hist.col.nights') },
  { key: 'wins', label: t('hist.col.wins') },
  { key: 'fixtures', label: t('hist.col.fixtures') },
  { key: 'perNight', label: t('hist.col.perNight') },
  { key: 'mvps', label: t('hist.col.mvps') },
  ...(isAdmin && RATING_PANEL_READY
    ? [{ key: 'vsRating' as SortKey, label: t('hist.col.vsRating') }]
    : []),
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

export default function History({
  history,
  players,
  isAdmin,
  adminWord = null,
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
  // Open by default and remembered per device — the shelf is what the tab is
  // for, but forty cards is still forty cards on the way to the numbers, and
  // somebody who only wants the table should be able to say so once.
  const [shelfOpen, setShelfOpen] = useState(getNightsShelfOpen);
  // the night currently being corrected, and the values as typed so far
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'perNight',
    dir: 'desc',
  });

  const startEdit = (fx: FixtureRecord) => {
    setEditId(fx.id);
    setDraft({
      wins: { ...fx.wins },
      date: fx.date,
      mvpId: fx.mvpId ?? null,
      mvpVotes: { ...(fx.mvpVotes ?? {}) },
      note: fx.note ?? '',
    });
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
      // Same rule as the pick above: always present, so zeroing every row is
      // how a sheet gets deleted rather than a no-op that leaves the old tally
      // in place. An empty sheet is stored as absent, not as `{}` — see
      // FixtureRecord.mvpVotes.
      mvpVotes: Object.keys(draft.mvpVotes).length > 0 ? draft.mvpVotes : undefined,
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

  const formById = new Map(form.map((f) => [f.id, f]));
  const mvpById = new Map(mvpCounts(history).map((m) => [m.id, m.count]));
  const achievements = useMemo(() => playerAchievements(history), [history]);
  const fixturesWon = (id: string) => achievements.get(id)?.fixturesWon ?? 0;
  const recordedNights = history.filter((fx) => hasResult(fx.wins)).length;
  // the night whose organiser drawer is open under the strip, if any
  const editing = openId ? (nights.find((fx) => fx.id === openId) ?? null) : null;
  const editingLogged = (editing?.matchLog?.length ?? 0) > 0;
  const columns = sortColumns(isAdmin);
  // The podiums say who tops what, which is the job the badge cluster in the
  // name column used to do one player at a time (§2.36).
  const boards = useMemo(() => leaderboards(history), [history]);
  // Who the comparison pickers offer (§2.37). Read off the standings rather
  // than the roster, so somebody who has left the club can still be compared —
  // their record happened — and sorted by name, because a picker is something
  // you scan for a name rather than read in rank order.
  const comparable = useMemo(
    () =>
      standings
        .map((s) => ({ id: s.id, name: s.name }))
        .sort((x, y) => x.name.localeCompare(y.name, 'he')),
    [standings],
  );
  // leaving admin while sorted by the admin-only column would sort the table
  // by something no longer on screen
  const sortKey: SortKey =
    (!isAdmin || !RATING_PANEL_READY) && sort.key === 'vsRating' ? 'perNight' : sort.key;

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
        <p className="text-lg font-bold text-amber-950">{t('hist.empty.title')}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-amber-900/60">{t('hist.empty.body')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* The tab strip says "Club" — short enough to sit beside Match day,
          Roster (20) and Tools on a phone. The page says what it actually is. */}
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm text-amber-900/60">
        <h2 className="text-lg font-black text-amber-950">{t('hist.title')}</h2>
        <span className="font-semibold text-amber-900/70">
          {t('hist.recorded', { n: recordedNights })}
        </span>
        {history.length !== recordedNights && (
          <span>{t('hist.noResult', { n: history.length - recordedNights })}</span>
        )}
      </div>

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
            {t('hist.shelf.title')}
            <span className="text-sm font-normal text-amber-900/50">({history.length})</span>
            <span className="text-xs font-normal text-amber-900/40">
              {shelfOpen ? t('ui.fold.hide') : t('ui.fold.show')}
            </span>
          </button>
        </div>

        {shelfOpen && (
          <>

          {/* Bleeds through the page gutter so the strip scrolls edge to edge
              rather than inside a narrower window.

              **Pinned `ltr`, so the newest night is on the left in both
              languages.** `nights` is already newest-first, which an RTL row
              lays out from the right — so the strip mirrored and the most
              recent night, the one anybody opening this tab is looking for,
              moved to the far end. This is a shelf you scan rather than a
              sentence you read, and the newest end of it should not move
              because the labels changed language. Each card's own text still
              sets its own direction. */}
          <div
              {...shelf}
              dir="ltr"
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
                  className={`relative h-48 w-44 shrink-0 overflow-hidden rounded-2xl border bg-[#fffdf4]/70 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                    openId === fx.id ? 'border-orange-500/70' : 'border-amber-900/15'
                  }`}
                >
                  {/* The whole card is the way through to the night. What is on
                      it is a *summary* and deliberately not the evening itself:
                      the shape of it, match by match, is the first thing the
                      page behind this draws, and printing it twice at two sizes
                      made the strip a worse copy of a better view. */}
                  <button
                    onClick={() => setStoryId(fx.id)}
                    aria-label={t('hist.shelf.read', { date: fx.date })}
                    className="absolute inset-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500"
                  />
                  {/* scenery: clicks fall through to the button above, so there
                      is no dead patch anywhere on the card */}
                  <div className="pointer-events-none relative flex h-full flex-col">
                    <div className="flex flex-1 flex-col p-3">
                      <div className="text-center font-mono text-[10px] font-bold uppercase tracking-widest text-amber-900/40">
                        {fx.date}
                      </div>
                      {/* The hook, and the reason the strip is worth scrolling:
                          the same headline the night page opens with. It gets
                          the whole middle of the card — the empty band under it
                          in the first cut was the card admitting it had nothing
                          else to say, when the headline could simply be bigger. */}
                      <div
                        // The strip above is pinned `ltr` for its ordering;
                        // the headline inside it is a sentence and takes its
                        // direction from its own first letter.
                        dir="auto"
                        className="mt-1.5 line-clamp-4 flex-1 text-center text-base font-black leading-[1.15] text-amber-950"
                      >
                        {(summary && t(summary.headlineKey)) ??
                          (hasResult(fx.wins)
                            ? t('hist.shelf.onTheBooks')
                            : t('hist.shelf.noResultRecorded'))}
                      </div>
                    </div>

                    {/* Who won, as the foot of the card in their own colour.
                        This was a 6px band across the top, which was the right
                        idea and the wrong size — a white team's band was white
                        on cream and effectively invisible, which is a poor
                        result for the one element whose entire job is being
                        seen from a shelf away. Full width and full height of a
                        footer, carrying the crown, the name and the points, it
                        is unmistakable in all three colours. A tie splits it. */}
                    {hasResult(fx.wins) ? (
                      <div className="flex">
                        {winners.map((c) => (
                          <div
                            key={c}
                            className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-black ${TEAM_META[c].tile}`}
                          >
                            <span className="leading-none">👑</span>
                            <span className="truncate">{teamLabel(c)}</span>
                            <span className="tabular-nums">{fmtWins(fx.wins[c] ?? 0)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      // the same shape, so a night nobody tallied does not
                      // stand a different height to the ones either side of it
                      <div className="px-2.5 py-2 text-center text-[11px] font-bold text-amber-900/30">
                        {t('hist.shelf.noResult')}
                      </div>
                    )}

                    {/* The MVP, in the same shape and deliberately the shorter
                        of the two. It was a floating pill, which made the foot
                        of the card one solid block and one shape hovering above
                        it. Two stacked bars read as one footer with a hierarchy
                        in it: who won the night, then who was the best of them.
                        Amber rather than a team colour — the pick belongs to
                        the person, not to whichever shirt they had on. */}
                    {mvpName && mvpName !== '?' && (
                      <div className="flex items-center justify-center gap-1 border-t border-amber-900/10 bg-amber-400/20 px-2.5 py-1 text-[11px]">
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
                      aria-label={t('hist.shelf.actions', { date: fx.date })}
                      className={`absolute end-1 top-1 grid h-7 w-7 place-items-center rounded-full text-base leading-none hover:bg-amber-900/10 hover:text-amber-900 ${
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
                <span className="text-xs text-amber-900/45">{t('hist.edit.actions')}</span>
                <div className="flex-1" />
                <button
                  onClick={() => {
                    setOpenId(null);
                    cancelEdit();
                  }}
                  className="text-xs font-bold text-amber-900/50 hover:text-amber-900"
                >
                  {t('hist.edit.close')}
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
                          {TEAM_META[c].emoji} {teamLabel(c)}
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
                          aria-label={t('hist.edit.wonBy', { team: teamLabel(c) })}
                          className={`w-20 rounded-lg border border-amber-900/25 px-2 py-1 text-center font-bold text-amber-950 ${
                            editingLogged ? 'bg-amber-900/[0.06]' : 'bg-white'
                          }`}
                        />
                      </label>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-amber-900/70">
                    {t('hist.edit.date')}
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
                    votes={draft.mvpVotes}
                    mvpId={draft.mvpId}
                    // The pick is recomputed from the sheet on every keystroke
                    // rather than stored separately and reconciled later —
                    // there is no state in which the star and the tally can
                    // disagree, because there is only one of them.
                    onChange={(update) =>
                      setDraft((d) => {
                        if (!d) return d;
                        const mvpVotes = update(d.mvpVotes);
                        // The pick that survives a level sheet is the one on
                        // *file*, not the one the draft happens to hold. Those
                        // differ while a sheet is first being typed: the first
                        // name tapped leads on its own for a keystroke, and
                        // carrying that forward would let entry order settle a
                        // 1–1 in its favour. `editing.mvpId` is a real decision
                        // somebody made; `d.mvpId` mid-typing is an artifact.
                        return {
                          ...d,
                          mvpVotes,
                          mvpId: mvpFromVotes(mvpVotes, editing.mvpId ?? null),
                        };
                      })
                    }
                    // Only ever set on a night picked before the sheet existed:
                    // once anything is voted the tally decides, and this line
                    // goes away.
                    legacyPick={
                      Object.keys(draft.mvpVotes).length === 0 && draft.mvpId
                        ? (editing.players.find((p) => p.id === draft.mvpId)?.name ?? '?')
                        : null
                    }
                    onClearLegacy={() => setDraft((d) => (d ? { ...d, mvpId: null } : d))}
                  />
                  {/* The organiser's note (§2.27). Written as the night was
                      filed, and editable only here, by an admin — it is never
                      rendered for anyone, including them: it exists to be
                      handed to the reporter, and a note printed on the page it
                      describes is the punchline printed above the joke.
                      Emptying the box deletes it. */}
                  {/* One box per event rather than the raw stored string
                      (§2.58). This is the editor that prompted the change:
                      correcting a filed night meant finding the right `@` in a
                      two-row textarea of wrapped Hebrew, and the two events in
                      it read as one paragraph. */}
                  <div className="space-y-1">
                    <span className="block text-xs text-amber-900/70">{t('hist.edit.note')}</span>
                    <EventsEditor
                      value={draft.note}
                      onChange={(note) => setDraft((d) => (d ? { ...d, note } : d))}
                      max={NOTE_MAX}
                      placeholder={t('hist.edit.note.placeholder')}
                    />
                    <span className="block text-[10px] text-amber-900/35">
                      {t('hist.edit.note.counter')}
                    </span>
                  </div>
                  <p className="text-xs text-amber-900/50">
                    {editingLogged
                      ? t('hist.edit.logged')
                      : t('hist.edit.halfWin')}
                    {t('hist.edit.sheetFixed')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => commitEdit(editing.id)}
                      className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-bold text-amber-50 hover:scale-105"
                    >
                      {t('hist.edit.save')}
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                    >
                      {t('ui.cancel')}
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
                      {t('hist.edit.pickMvp')}
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(editing)}
                    className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                  >
                    {t('hist.edit.editResult')}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(t('hist.edit.deleteConfirm', { date: editing.date }))) {
                        onDeleteFixture(editing.id);
                        setOpenId(null);
                      }
                    }}
                    className="rounded-lg border border-red-500/50 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                  >
                    {t('hist.edit.delete')}
                  </button>
                </div>
              )}
            </div>
          )}
          </>
        )}
      </div>

      {/* Below the shelf, because a night is a story and this is reference —
          the same order the tab has always had. Silent on a young club rather
          than six headings over empty podiums (§2.36). */}
      {boards.length > 0 && (
        <Section id="leaders" title={t('hist.section.leaders')}>
          <Leaderboards boards={boards} />
        </Section>
      )}

      <Section id="career" title={t('hist.section.career')}>
        {/* Opaque rather than the usual `/70`, because the name column is sticky:
            a translucent cell lets the rows it is holding still scroll visibly
            underneath it, which reads as a rendering fault. */}
        <div className="overflow-hidden rounded-2xl border border-amber-900/15 bg-[#fffdf4] shadow-sm">
        {isAdmin && (
          <div className="px-4 pt-4">
            <p className="mb-2 text-xs text-amber-900/60">
              <b>{t('hist.col.vsRating')}</b>
              {t('hist.vsRating.note', { n: MIN_NIGHTS })}
            </p>
          </div>
        )}
        {/* Seven columns will not fit a phone and never did. What changed is
            that the name no longer scrolls away with them: pin it, and reading
            a number sideways still tells you whose it is. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-start text-xs uppercase tracking-wide text-amber-900/50">
                {columns.map(({ key, label }) => (
                  <th
                    key={key}
                    className={`border-b border-amber-900/15 bg-[#fffdf4] pb-1.5 font-bold ${
                      key === 'name' ? 'sticky start-0 z-10 ps-4 pe-3' : 'px-3 text-end'
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
                const cell = `border-t border-amber-900/10 px-3 py-2 text-end tabular-nums ${stripe}`;
                return (
                  <tr key={s.id}>
                    {/* Just the name. The badge cluster that used to sit here
                        said who topped which column — which is what the
                        podiums above now say in words, with the count beside
                        each one (§2.36). Nine emoji on the widest rows, needing
                        a nine-line key underneath to decode, was the most
                        crowded thing on the page and the least legible way to
                        carry that fact. */}
                    <td
                      className={`sticky start-0 z-10 border-t border-amber-900/10 py-2 ps-4 pe-3 ${stripe}`}
                    >
                      <Name className="font-semibold text-amber-950">{s.name}</Name>
                    </td>
                    <td className={`${cell} text-amber-900/70`}>{s.nights}</td>
                    <td className={`${cell} font-bold text-amber-950`}>{fmtWins(s.wins)}</td>
                    <td
                      className={`${cell} text-amber-900/70`}
                      title={t('hist.fixturesWon.title')}
                    >
                      {fixturesWon(s.id) || '—'}
                    </td>
                    <td className={`${cell} text-amber-900/70`}>{s.perNight.toFixed(2)}</td>
                    <td className={`${cell} text-amber-900/70`}>
                      {mvpById.get(s.id) ? `🌟 ${mvpById.get(s.id)}` : '—'}
                    </td>
                    {isAdmin && RATING_PANEL_READY && (
                      <td
                        className={`${cell} pe-4 ${
                          !meaningful
                            ? 'text-amber-900/30'
                            : d > 0
                              ? 'font-semibold text-green-700'
                              : 'font-semibold text-red-700'
                        }`}
                        title={
                          !rated
                            ? t('hist.vsRating.needs', { n: MIN_NIGHTS })
                            : meaningful
                              ? t('hist.vsRating.meaningful')
                              : t('hist.vsRating.thin')
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
        </div>
      </Section>

      {/* Under the table rather than over it: this is the same numbers read two
          rows at a time, so the full list comes first and the close-up second
          (§2.37). Folded away by default — it does nothing until somebody picks
          two names, and an empty panel above the nights would be a permanent
          prompt on a page nobody opened to answer a question. */}
      {comparable.length >= 2 && (
        <Section id="compare" title={t('hist.section.compare')} defaultOpen={false}>
          <PlayerCompare history={history} options={comparable} />
        </Section>
      )}

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
