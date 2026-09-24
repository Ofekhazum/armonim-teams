import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { FixtureRecord, Player } from '../types';
import { ATTACK_DEFAULT, ATTACK_STEP, attackLabel, badgeForAttack, roleBadge } from '../types';
import { getSectionOpen, setSectionOpen, uid } from '../storage';
import { publishRemoteRoster, setLocalRosterVersion } from '../remote';
import PlayerPage from './PlayerPage';
import type { PlayerTitle } from '../achievements';
import { playerAchievements, titleBadgeFor } from '../achievements';
import { hasResult } from '../calibration';
import { guestKey, knownGuests } from '../guests';
import { PLAIN_ROW, TITLE_THEME } from './titleTheme';
import {
  ConfirmDialog,
  fmtRating,
  FoldHeader,
  Name,
  SpectrumBar,
  spectrumColor,
  Stars,
  STYLE_ICON,
  styleLabel,
} from './ui';
import { t } from '../i18n';

interface Props {
  players: Player[];
  // every recorded night, for the player page — the roster itself doesn't need
  // it, but the page a roster row opens is entirely built from it
  history: FixtureRecord[];
  // roster player id → the name currently holding their guest-era nights on
  // (§2.68). Renaming them would orphan those nights, so the old name is kept
  // as an alias. Computed in App, which has the raw archive this needs.
  guestNameHolds: Map<string, string>;
  onChange: (players: Player[]) => void;
  adminWord: string | null;
  setAdminWord: (word: string | null) => void;
  // true once this device has read the roster's private fields back from the
  // server since unlocking admin — see the publish guard below
  rosterHydrated: boolean;
}

interface Draft {
  name: string;
  aliases: string; // comma-separated, as typed
  rating: number;
  isGk: boolean;
  attack: number;
  chemistry: string[];
  avoid: string[];
  noGkTeammate: boolean;
  number: string; // as typed, so the field can be empty; parsed on save
}

// Namespaced so it cannot collide with a History tab section id.
const GUESTS_SECTION = 'roster-guests';

// How long a just-saved row keeps its flash-ring pulse (§2.41 update) —
// matches the live room's activity highlight (MatchDay.tsx) in spirit, not
// duration: that one has a toast to fade with it, this one is just the ring.
const SAVE_HIGHLIGHT_MS = 1200;

// One themed dialog replaces every alert()/confirm() the tab used to reach
// for (§2.41) — native dialogs can't render Hebrew names with correct bidi
// and broke the amber theme exactly at the highest-stakes moments (remove,
// publish). 'publish-result' covers every alert the old publish flow ended
// on (success and every failure branch); only 'remove-confirm' and
// 'publish-confirm' are actual yes/no gates.
type DialogState =
  | { kind: 'remove-confirm'; player: Player }
  | { kind: 'publish-confirm' }
  | { kind: 'publish-result'; title: string; body: string; tone: 'default' | 'danger' | 'success' };

const parseAliases = (raw: string): string[] =>
  [...new Set(raw.split(',').map((a) => a.trim()).filter(Boolean))];

