import type { Derby } from '../derby';
import { Name, TEAM_META } from './ui';

// Tonight's derby (§2.33) — the one card on a match night that is about a
// rivalry rather than a record.
//
// **Both names are the same size, and that is the point.** Every other pick in
// this app has a subject: a milestone belongs to one player, a bounty is on
// one player, a bogey man is somebody else's problem. This one is symmetric by
// construction — the metric counts matches that have gone *each* way — so the
// layout has to be symmetric too, or the reader will decide the one on the
// left is the favourite and the app will have implied something it did not
// count.
//
// The shirts do the colouring, so the banner belongs to tonight rather than to
// the two of them: this pairing is only a derby *because of how the teams came
// out*, and next week they will probably be on the same side.

export default function DerbyBanner({ derby }: { derby: Derby | null }) {
  if (!derby) return null;

  const a = TEAM_META[derby.aShirt];
  const b = TEAM_META[derby.bShirt];
  // Level is worth saying out loud; anything else lets the numbers speak.
  const level = derby.aWon === derby.bWon;

  return (
    <div className="rounded-2xl border border-violet-500/25 bg-gradient-to-r from-violet-100/70 via-[#fffdf4] to-violet-100/70 px-4 py-2.5">
      <h3 className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-violet-900/70">
        ⚔️ Tonight's derby
      </h3>

      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
        <span className="text-base font-black text-amber-950">
          {a.emoji} <Name>{derby.aName}</Name>
        </span>

        {/* The record itself, as the scoreline it is. Tabular figures so the
            two halves are the same width and neither reads as the bigger
            number by accident of typography. */}
        <span className="font-mono text-lg font-black tabular-nums text-violet-900">
          {derby.aWon}–{derby.bWon}
        </span>

        <span className="text-base font-black text-amber-950">
          {b.emoji} <Name>{derby.bName}</Name>
        </span>
      </div>

      {/* The evidence, and the only sentence on the card. Says what was counted
          — matches, on opposite sides — because "12–12" on its own could be
          nights, goals or anything else, and this app has never counted a goal
          in its life (§2.9). */}
      <p className="mt-1 text-center text-[11px] text-violet-900/60">
        {derby.faced} matches on opposite sides
        {level ? ', and dead level' : ''}
      </p>
    </div>
  );
}
