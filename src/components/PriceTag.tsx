import type { PlayerValue } from '../values';
import { formatValue, moveOf } from '../values';

// The price tag on a player's page (§2.31).
//
// One line: the price, the weekly move beside it, and a short caption under
// both. Not a card of its own — an eyebrow label, a 3xl price, a border-top
// divider and a full sentence made it read as a second panel bolted onto the
// header rather than a fact about the person it is next to.
//
// **The caption stays, and stays visible — that part is not negotiable.** A
// euro figure beside somebody's name is read as *the app's opinion of them*
// unless it says otherwise, and the app does not have opinions (§2.9); that is
// exactly what the rating being private is protecting. Hiding the caption
// behind a tap would mean a first glance shows a bare price with no defence
// against being misread as one — so what shrank is the sentence, not whether
// it is shown. "Priced from results, appearances and honours — not a rating"
// says the same thing the original two clauses did in fewer words, and says
// the important half of it in words rather than leaving it implied.
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
    <div className="relative mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="font-mono text-lg font-black tracking-tight text-amber-950">
        {formatValue(price.value)}
      </span>

      {/* The arrow carries a sign and a glyph as well as a colour, so it still
          reads on a bad screen and to anyone who cannot separate the two
          tones. */}
      <span
        className={`rounded-full border px-1.5 py-0.5 text-[10px] font-black tabular-nums ${MOVE_TONE[move.dir]}`}
      >
        {move.dir === 'new'
          ? 'first valuation'
          : move.dir === 'flat'
            ? '— unchanged'
            : `${move.dir === 'up' ? '▲ +' : '▼ −'}${formatValue(move.by)}`}
      </span>

      <span className="w-full text-[10px] leading-tight text-amber-900/45">
        Priced from results, appearances and honours — not a rating.
      </span>
    </div>
  );
}