export default function Roster({
  players,
  history,
  guestNameHolds,
  onChange,
  adminWord,
  setAdminWord,
  rosterHydrated,
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // Chemistry/avoid start folded for a form that doesn't already carry any —
  // the common case, and the one the mega-form critique flagged (§2.41): two
  // full-roster chip clouds rendering unconditionally on every add/edit. An
  // existing player's relationships stay visible by default so editing one
  // doesn't hide the very thing being edited.
  const [relOpen, setRelOpen] = useState(false);
  const [relFilter, setRelFilter] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  useEffect(() => {
    if (!savedId) return;
    const t = setTimeout(() => setSavedId(null), SAVE_HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [savedId]);
  // whose page is open, if any — no router in this app, so the panel is state
  // and an overlay, the same shape as pitch mode
  const [openId, setOpenId] = useState<string | null>(null);
  const isAdmin = adminWord !== null;
  const open = openId === null ? null : (players.find((p) => p.id === openId) ?? null);

  // The title each player is carrying, if any — what skins their row. Computed
  // once for the whole squad rather than per row: playerAchievements walks the
  // entire history to work out who tops each column, and doing that fifteen
  // times to draw fifteen rows would be fifteen times the work for one answer.
  const titles = useMemo(() => {
    const recorded = history.filter((fx) => hasResult(fx.wins)).length;
    const byId = playerAchievements(history);
    const out = new Map<string, PlayerTitle>();
    for (const p of players) {
      const t = titleBadgeFor(byId.get(p.id)?.achievements ?? [], recorded);
      if (t) out.set(p.id, t);
    }
    return out;
  }, [history, players]);

  // The actual network publish, once any confirmation gate is cleared.
  const doPublish = async () => {
    if (adminWord == null) return;
    setDialog(null);
    setPublishing(true);
    const { result, version } = await publishRemoteRoster(players, adminWord);
    setPublishing(false);
    if (result === 'ok') {
      if (version) setLocalRosterVersion(version); // don't re-pull our own change
      setDialog({
        kind: 'publish-result',
        title: t('roster.published.title'),
        body: t('roster.published.body'),
        tone: 'success',
      });
    } else if (result === 'wrong-word') {
      // password was changed on the server since we unlocked — drop back to normal
      setDialog({
        kind: 'publish-result',
        title: t('roster.publishFailed.title'),
        body: t('roster.publishFailed.wrongWord'),
        tone: 'danger',
      });
      setAdminWord(null);
    } else if (result === 'rate-limited') {
      setDialog({
        kind: 'publish-result',
        title: t('roster.publishFailed.title'),
        body: t('roster.publishFailed.rateLimited'),
        tone: 'danger',
      });
    } else if (result === 'stale') {
      setDialog({
        kind: 'publish-result',
        title: t('roster.staleRemote.title'),
        body: t('roster.staleRemote.body'),
        tone: 'danger',
      });
    } else {
      setDialog({
        kind: 'publish-result',
        title: t('roster.publishFailed.title'),
        body: t('roster.publishFailed.offline'),
        tone: 'danger',
      });
    }
  };

  // Push the current roster to everyone, using the already-unlocked word.
  const publish = () => {
    if (adminWord == null) return;
    // A publish sends the whole player list, private fields included. If this
    // device never managed to read those back from the server, the empty lists
    // it is holding are "we don't know", not "there aren't any" — and sending
    // them would erase everyone's keep-apart lists. Happens if the worker is
    // older than this build, or the fetch simply failed.
    if (!rosterHydrated) {
      setDialog({ kind: 'publish-confirm' });
      return;
    }
    doPublish();
  };

  // A titled player wears their theme; everyone else keeps the plain surface.
  const theme = (id: string): string => {
    const t = titles.get(id);
    const skin = t && TITLE_THEME[t.kind];
    if (!skin) return PLAIN_ROW;
    return skin.glow ? `${skin.card} ${skin.glow}` : skin.card;
  };

  const startAdd = () => {
    setEditingId(null);
    setDraft({
      name: '',
      aliases: '',
      rating: 3,
      isGk: false,
      attack: ATTACK_DEFAULT,
      chemistry: [],
      avoid: [],
      noGkTeammate: false,
      number: '',
    });
    setRelOpen(false);
    setRelFilter('');
  };

  const startEdit = (p: Player) => {
    setEditingId(p.id);
    setDraft({
      name: p.name,
      aliases: (p.aliases ?? []).join(', '),
      rating: p.rating,
      isGk: !!p.isGk,
      attack: p.attack,
      chemistry: [...p.chemistry],
      avoid: [...(p.avoid ?? [])],
      noGkTeammate: !!p.noGkTeammate,
      number: p.number != null ? String(p.number) : '',
    });
    // Already-set relationships stay visible — editing a player shouldn't
    // hide the very thing being edited behind an extra tap.
    setRelOpen(
      p.chemistry.length > 0 || (p.avoid ?? []).length > 0 || !!p.noGkTeammate,
    );
    setRelFilter('');
  };

  const cancel = () => {
    setDraft(null);
    setEditingId(null);
  };

  // The old name, if saving this draft would otherwise orphan guest-era nights.
  // Takes the aliases as parsed so a name the organiser has already typed into
  // the box is not added twice.
  const renameWouldOrphan = (parsedAliases: string[]): string | null => {
    const held = editingId ? guestNameHolds.get(editingId) : undefined;
    if (!held || !draft) return null;
    const next = guestKey(draft.name);
    if (!next || guestKey(held) === next) return null;
    return parsedAliases.some((a) => guestKey(a) === guestKey(held)) ? null : held;
  };

  // Same question, for the note under the name field — so the alias is offered
  // before the save rather than discovered in the list afterwards.
  const keptOnRename = draft ? renameWouldOrphan(parseAliases(draft.aliases)) : null;

  const save = () => {
    if (!draft || !draft.name.trim()) return;
    const { aliases, number, ...rest } = draft;
    const trimmedNumber = number.trim();
    const parsedNumber = trimmedNumber === '' ? NaN : Number(trimmedNumber);
    const parsedAliases = parseAliases(aliases);
    // A rename would cut this player loose from the nights they played as a
    // guest, which are matched on the name rather than on an id (§2.68). Keep
    // the old name so they stay one person. Only fires when history actually
    // has nights riding on it, so correcting a typo leaves no trace.
    const keep = renameWouldOrphan(parsedAliases);
    const data = {
      ...rest,
      name: draft.name.trim(),
      aliases: keep ? [...parsedAliases, keep] : parsedAliases,
      // explicit undefined (rather than omitting the key) so saving a
      // cleared field actually erases a previously-set number
      number: Number.isFinite(parsedNumber) ? parsedNumber : undefined,
    };
    const id = editingId ?? uid();
    const next = editingId
      ? players.map((p) => (p.id === editingId ? { ...p, ...data } : p))
      : [...players, { id, ...data }];
    // chemistry/avoid are mutual — mirror this player's links onto everyone else
    const chem = new Set(data.chemistry);
    const avoid = new Set(data.avoid);
    onChange(
      next.map((p) => {
        if (p.id === id) return p;
        const chemistry = chem.has(p.id)
          ? p.chemistry.includes(id) ? p.chemistry : [...p.chemistry, id]
          : p.chemistry.filter((x) => x !== id);
        const pAvoid = p.avoid ?? [];
        const newAvoid = avoid.has(p.id)
          ? pAvoid.includes(id) ? pAvoid : [...pAvoid, id]
          : pAvoid.filter((x) => x !== id);
        return { ...p, chemistry, avoid: newAvoid };
      }),
    );
    // The routine action deserved feedback of its own (§2.41 update) — it
    // used to just close the form, while Publish (the rare action) got a
    // whole dialog. A brief pulse on the row that was actually touched is
    // the smallest fix that isn't silence.
    setSavedId(id);
    cancel();
  };

  // --- Guests who keep coming back ------------------------------------------
  // A guest is a name typed into a box on the night, with a fresh id every time
  // (§2.6). The read-time merge already counts a returning guest as one person,
  // so what is missing is not arithmetic — it is membership: a rating, a shirt
  // number, a place in the balancer, an eligible line on the Team of the Month.
  //
  // Promotion is deliberately *only* a roster insert. Nothing in history is
  // rewritten: the new player carries the guest's name, and a roster player
  // absorbs same-named guests, so every night they already played comes with
  // them. That also makes it undoable — removing the player hands those nights
  // straight back to being a guest's.
  const guestRows = useMemo(() => {
    const rosterIds = new Set(players.map((p) => p.id));
    const nights = new Map<string, number>();
    for (const fx of history) {
      if (!hasResult(fx.wins)) continue;
      for (const id of [...fx.teams.black, ...fx.teams.white, ...fx.teams.blue]) {
        if (rosterIds.has(id)) continue;
        nights.set(id, (nights.get(id) ?? 0) + 1);
      }
    }
    return knownGuests(history, rosterIds)
      .map((g) => ({ ...g, nights: nights.get(g.id) ?? 0 }))
      .filter((g) => g.nights > 0)
      .sort((a, b) => b.nights - a.nights || a.name.localeCompare(b.name, 'he'));
  }, [history, players]);

  // Folded until asked for, and the choice is remembered per device the same
  // way the History tab's sections are (§2.28) — `getSectionOpen`'s fallback is
  // what "closed unless you say otherwise" is expressed with, so a reader who
  // opens it once keeps it open.
  const [guestsOpen, setGuestsOpen] = useState(() => getSectionOpen(GUESTS_SECTION, false));
  const toggleGuests = () => {
    const next = !guestsOpen;
    setGuestsOpen(next);
    setSectionOpen(GUESTS_SECTION, next);
  };

  // Opens the ordinary add form with the name filled in, rather than creating
  // the player outright: a squad member needs a rating and a number, and the
  // organiser is the only one who knows them. Same save path as any other add,
  // so there is no second way for a player to enter the roster.
  const promoteGuest = (name: string) => {
    const clash = players.find((p) => guestKey(p.name) === guestKey(name));
    if (clash) {
      alert(
        `${clash.name} is already on the roster, so nights played by a guest called ` +
          `“${name}” are already counted as theirs. Nothing to promote.`,
      );
      return;
    }
    setEditingId(null);
    setDraft({
      name,
      aliases: '',
      rating: 3,
      isGk: false,
      attack: ATTACK_DEFAULT,
      chemistry: [],
      avoid: [],
      noGkTeammate: false,
      number: '',
    });
    setRelOpen(false);
    setRelFilter('');
  };

  const remove = (p: Player) => setDialog({ kind: 'remove-confirm', player: p });

  const confirmRemove = (p: Player) => {
    onChange(players.filter((x) => x.id !== p.id));
    if (editingId === p.id) cancel();
    setDialog(null);
  };

  // a player can't be in both lists — adding to one removes from the other
  const toggleChem = (id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      chemistry: draft.chemistry.includes(id)
        ? draft.chemistry.filter((x) => x !== id)
        : [...draft.chemistry, id],
      avoid: draft.avoid.filter((x) => x !== id),
    });
  };

  const toggleAvoid = (id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      avoid: draft.avoid.includes(id)
        ? draft.avoid.filter((x) => x !== id)
        : [...draft.avoid, id],
      chemistry: draft.chemistry.filter((x) => x !== id),
    });
  };

  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const byId = new Map(players.map((p) => [p.id, p]));

  // Shared by the chemistry and avoid chip clouds below — one filter, one
  // eligible-players list, so the two stay in sync rather than each
  // recomputing its own view of "everyone but the player being edited".
  const eligibleForRelationships = sorted.filter((p) => p.id !== editingId);
  const relQuery = relFilter.trim().toLowerCase();
  const filteredForRelationships = relQuery
    ? eligibleForRelationships.filter(
        (p) =>
          p.name.toLowerCase().includes(relQuery) ||
          (p.aliases ?? []).some((a) => a.toLowerCase().includes(relQuery)),
      )
    : eligibleForRelationships;

  // A non-blocking nudge, not a gate — a duplicate is sometimes intentional
  // (two people who really do share a name).
  const duplicateName =
    draft && draft.name.trim()
      ? players.find(
          (p) =>
            p.id !== editingId &&
            (guestKey(p.name) === guestKey(draft.name) ||
              (p.aliases ?? []).some((a) => guestKey(a) === guestKey(draft.name))),
        )
      : undefined;

  // Rendered either up top (adding a new player, nothing to anchor to yet)
  // or inline in place of the player's own row (editing one) — so editing
  // someone near the bottom of a long roster doesn't yank the page back up
  // to the top of the screen.
  const draftForm = draft && (
    <div className="pop-in space-y-4 rounded-2xl border border-amber-900/20 bg-[#fffdf4]/80 p-4 shadow-sm">
      <h2 className="font-bold text-amber-950">
        {editingId ? t('roster.form.editTitle') : t('roster.form.newTitle')}
      </h2>

      <div>
        <input
          dir="auto"
          // Only for a brand-new player — focusing this on an existing one
          // pops the keyboard open on mobile the instant you tap Edit, which
          // shoves the page around for no reason since you're often just
          // tweaking a rating or role, not the name.
          autoFocus={editingId === null}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder={t('roster.form.name.placeholder')}
          className="w-full rounded-lg border border-amber-900/30 bg-white px-3 py-2 text-amber-950 outline-none focus:border-orange-500"
        />
        {/* Non-blocking — a duplicate is sometimes intentional (two people who
            really do share a name), so this warns rather than gates Save the
            way promoteGuest's guestKey check already gates a guest/roster
            name clash (§2.41 harden pass). */}
        {duplicateName && (
          <p className="mt-1 text-xs text-orange-700">
            ⚠️ <Name>{duplicateName.name}</Name> {t('roster.form.duplicate')}
          </p>
        )}
        {keptOnRename && (
          <p className="mt-1 text-xs text-emerald-800">
            💾 {t('roster.form.keepsOldName', { name: keptOnRename })}
          </p>
        )}
      </div>

      <div>
        <input
          dir="auto"
          value={draft.aliases}
          onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder={t('roster.form.aliases.placeholder')}
          className="w-full rounded-lg border border-amber-900/30 bg-white px-3 py-2 text-sm text-amber-950 outline-none focus:border-orange-500"
        />
        <p className="mt-1 text-xs text-amber-900/50">{t('roster.form.aliases.hint')}</p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-amber-900/60">
          {t('roster.form.number.label')}
        </label>
        <input
          dir="ltr"
          type="number"
          inputMode="numeric"
          min={0}
          max={99}
          value={draft.number}
          onChange={(e) => setDraft({ ...draft, number: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder={t('roster.form.number.placeholder')}
          className="w-24 rounded-lg border border-amber-900/30 bg-white px-3 py-2 text-amber-950 outline-none focus:border-orange-500"
        />
        <p className="mt-1 text-xs text-amber-900/50">{t('roster.form.number.hint')}</p>
      </div>

      {(!editingId || isAdmin) && (
        <div className="rounded-lg border border-amber-900/15 bg-white/60 px-3 py-2.5">
          {/* A slider, matching the Attack spectrum just below it (§2.41
              distill pass) — the 9-button grid it replaced was a flat wall of
              equally-weighted choices with no progressive disclosure, unlike
              every other continuous pick in this form. */}
          <div className="mb-1 flex items-center justify-between gap-2 text-sm font-bold text-amber-950">
            <Stars rating={draft.rating} />
            <span className="text-xs font-semibold text-amber-900/60">
              {fmtRating(draft.rating)} / 5
            </span>
          </div>
          <input
            dir="ltr"
            type="range"
            min={1}
            max={5}
            step={0.5}
            value={draft.rating}
            onChange={(e) => setDraft({ ...draft, rating: Number(e.target.value) })}
            aria-label={t('roster.form.rating.aria')}
            className="rating-range w-full"
          />
        </div>
      )}

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-900/60">
            {t('roster.form.role')}
          </span>
          <button
            onClick={() =>
              setDraft({
                ...draft,
                isGk: !draft.isGk,
                // Made a keeper, so the request to have one kept off their team
                // is about themselves and can never be met — cleared rather
                // than left set behind a hidden control, where it would keep
                // counting on the fold's badge with nothing there to explain it.
                ...(draft.isGk ? {} : { noGkTeammate: false }),
              })
            }
            aria-pressed={draft.isGk}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
              draft.isGk
                ? 'border-sky-600 bg-sky-600/15 text-sky-800'
                : 'border-amber-900/25 bg-white text-amber-900'
            }`}
          >
            {t('roster.form.gk.toggle')}
          </button>
        </div>

        {draft.isGk ? (
          <p className="rounded-lg border border-amber-900/15 bg-white/60 px-3 py-2.5 text-xs text-amber-900/70">
            {t('roster.form.gk.note')}
          </p>
        ) : (
          <div className="rounded-lg border border-amber-900/15 bg-white/60 px-3 py-2.5">
            <div className="mb-1 flex items-center justify-between gap-2 text-sm font-bold text-amber-950">
              <span>
                {STYLE_ICON[badgeForAttack(draft.attack)]}{' '}
                {styleLabel(badgeForAttack(draft.attack))}
              </span>
              <span className="text-xs font-semibold text-amber-900/60">
                {attackLabel(draft.attack)}
              </span>
            </div>
            {/* the thumb tracks the spectrum colour as it moves: blue when
                leaning defensive, red when leaning attacking */}
            <input
              dir="ltr"
              type="range"
              min={0}
              max={100}
              step={ATTACK_STEP}
              value={draft.attack}
              onChange={(e) => setDraft({ ...draft, attack: Number(e.target.value) })}
              aria-label={t('roster.form.spectrum.aria')}
              className="spectrum-range w-full"
              style={{ '--thumb': spectrumColor(draft.attack) } as CSSProperties}
            />
            <div dir="ltr" className="flex justify-between text-xs font-semibold text-amber-900/50">
              <span>{t('roster.form.defence')}</span>
              <span>{t('roster.form.attack')}</span>
            </div>
          </div>
        )}
      </div>

      {eligibleForRelationships.length > 0 && (
        <div className="rounded-lg border border-amber-900/15 bg-white/60 px-3 py-2.5">
          <FoldHeader
            title={`${t('roster.rel.title')}${
              draft.chemistry.length + draft.avoid.length + (draft.noGkTeammate ? 1 : 0) > 0
                ? ` (${draft.chemistry.length + draft.avoid.length + (draft.noGkTeammate ? 1 : 0)})`
                : ''
            }`}
            open={relOpen}
            onToggle={() => setRelOpen(!relOpen)}
            className="text-amber-900"
          />
          {relOpen && (
            <div className="mt-3 space-y-2">
              {/* Above the per-player list, because it is the one thing here
                  that names nobody: it is about this player and the gloves,
                  not about who they are put next to (§2.59). Admin-only, like
                  avoid — "I need to be able to rest" is the same kind of thing
                  to say about somebody as who they would rather not play with,
                  and a keeper is only ever a keeper for one evening anyway. */}
              {isAdmin && !draft.isGk && (
                <button
                  onClick={() => setDraft({ ...draft, noGkTeammate: !draft.noGkTeammate })}
                  aria-pressed={draft.noGkTeammate}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-start transition-colors ${
                    draft.noGkTeammate
                      ? 'border-sky-600 bg-sky-600/15 text-sky-900'
                      : 'border-amber-900/20 bg-white text-amber-900/70 hover:border-sky-600/50'
                  }`}
                >
                  <span className="text-base">{draft.noGkTeammate ? '🧤' : '·'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{t('roster.rel.nogk')}</span>
                    <span className="block text-xs opacity-70">{t('roster.rel.nogk.hint')}</span>
                  </span>
                </button>
              )}

              {eligibleForRelationships.length > 8 && (
                <input
                  dir="auto"
                  value={relFilter}
                  onChange={(e) => setRelFilter(e.target.value)}
                  placeholder={t('roster.rel.filter.placeholder')}
                  aria-label={t('roster.rel.filter.aria')}
                  className="w-full rounded-lg border border-amber-900/25 bg-white px-3 py-1.5 text-sm text-amber-950 outline-none focus:border-orange-500"
                />
              )}

              {/* One row per player rather than two parallel full-roster chip
                  clouds (§2.41 update, distill pass): the old shape made
                  toggling both relationships for the same person mean
                  scanning two separately-sorted lists for their name twice.
                  Avoid stays admin-only — who'd rather not be paired up is
                  sensitive, so its toggle isn't shown or editable in normal
                  mode. */}
              <p className="text-xs text-amber-900/50">
                {t('roster.rel.legend.chem')}
                {isAdmin && t('roster.rel.legend.avoid')}
              </p>
              <div className="max-h-72 space-y-1 overflow-y-auto pe-0.5">
                {filteredForRelationships.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-amber-900/15 bg-white px-3 py-1.5"
                  >
                    <Name className="min-w-0 truncate text-sm text-amber-950">{p.name}</Name>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        onClick={() => toggleChem(p.id)}
                        aria-pressed={draft.chemistry.includes(p.id)}
                        aria-label={t('roster.rel.chem.aria', { name: p.name })}
                        title={t('roster.rel.chem.title')}
                        className={`rounded-full border px-2.5 py-1.5 text-sm transition-colors ${
                          draft.chemistry.includes(p.id)
                            ? 'border-pink-500 bg-pink-500/15 text-pink-700'
                            : 'border-amber-900/25 bg-white text-amber-900/40 hover:border-pink-500/60'
                        }`}
                      >
                        🤝
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => toggleAvoid(p.id)}
                          aria-pressed={draft.avoid.includes(p.id)}
                          aria-label={t('roster.rel.avoid.aria', { name: p.name })}
                          title={t('roster.rel.avoid.title')}
                          className={`rounded-full border px-2.5 py-1.5 text-sm transition-colors ${
                            draft.avoid.includes(p.id)
                              ? 'border-sky-600 bg-sky-600/15 text-sky-800'
                              : 'border-amber-900/25 bg-white text-amber-900/40 hover:border-sky-600/60'
                          }`}
                        >
                          ↔️
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {filteredForRelationships.length === 0 && (
                  <p className="text-xs text-amber-900/50">
                    {t('roster.rel.noMatch', { q: relFilter })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* sticky on mobile so Save stays reachable without scrolling back
          down past the chemistry chip lists */}
      <div className="sticky bottom-0 -mx-4 -mb-4 flex gap-2 border-t border-amber-900/10 bg-[#fffdf4]/95 px-4 py-3 backdrop-blur-sm sm:static sm:mx-0 sm:mb-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <button
          onClick={save}
          disabled={!draft.name.trim()}
          className="flex-1 rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-bold text-amber-50 disabled:opacity-40 sm:flex-none"
        >
          {t('ui.save')}
        </button>
        <button
          onClick={cancel}
          className="flex-1 rounded-lg border border-amber-900/30 px-5 py-2.5 text-sm font-semibold text-amber-900 sm:flex-none"
        >
          {t('ui.cancel')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-amber-900/70">{t('roster.intro')}</p>
        {!draft && (
          <div className="flex gap-2">
            {/* Unlocking and leaving admin both moved to the header, where
                they are reachable from every tab — see App.tsx. */}
            {isAdmin && players.length > 0 && (
              <button
                onClick={publish}
                disabled={publishing}
                className="rounded-lg border border-orange-500 px-3 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                title={t('roster.publish.title')}
              >
                {publishing ? t('roster.publishing') : t('roster.publish')}
              </button>
            )}
            {/* Adding, editing and removing players are all the same act —
                deciding who is in this club — and that is the organiser's,
                so the whole set sits behind admin (§2.14). Everyone else gets
                the roster as a list to read. */}
            {isAdmin && (
              <button
                onClick={startAdd}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-amber-50 shadow-sm transition-transform hover:scale-105"
              >
                {t('roster.add')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Surfaced as soon as it's true, not just inside the Publish-click
          gate below (§2.41 clarify pass) — the old flow only revealed a
          stale-hydration problem after an admin had already made several
          edits, at the worst possible point to first meet friction. */}
      {isAdmin && !rosterHydrated && players.length > 0 && (
        <div className="rounded-xl border border-orange-500/40 bg-orange-50 px-3 py-2.5 text-xs text-orange-900">
          {t('roster.stale.banner')}
        </div>
      )}

      {draft && editingId === null && draftForm}

      {isAdmin && !draft && guestRows.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-900/15 bg-amber-50/60 p-4">
          {/* Starts folded, the same call the History tab's admin tooling makes:
              this is a job done once in a while, and the roster is what the tab
              is for. The count rides on the header so a collapsed panel still
              says there is something in it. */}
          <FoldHeader
            title={t('roster.guests.title', { n: guestRows.length })}
            open={guestsOpen}
            onToggle={toggleGuests}
            className="text-amber-900"
          />
          {guestsOpen && (
            <>
              <p className="mt-1.5 text-xs text-amber-900/60">{t('roster.guests.hint')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {guestRows.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center gap-2 rounded-full border border-amber-900/20 bg-white/80 py-1 pe-1 ps-3 shadow-sm"
                  >
                    <span className="text-sm font-bold text-amber-900">{g.name}</span>
                    <span className="text-[11px] font-semibold text-amber-900/50">
                      {t('roster.guests.nights', { n: g.nights })}
                    </span>
                    <button
                      onClick={() => promoteGuest(g.name)}
                      className="rounded-full bg-orange-600 px-2.5 py-1 text-[11px] font-bold text-amber-50 transition-transform hover:scale-105"
                      title={t('roster.guests.promote.title', { name: g.name, n: g.nights })}
                    >
                      {t('roster.guests.promote')}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {sorted.length === 0 && !draft ? (
        <div className="rounded-2xl border border-dashed border-amber-900/30 p-10 text-center text-amber-900/70">
          {t('roster.empty')}
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {sorted.map((p) =>
            draft && editingId === p.id ? (
              <li key={p.id} className="sm:col-span-2">
                {draftForm}
              </li>
            ) : (
              <li
                key={p.id}
                dir="rtl"
                // Named in the tooltip as well as worn: a coloured card nobody
                // can decode is the mystery-emoji problem the badge key exists
                // to avoid (§2.18). The tooltip is a desktop-hover shortcut,
                // not the only path — the row's own button below writes the
                // same title out as plain text via PlayerPage, so touch never
                // actually dead-ends on it.
                title={titles.get(p.id)?.title}
                className={`group relative flex items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-500/60 hover:shadow-md ${
                  p.id === savedId ? 'flash-ring' : ''
                } ${theme(p.id)}`}
                style={
                  p.id === savedId ? ({ '--flash-color': '#78350f' } as CSSProperties) : undefined
                }
              >
                {p.id === savedId && (
                  <span
                    aria-hidden
                    className="save-badge pointer-events-none absolute end-3 top-2 rounded-full bg-amber-900/90 px-2 py-0.5 text-[10px] font-bold text-amber-50 shadow-sm"
                  >
                    {t('roster.row.saved')}
                  </span>
                )}
                {/* The badge's own emoji, set large and nearly transparent at
                    the far edge — a watermark rather than an icon, so it reads
                    as the card's character rather than as another thing to
                    look at. Physically on the left because the row is RTL and
                    the names live on the right, and pinned to the row's centre
                    line: anchored to the bottom it hung half off the card,
                    which read as a rendering fault rather than as a watermark. */}
                {titles.get(p.id) && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 select-none text-5xl leading-none opacity-[0.14] transition-opacity duration-200 group-hover:opacity-25"
                  >
                    {titles.get(p.id)!.icon}
                  </span>
                )}
                {/* A real <button>, not a role="button" on the <li> (§2.41
                    distill pass) — the earlier fix for "keyboard users can't
                    open a player" wrapped Edit/✕ inside another interactive
                    element, which is invalid ARIA nesting and tripled the Tab
                    stops per row. This is now a plain sibling of Edit/✕, so
                    each row is exactly the two-or-three real controls it
                    looks like. Still the whole content area, not a small
                    "view" link — on a phone that's the target your thumb is
                    already aimed at, and it lifts on hover same as before. */}
                <button
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  aria-label={t('roster.row.open', { name: p.name })}
                  className="relative flex min-w-0 flex-1 cursor-pointer flex-col items-start border-0 bg-transparent p-0 text-start"
                >
                  <div className="flex items-center gap-2">
                    <Name className="truncate font-semibold text-amber-950">{p.name}</Name>
                    <span title={styleLabel(roleBadge(p))}>{STYLE_ICON[roleBadge(p)]}</span>
                    {isAdmin && !p.isGk && <SpectrumBar attack={p.attack} />}
                    {isAdmin && <Stars rating={p.rating} unknown={p.ratingUnknown} />}
                  </div>
                  {(p.aliases ?? []).length > 0 && (
                    <div
                      className="mt-0.5 truncate text-xs text-amber-900/50"
                      title={t('roster.row.akaTitle')}
                    >
                      {t('roster.row.aka')} {p.aliases!.join(', ')}
                    </div>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-amber-950">
                    {p.chemistry.length > 0 && (
                      <span
                        className="min-w-0 max-w-full truncate text-xs text-pink-700/80"
                        title={t('roster.rel.chem.title')}
                      >
                        🤝{' '}
                        {p.chemistry
                          .map((id) => byId.get(id)?.name)
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    )}
                    {isAdmin && (p.avoid ?? []).length > 0 && (
                      <span
                        className="min-w-0 max-w-full truncate text-xs text-sky-800/80"
                        title={t('roster.rel.avoid.title')}
                      >
                        ↔️{' '}
                        {p.avoid!
                          .map((id) => byId.get(id)?.name)
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    )}
                  </div>
                </button>
                {isAdmin && (
                  <>
                    <button
                      onClick={() => startEdit(p)}
                      className="rounded-lg border border-amber-900/25 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:border-orange-500"
                    >
                      {t('roster.edit')}
                    </button>
                    <button
                      onClick={() => remove(p)}
                      className="rounded-lg border border-amber-900/25 px-2.5 py-1 text-xs font-semibold text-red-600 hover:border-red-500"
                    >
                      ✕
                    </button>
                  </>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {open && (
        <PlayerPage
          player={open}
          history={history}
          players={players}
          isAdmin={isAdmin}
          adminWord={adminWord}
          // Editing from the page hands straight back to the form that was
          // always there, on the roster underneath — one edit form in the app,
          // reached from two places, rather than a second one to keep in step.
          onEdit={() => {
            setOpenId(null);
            startEdit(open);
          }}
          onClose={() => setOpenId(null)}
        />
      )}

      {dialog?.kind === 'remove-confirm' && (
        <ConfirmDialog
          title={t('roster.remove.title')}
          body={t('roster.remove.body', { name: dialog.player.name })}
          confirmLabel={t('roster.remove.confirm')}
          tone="danger"
          onConfirm={() => confirmRemove(dialog.player)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'publish-confirm' && (
        <ConfirmDialog
          title={t('roster.publishGate.title')}
          body={t('roster.publishGate.body')}
          confirmLabel={t('roster.publishGate.confirm')}
          tone="danger"
          onConfirm={doPublish}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'publish-result' && (
        <ConfirmDialog
          title={dialog.title}
          body={dialog.body}
          tone={dialog.tone}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
