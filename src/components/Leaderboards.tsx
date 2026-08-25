import type { Leaderboard } from '../leaderboards';
import { MEDAL, Name, fmtWins } from './ui';

// The club's podiums (§2.36). The ranking, the tie rule and which counts are
// eligible all live in `leaderboards.ts`; this file only draws what it is
// handed.
//
// **The heading says what was counted, and the number is always on screen.**
// "Most match wins — 123" is a fact anybody can check against the table below
// it. A podium with a name and no number would be the app asserting a ranking
// and asking to be trusted on it, which is the whole thing §2.9 rules out.
//
// **A board can be longer than three names.** Ties share a rank, so a young
// club will often show four or five. Drawing only three would mean picking one
// of two genuinely level players to print and one to hide, and there is no
// honest rule for choosing.

const plural = (n: number, unit: string) => (n === 1 ? unit : `${unit}s`);

function Board({ board }: { board: Leaderboard }) {
  return (
    <section className="rounded-2xl border border-amber-900/10 bg-white/70 p-3.5 shadow-sm ring-1 ring-white/60">
      <h4 className="mb-2 text-[11px] font-black uppercase tracking-wide text-amber-900/60">
        {board.icon} {board.title}
      </h4>
      <ol className="space-y-1.5">
        {board.entries.map((e) => (
          <li key={e.id} className="flex items-center gap-2">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg font-mono text-[11px] font-black shadow-sm ${MEDAL[e.rank as 1 | 2 | 3]}`}
            >
              {e.rank}
            </span>
            {/* The name hugs its medal, and a spacer takes the slack — not a
                flex-1 on the name itself. A `bdi` sets its own direction, so a
                Hebrew name inside a stretched box aligns to that box's right
                edge and drifts a couple of centimetres away from the medal it
                belongs to, while an English one would not. A spacer puts them
                side by side in either direction. */}
            <Name className="min-w-0 truncate font-bold text-amber-950">{e.name}</Name>
            <span className="flex-1" />
            <span className="shrink-0 font-mono text-sm font-black tabular-nums text-amber-950">
              {board.half ? fmtWins(e.value) : e.value}
              <span className="ml-1 font-sans text-[10px] font-semibold text-amber-900/45">
                {plural(e.value, board.unit)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function Leaderboards({ boards }: { boards: Leaderboard[] }) {
  if (boards.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {boards.map((b) => (
        <Board key={b.key} board={b} />
      ))}
    </div>
  );
}
