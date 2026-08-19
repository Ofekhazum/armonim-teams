import type { Player } from '../types';

interface Props {
  players: Player[]; // tonight's squad to choose from
  mvpId: string | null;
  onChange: (id: string | null) => void;
}

// Optional, and deliberately simple — a single dropdown, saved alongside the
// result rather than as its own step. Unlike everything else on this page,
// this is the organiser's own call, not something read off the scoreboard;
// see src/mvp.ts for why that's fine to just count afterwards.
export default function MvpPicker({ players, mvpId, onChange }: Props) {
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return (
    <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <h3 className="mb-1 font-bold text-amber-950">🌟 Tonight's MVP</h3>
      <p className="mb-3 text-xs text-amber-900/60">
        Optional — your own pick for tonight's standout player, saved alongside the result.
      </p>
      <select
        value={mvpId ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-lg border border-amber-900/30 bg-white px-3 py-2 text-sm font-semibold text-amber-950 outline-none focus:border-orange-500"
      >
        <option value="">No pick</option>
        {sorted.map((p) => (
          <option key={p.id} value={p.id} dir="auto">
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
