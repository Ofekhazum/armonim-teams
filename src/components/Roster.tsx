import { useState } from 'react';
import type { Player } from '../types';
import { ATTACK_DEFAULT, ATTACK_STEP, attackLabel, badgeForAttack, roleBadge } from '../types';
import { uid } from '../storage';
import { publishRemoteRoster, setLocalRosterVersion, verifyWord, REMOTE_URL } from '../remote';
import { fmtRating, Name, RATING_STEPS, SpectrumBar, Stars, STYLE_META } from './ui';

interface Props {
  players: Player[];
  onChange: (players: Player[]) => void;
  adminWord: string | null;
  setAdminWord: (word: string | null) => void;
}

interface Draft {
  name: string;
  aliases: string; // comma-separated, as typed
  rating: number;
  isGk: boolean;
  attack: number;
  chemistry: string[];
  avoid: string[];
}

const parseAliases = (raw: string): string[] =>
  [...new Set(raw.split(',').map((a) => a.trim()).filter(Boolean))];

export default function Roster({ players, onChange, adminWord, setAdminWord }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const isAdmin = adminWord !== null;

  // Prompt for the secret word and, if the worker accepts it, unlock admin
  // mode (edit ratings + publish). The word is verified server-side.
  const unlockAdmin = async () => {
    const word = window.prompt('Enter the admin password:');
    if (word == null) return; // cancelled
    setUnlocking(true);
    const result = await verifyWord(word.trim());
    setUnlocking(false);
    if (result === 'ok') {
      setAdminWord(word.trim());
    } else if (result === 'wrong-word') {
      alert('❌ Wrong password.');
    } else if (result === 'not-configured') {
      alert('The shared roster is not set up yet (REMOTE_URL is empty in remote.ts).');
    } else {
      alert('Could not reach the server — check your connection and try again.');
    }
  };

  // Push the current roster to everyone, using the already-unlocked word.
  const publish = async () => {
    if (adminWord == null) return;
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
    } else {
      alert('Could not publish — check your connection and try again.');
    }
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
    });
  };

  const cancel = () => {
    setDraft(null);
    setEditingId(null);
  };

  const save = () => {
    if (!draft || !draft.name.trim()) return;
    const { aliases, ...rest } = draft;
    const data = { ...rest, name: draft.name.trim(), aliases: parseAliases(aliases) };
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
            {REMOTE_URL && !isAdmin && (
              <button
                onClick={unlockAdmin}
                disabled={unlocking}
                className="rounded-lg border border-amber-900/30 px-3 py-2 text-sm font-semibold text-amber-900 hover:border-orange-500 disabled:opacity-50"
                title="Unlock admin mode to edit ratings and publish"
              >
                {unlocking ? 'Checking…' : '🔒 Admin'}
              </button>
            )}
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
            {isAdmin && (
              <button
                onClick={() => setAdminWord(null)}
                className="rounded-lg border border-amber-900/30 px-3 py-2 text-sm font-semibold text-amber-900 hover:border-orange-500"
                title="Leave admin mode"
              >
                Exit
              </button>
            )}
            <button
              onClick={startAdd}
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-amber-50 shadow-sm transition-transform hover:scale-105"
            >
              + Add player
            </button>
          </div>
        )}
      </div>

      {draft && (
        <div className="pop-in space-y-4 rounded-2xl border border-amber-900/20 bg-[#fffdf4]/80 p-4 shadow-sm">
          <h3 className="font-bold text-amber-950">{editingId ? 'Edit player' : 'New player'}</h3>

          <input
            dir="auto"
            autoFocus
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
                <input
                  dir="ltr"
                  type="range"
                  min={0}
                  max={100}
                  step={ATTACK_STEP}
                  value={draft.attack}
                  onChange={(e) => setDraft({ ...draft, attack: Number(e.target.value) })}
                  aria-label="Position on the defence to attack spectrum"
                  className="h-6 w-full accent-orange-600"
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

              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900/60">
                  🥊 Doesn't click with (keep on different teams)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sorted
                    .filter((p) => p.id !== editingId)
                    .map((p) => (
                      <button
                        key={p.id}
                        onClick={() => toggleAvoid(p.id)}
                        className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                          draft.avoid.includes(p.id)
                            ? 'border-red-500 bg-red-500/15 text-red-700'
                            : 'border-amber-900/25 bg-white text-amber-900/70 hover:border-red-500/60'
                        }`}
                      >
                        <Name>{p.name}</Name>
                      </button>
                    ))}
                </div>
              </div>
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
      )}

      {sorted.length === 0 && !draft ? (
        <div className="rounded-2xl border border-dashed border-amber-900/30 p-10 text-center text-amber-900/70">
          No players yet — add your squad to get started 🙌
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {sorted.map((p) => (
            <li
              key={p.id}
              dir="rtl"
              className="flex items-center gap-3 rounded-xl border border-amber-900/15 bg-[#fffdf4]/70 px-4 py-3 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Name className="truncate font-semibold text-amber-950">{p.name}</Name>
                  <span title={STYLE_META[roleBadge(p)].label}>{STYLE_META[roleBadge(p)].icon}</span>
                  {!p.isGk && <SpectrumBar attack={p.attack} />}
                  {isAdmin && <Stars rating={p.rating} unknown={p.ratingUnknown} />}
                </div>
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
                  {(p.avoid ?? []).length > 0 && (
                    <span
                      className="min-w-0 max-w-full truncate text-xs text-red-700/80"
                      title="Keep on different teams"
                    >
                      🥊{' '}
                      {p.avoid!
                        .map((id) => byId.get(id)?.name)
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => startEdit(p)}
                className="rounded-lg border border-amber-900/25 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:border-orange-500"
              >
                Edit
              </button>
              <button
                onClick={() => remove(p)}
                className="rounded-lg border border-amber-900/25 px-2.5 py-1 text-xs font-semibold text-red-600 hover:border-red-500"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
