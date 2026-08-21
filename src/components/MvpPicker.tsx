import type { TeamColor } from '../types';
import { TEAM_COLORS } from '../balancer';
import { TEAM_META } from './ui';

interface Props {
  // just id/name — works for a live squad (Player[]) and a past night's
  // FixturePlayer[] snapshot alike, since neither is needed beyond that
  players: { id: string; name: string }[];
  mvpId: string | null;
  onChange: (id: string | null) => void;
  // whose players these are: the team that won the night, or every team that
  // tied for it. Shown so the short list reads as a rule rather than a bug.
  winners: TeamColor[];
}

// Optional, and deliberately simple — a single dropdown. Unlike everything
// else the app records, this is the organiser's own call rather than something
// read off the scoreboard; see src/mvp.ts for why that's fine to just count
// afterwards.
//
// It used to sit on the fixture page, asked while the night was still being
// played. That was the wrong moment: the standout player isn't known until the
// football stops. So it lives on History now, attached to a night that has
// already finished, where the question can actually be answered.
//
// The list is the winning team only (both, on a tie) — the house rule, applied
// by not offering anyone else. `mvpCandidates` in src/mvp.ts decides who that
// is; this just draws them.
export default function MvpPicker({ players, mvpId, onChange, winners }: Props) {
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const shirts = winners.map((c) => `${TEAM_META[c].emoji} ${TEAM_META[c].label}`);
  return (
    <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <h3 className="mb-1 font-bold text-amber-950">🌟 MVP</h3>
      <p className="mb-3 text-xs text-amber-900/60">
        Optional — your pick for this night's standout player.{' '}
        {shirts.length === 1 ? (
          <>
            From <b>{shirts[0]}</b>, who won the night.
          </>
        ) : shirts.length === TEAM_COLORS.length ? (
          <>The night finished level, so anyone who played.</>
        ) : (
          <>
            From <b>{shirts.join(' and ')}</b>, level at the top.
          </>
        )}
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
