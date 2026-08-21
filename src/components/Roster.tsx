import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { FixtureRecord, Player } from '../types';
import { ATTACK_DEFAULT, ATTACK_STEP, attackLabel, badgeForAttack, roleBadge } from '../types';
import { uid } from '../storage';
import { publishRemoteRoster, setLocalRosterVersion } from '../remote';
import PlayerPage from './PlayerPage';
import type { PlayerTitle } from '../achievements';
import { playerAchievements, titleBadgeFor } from '../achievements';
import { hasResult } from '../calibration';
import { PLAIN_ROW, TITLE_THEME } from './titleTheme';
import {
  fmtRating,
  Name,
  RATING_STEPS,
  SpectrumBar,
  spectrumColor,
  Stars,
  STYLE_META,
} from './ui';

interface Props {
  players: Player[];
  // every recorded night, for the player page — the roster itself doesn't need
  // it, but the page a roster row opens is entirely built from it
  history: FixtureRecord[];
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
  number: string; // as typed, so the field can be empty; parsed on save
}

const parseAliases = (raw: string): string[] =>
  [...new Set(raw.split(',').map((a) => a.trim()).filter(Boolean))];

export default function Roster({
  players,
  history,
  onChange,
  adminWord,
  setAdminWord,
  rosterHydrated,
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
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

  // Push the current roster to everyone, using the already-unlocked word.
  const publish = async () => {
    if (adminWord == null) return;
    // A publish sends the whole player list, private fields included. If this
    // device never managed to read those back from the server, the empty lists
    // it is holding are "we don't know", not "there aren't any" — and sending
    // them would erase everyone's keep-apart lists. Happens if the worker is
    // older than this build, or the fetch simply failed.
    if (
      !rosterHydrated &&
      !confirm(
        "⚠️ Couldn't confirm the chemistry and keep-apart lists with the server.\n\n" +
          'Publishing now would replace them with whatever is on this device — possibly nothing. ' +
          'Reload and unlock admin again first if you want them kept.\n\nPublish anyway?',
      )
    ) {
      return;
    }
    setPublishing(true);
    const { result, version } = await publishRemoteRoster(players, adminWord);
    setPublishing(false);
    if (result === 'ok') {
      if (version) setLocalRosterVersion(version); // don't re-pull our own change
      alert('✅ Roster published — everyone gets it next time they open the app.');
    } else if (result === 'wrong-word') {
      // password was changed on the server since we unlocked — drop back to normal
      alert('❌ The password is no longer valid. Please unlock admin again.');
      setAdminWord(null);
    } else if (result === 'rate-limited') {
      alert('❌ Too many failed attempts. Please wait a few minutes and try again.');
    } else if (result === 'stale') {
      alert(
        '⚠️ The shared roster has changed since this device last loaded it — publishing now would undo those changes.\n\nReload the page to pull the current roster first, then re-apply your edits.',
      );
    } else {
      alert('Could not publish — check your connection and try again.');
    }
  };

  // A titled player wears their theme; everyone else keeps the plain surface.
  const theme = (id: string): string => {
    const t = titles.get(id);
    if (!t) return PLAIN_ROW;
    const { card, glow } = TITLE_THEME[t.kind];
    return glow ? `${card} ${glow}` : card;
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
      number: '',
    });
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
      number: p.number != null ? String(p.number) : '',
    });
  };

  const cancel = () => {
    setDraft(null);
    setEditingId(null);
  };

  const save = () => {
    if (!draft || !draft.name.trim()) return;
    const { aliases, number, ...rest } = draft;
    const trimmedNumber = number.trim();
    const parsedNumber = trimmedNumber === '' ? NaN : Number(trimmedNumber);
    const data = {
      ...rest,
      name: draft.name.trim(),
      aliases: parseAliases(aliases),
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
    cancel();
  };

  const remove = (p: Player) => {
    if (confirm(`Remove ${p.name} from the roster?`)) {
      onChange(players.filter((x) => x.id !== p.id));
      if (editingId === p.id) cancel();
    }
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

  // Rendered either up top (adding a new player, nothing to anchor to yet)
  // or inline in place of the player's own row (editing one) — so editing
  // someone near the bottom of a long roster doesn't yank the page back up
  // to the top of the screen.
  const draftForm = draft && (
    <div className="pop-in space-y-4 rounded-2xl border border-amber-900/20 bg-[#fffdf4]/80 p-4 shadow-sm">
      <h3 className="font-bold text-amber-950">{editingId ? 'Edit player' : 'New player'}</h3>

      <input
        dir="auto"
        // Only for a brand-new player — focusing this on an existing one pops
        // the keyboard open on mobile the instant you tap Edit, which shoves
        // the page around for no reason since you're often just tweaking a
        // rating or role, not the name.
        autoFocus={editingId === null}
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder="Name (עברית or English)"
        className="w-full rounded-lg border border-amber-900/30 bg-white px-3 py-2 text-amber-950 outline-none focus:border-orange-500"
      />

      <div>
        <input
          dir="auto"
          value={draft.aliases}
          onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="Other names people call them, comma-separated (optional)"
          className="w-full rounded-lg border border-amber-900/30 bg-white px-3 py-2 text-sm text-amber-950 outline-none focus:border-orange-500"
        />
        <p className="mt-1 text-xs text-amber-900/50">
          Used to match this player when importing a pasted list on match day.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-amber-900/60">
          Shirt number (optional)
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
          placeholder="e.g. 9"
          className="w-24 rounded-lg border border-amber-900/30 bg-white px-3 py-2 text-amber-950 outline-none focus:border-orange-500"
        />
        <p className="mt-1 text-xs text-amber-900/50">
          Printed on the shirt when sharing teams as images — not shown anywhere else.
          Fine to leave blank, and fine if two players share a number.
        </p>
      </div>

      {(!editingId || isAdmin) && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900/60">
            Rating
          </div>
          {/* fixed 5-up grid rather than wrapping buttons — keeps the rows
              even and the targets thumb-sized on a narrow screen */}
          <div className="grid grid-cols-5 gap-1 sm:flex sm:flex-wrap">
            {RATING_STEPS.map((r) => (
              <button
                key={r}
                onClick={() => setDraft({ ...draft, rating: r })}
                className={`h-10 rounded-lg border text-sm font-bold transition-colors sm:min-w-10 sm:px-1.5 ${
                  draft.rating === r
                    ? 'border-amber-500 bg-amber-500 text-amber-950'
                    : 'border-amber-900/25 bg-white text-amber-900 hover:border-amber-500'
                }`}
              >
                {fmtRating(r)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-900/60">
            Role
          </span>
          <button
            onClick={() => setDraft({ ...draft, isGk: !draft.isGk })}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
              draft.isGk
                ? 'border-sky-600 bg-sky-600/15 text-sky-800'
                : 'border-amber-900/25 bg-white text-amber-900'
            }`}
          >
            🧤 Goalkeeper
          </button>
        </div>

        {draft.isGk ? (
          <p className="rounded-lg border border-amber-900/15 bg-white/60 px-3 py-2.5 text-xs text-amber-900/70">
            Permanent goalkeepers sit outside the outfield spectrum — they're always
            GK-capable on match day.
          </p>
        ) : (
          <div className="rounded-lg border border-amber-900/15 bg-white/60 px-3 py-2.5">
            <div className="mb-1 flex items-center justify-between gap-2 text-sm font-bold text-amber-950">
              <span>
                {STYLE_META[badgeForAttack(draft.attack)].icon}{' '}
                {STYLE_META[badgeForAttack(draft.attack)].label}
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
              aria-label="Position on the defence to attack spectrum"
              className="spectrum-range w-full"
              style={{ '--thumb': spectrumColor(draft.attack) } as CSSProperties}
            />
            <div
              dir="ltr"
              className="flex justify-between text-[11px] font-semibold text-amber-900/50"
            >
              <span>🛡️ Defence</span>
              <span>Attack ⚔️</span>
            </div>
          </div>
        )}
      </div>

      {players.filter((p) => p.id !== editingId).length > 0 && (
        <>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900/60">
              🤝 Plays well with (chemistry)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sorted
                .filter((p) => p.id !== editingId)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => toggleChem(p.id)}
                    className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                      draft.chemistry.includes(p.id)
                        ? 'border-pink-500 bg-pink-500/15 text-pink-700'
                        : 'border-amber-900/25 bg-white text-amber-900/70 hover:border-pink-500/60'
                    }`}
                  >
                    <Name>{p.name}</Name>
                  </button>
                ))}
            </div>
          </div>

          {/* deliberately admin-only: who'd rather not be paired up is
              sensitive, so it isn't shown or editable in normal mode */}
          {isAdmin && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-900/60">
                ↔️ Prefer on separate teams
              </div>
              <p className="mb-1.5 text-xs text-amber-900/50">
                A nudge, not a rule — the balancer splits them when it can, but won't
                wreck the balance to do it. Only visible in admin mode.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sorted
                  .filter((p) => p.id !== editingId)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => toggleAvoid(p.id)}
                      className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                        draft.avoid.includes(p.id)
                          ? 'border-sky-600 bg-sky-600/15 text-sky-800'
                          : 'border-amber-900/25 bg-white text-amber-900/70 hover:border-sky-600/60'
                      }`}
                    >
                      <Name>{p.name}</Name>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* sticky on mobile so Save stays reachable without scrolling back
          down past the chemistry chip lists */}
      <div className="sticky bottom-0 -mx-4 -mb-4 flex gap-2 border-t border-amber-900/10 bg-[#fffdf4]/95 px-4 py-3 backdrop-blur-sm sm:static sm:mx-0 sm:mb-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <button
          onClick={save}
          disabled={!draft.name.trim()}
          className="flex-1 rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-bold text-amber-50 disabled:opacity-40 sm:flex-none"
        >
          Save
        </button>
        <button
          onClick={cancel}
          className="flex-1 rounded-lg border border-amber-900/30 px-5 py-2.5 text-sm font-semibold text-amber-900 sm:flex-none"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="text-right">
        <span
          className="font-mono text-[10px] uppercase tracking-wide text-amber-900/40"
          title="Build version — changes on every deploy"
        >
          v{__GIT_HASH__}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-amber-900/70">
          The permanent squad. Guests are added on match day.
        </p>
        {!draft && (
          <div className="flex gap-2">
            {/* Unlocking and leaving admin both moved to the header, where
                they are reachable from every tab — see App.tsx. */}
            {isAdmin && players.length > 0 && (
              <button
                onClick={publish}
                disabled={publishing}
                className="rounded-lg border border-orange-500 px-3 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                title="Update the roster for everyone"
              >
                {publishing ? 'Publishing…' : '📢 Publish'}
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
                + Add player
              </button>
            )}
          </div>
        )}
      </div>

      {draft && editingId === null && draftForm}

      {sorted.length === 0 && !draft ? (
        <div className="rounded-2xl border border-dashed border-amber-900/30 p-10 text-center text-amber-900/70">
          No players yet — add your squad to get started 🙌
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
                onClick={() => setOpenId(p.id)}
                // Named in the tooltip as well as worn: a coloured card nobody
                // can decode is the mystery-emoji problem the badge key exists
                // to avoid (§2.16).
                title={titles.get(p.id)?.title}
                // the whole row, not a small "view" link: on a phone the row
                // is the target your thumb is already aimed at. It lifts on
                // hover, which is the cheapest way to say "this is a door".
                className={`group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-500/60 hover:shadow-md ${
                  theme(p.id)
                }`}
              >
                {/* The badge's own emoji, set large and nearly transparent at
                    the far edge — a watermark rather than an icon, so it reads
                    as the card's character rather than as another thing to
                    look at. Physically on the left because the row is RTL and
                    the names live on the right. */}
                {titles.get(p.id) && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -bottom-3 left-1 select-none text-6xl opacity-[0.14] transition-opacity duration-200 group-hover:opacity-25"
                  >
                    {titles.get(p.id)!.icon}
                  </span>
                )}
                <div className="relative min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Name className="truncate font-semibold text-amber-950">{p.name}</Name>
                    <span
                      title={STYLE_META[roleBadge(p)].label}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/70 text-xs shadow-sm ring-1 ring-amber-900/10"
                    >
                      {STYLE_META[roleBadge(p)].icon}
                    </span>
                    {isAdmin && !p.isGk && <SpectrumBar attack={p.attack} />}
                    {isAdmin && <Stars rating={p.rating} unknown={p.ratingUnknown} />}
                  </div>
                  {titles.get(p.id) && (
                    <div
                      className={`mt-0.5 text-[11px] font-black uppercase tracking-[0.18em] ${
                        TITLE_THEME[titles.get(p.id)!.kind].ink
                      }`}
                    >
                      {titles.get(p.id)!.title}
                    </div>
                  )}
                  {(p.aliases ?? []).length > 0 && (
                    <div className="mt-0.5 truncate text-xs text-amber-900/50" title="Also known as">
                      aka {p.aliases!.join(', ')}
                    </div>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-amber-950">
                    {p.chemistry.length > 0 && (
                      <span
                        className="min-w-0 max-w-full truncate text-xs text-pink-700/80"
                        title="Plays well with"
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
                        title="Prefer on separate teams (admin only)"
                      >
                        ↔️{' '}
                        {p.avoid!
                          .map((id) => byId.get(id)?.name)
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <>
                    {/* inside a row that is itself a button now, so both of
                        these have to stop the click travelling — an Edit press
                        that also opened the player page would bury the form */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(p);
                      }}
                      className="rounded-lg border border-amber-900/25 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:border-orange-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(p);
                      }}
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
    </div>
  );
}
