interface Props {
  // just id/name — works for a live squad (Player[]) and a past night's
  // FixturePlayer[] snapshot alike, since neither is needed beyond that
  players: { id: string; name: string }[];
  mvpId: string | null;
  onChange: (id: string | null) => void;
  title?: string;
  description?: string;
}

// Optional, and deliberately simple — a single dropdown, saved alongside the
// result rather than as its own step. Unlike everything else on this page,
// this is the organiser's own call, not something read off the scoreboard;
// see src/mvp.ts for why that's fine to just count afterwards. Also reused
// by History.tsx to add or correct the pick on a past night, with different
// copy passed in (a night that already happened isn't "tonight").
export default function MvpPicker({
  players,
  mvpId,
  onChange,
  title = "🌟 Tonight's MVP",
  description = "Optional — your own pick for tonight's standout player, saved alongside the result.",
}: Props) {
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return (
    <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <h3 className="mb-1 font-bold text-amber-950">{title}</h3>
      <p className="mb-3 text-xs text-amber-900/60">{description}</p>
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
