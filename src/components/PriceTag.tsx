import type { PlayerValue } from '../values';
import { formatValue, moveOf } from '../values';

// The price tag on a player's page (§2.31).
//
// The hard part of this component is the caption, not the number. A euro figure
// beside somebody's name is read as *the app's opinion of them* unless it says
// otherwise, and the app does not have opinions — that is the whole of §2.9,
// and it is exactly what the rating being private is protecting. So the line
// underneath names its ingredients, all of which are things that happened
// rather than things anybody thinks: results, appearances, honours.
//
// It also never renders at all rather than rendering an absence. No price is
// the correct state for an offline phone, a Worker not yet deployed, a club
// with fewer than five nights on record, and a player who has not played —
// four quite different reasons that all mean "not yet", and none of which is
// worth a sentence on somebody's profile.

const MOVE_TONE = {
  up: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-800',
  down: 'border-rose-600/25 bg-rose-500/10 text-rose-800',
  flat: 'border-amber-900/15 bg-white/60 text-amber-900/45',
  new: 'border-amber-900/15 bg-white/60 text-amber-900/50',
} as const;

export default function PriceTag({ price }: { price?: PlayerValue }) {
  if (!price) return null;
  const move = moveOf(price);

  return (
    <div className="relative mt-3 flex flex-wrap items-end gap-x-3 gap-y-1 border-t border-amber-900/10 pt-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-900/45">
          Market value
        </p>
        <p className="font-mono text-2xl font-black leading-none tracking-tight text-amber-950 sm:text-3xl">
          {formatValue(price.value)}
        </p>
      </div>

      {/* The arrow carries a sign and a glyph as well as a colour, so it still
          reads on a bad screen and to anyone who cannot separate the two
          tones. */}
      <span
        className={`rounded-full border px-2 py-0.5 text-[11px] font-black tabular-nums ${MOVE_TONE[move.dir]}`}
      >
        {move.dir === 'new'
          ? 'first valuation'
          : move.dir === 'flat'
            ? '— unchanged'
            : `${move.dir === 'up' ? '▲ +' : '▼ −'}${formatValue(move.by)}`}
      </span>

      <p className="w-full text-[11px] leading-4 text-amber-900/45">
        Results, appearances and honours, priced. Moves after every night.
      </p>
    </div>
  );
}
