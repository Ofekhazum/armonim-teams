import { useState } from 'react';
import type { Player, Playstyle } from '../types';
import { uid } from '../storage';
import { publishRemoteRoster, setLocalRosterVersion, verifyWord, REMOTE_URL } from '../remote';
import { fmtRating, Name, RATING_STEPS, Stars, STYLE_META } from './ui';

interface Props {
  players: Player[];
  onChange: (players: Player[]) => void;
  adminWord: string | null;
  setAdminWord: (word: string | null) => void;
}

interface Draft {
  name: string;
  rating: number;
  playstyle: Playstyle;
  chemistry: string[];
  avoid: string[];
}

const STYLES: Playstyle[] = ['defensive', 'mixed', 'attacking', 'gk'];

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
    setDraft({ name: '', rating: 3, playstyle: 'mixed', chemistry: [], avoid: [] });
  };

  const startEdit = (p: Player) => {
    setEditingId(p.id);
    setDraft({
      name: p.name,
      rating: p.rating,
      playstyle: p.playstyle,
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
    const data = { ...draft, name: draft.name.trim() };
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

          <div className="flex flex-wrap gap-6">
            {(!editingId || isAdmin) && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900/60">
                  Rating
                </div>
                <div className="flex flex-wrap gap-1">
                  {RATING_STEPS.map((r) => (
                    <button
                      key={r}
                      onClick={() => setDraft({ ...draft, rating: r })}
                      className={`h-9 min-w-9 rounded-lg border px-1.5 text-xs font-bold transition-colors ${
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
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900/60">
                Playstyle
              </div>
              <div className="flex gap-1">
                {STYLES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setDraft({ ...draft, playstyle: s })}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                      draft.playstyle === s
                        ? 'border-sky-600 bg-sky-600/15 text-sky-800'
                        : 'border-amber-900/25 bg-white text-amber-900 hover:border-sky-600/60'
                    }`}
                  >
                    {STYLE_META[s].icon} {STYLE_META[s].label}
                  </button>
                ))}
              </div>
            </div>
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
                        className={`rounded-full border px-3 py-1 text-sm transition-colors ${
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
                        className={`rounded-full border px-3 py-1 text-sm transition-colors ${
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

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={!draft.name.trim()}
              className="rounded-lg bg-orange-600 px-5 py-2 text-sm font-bold text-amber-50 disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={cancel}
              className="rounded-lg border border-amber-900/30 px-5 py-2 text-sm font-semibold text-amber-900"
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
                  <span title={STYLE_META[p.playstyle].label}>{STYLE_META[p.playstyle].icon}</span>
                  {isAdmin && <Stars rating={p.rating} unknown={p.ratingUnknown} />}
                </div>
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
