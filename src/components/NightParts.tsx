import type { Arcs } from '../playerArcs';
import { rate } from '../playerArcs';

// When in the evening somebody's wins happen (§2.23), redrawn.
//
// The original version of this was four bars labelled `32/49`, `23/44`,
// `19/43`, `29/42`, under the heading "where their wins land". Every number on
// it was true and it was still unreadable, for three separate reasons worth
// writing down because they are easy to repeat:
//
//   1. **Two encodings of two different things.** The bar's height was the win
//      *rate*; the label under it was the raw *fraction*. Nothing said so, so
//      the reader had to work out that the tallest bar was not the one with the
//      biggest number under it.
//   2. **No reference point.** A bar at 65% means nothing on its own. Three
//      teams share one pitch on a winner-stays-on rotation, so a team plays
//      about two matches in three and wins about half of those — "good" is
//      near 50%, not near 100%, and nothing on the card said that either.
//   3. **Four similar bars read as noise**, which is honest and useless. What
//      the card is actually for is the *shape*: does this player start well and
//      fade, or arrive late.
//
// The rate is stated as a percentage in words, the raw count is kept
// underneath as the evidence for it, and a dashed line marks their own average
// across the whole night — every bar is read against that line, so "is 65%
// good" becomes "is this part better than their other two".
//
// **Then four bars became three.** Beginning / middle / end reads as three
// distinct chapters of the evening the way "1st quarter, 2nd quarter, 3rd
// quarter, 4th quarter" reads as a spreadsheet column. It is also more honest
// about the sample: a typical logged night is nine to thirteen matches, so a
// quarter is three matches — routinely the thinnest bar on the card, saying
// the least and taking up as much room as the other three combined. A third
// keeps every bucket closer to four matches, which is still thin but at least
// consistently so.

const LABELS = ['Beginning', 'Middle', 'End'];

// Bars are drawn against a full-height track, so a 100% part fills it. The
// alternative — scaling to the player's best part — makes every profile use a
// different axis and turns three flat bars into a dramatic-looking staircase.
const pct = (r: number) => `${Math.round(r * 100)}%`;

export default function NightParts({ arcs }: { arcs: Arcs }) {
  const overall = arcs.matches > 0 ? arcs.won / arcs.matches : 0;

  return (
    <div>
      <p className="mb-2.5 text-xs leading-4 text-amber-900/55">
        How often they won, by when in the evening the match was played. The dashed line is their{' '}
        <b className="font-bold text-amber-900/75">{pct(overall)}</b> across the whole night — a bar
        above it is a part of the evening they win more of.
      </p>

      <div className="relative h-24 overflow-hidden rounded-xl bg-amber-900/[0.05]">
        <div className="absolute inset-0 flex items-end gap-2 px-2">
          {arcs.parts.map((p, i) => {
            const r = rate(p);
            return (
              <div
                key={i}
                title={`${p.won} of ${p.played} matches won in the ${LABELS[i].toLowerCase()} of the night`}
                className={`flex-1 rounded-t-md ${
                  r === null
                    ? ''
                    : r > overall
                      ? 'bg-gradient-to-t from-orange-600 to-amber-400'
                      : 'bg-gradient-to-t from-orange-400/50 to-amber-300/50'
                }`}
                // A part nobody played gets no bar at all rather than a
                // zero-height one, which would read as "played and lost them
                // all" — the same distinction the medal ribbon draws between a
                // night with no result and a night finished third.
                style={{ height: r === null ? 0 : `${Math.max(r * 100, 2)}%` }}
              />
            );
          })}
        </div>

        {/* Their own average, across all three. Positioned in the same
            coordinate space as the bars — the track has no padding of its own,
            so `bottom: X%` and `height: X%` land on the same line. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-amber-900/40"
          style={{ bottom: `${overall * 100}%` }}
        />
      </div>

      <div className="mt-1.5 flex gap-2">
        {arcs.parts.map((p, i) => {
          const r = rate(p);
          return (
            <div key={i} className="flex-1 text-center">
              <div
                className={`font-mono text-sm font-black tabular-nums ${
                  r === null ? 'text-amber-900/25' : 'text-amber-950'
                }`}
              >
                {r === null ? '—' : pct(r)}
              </div>
              {/* The evidence under the claim: a percentage off three matches
                  and one off forty look identical without it. */}
              <div className="text-[10px] font-semibold leading-tight text-amber-900/40">
                {LABELS[i]}
              </div>
              <div className="font-mono text-[10px] leading-tight text-amber-900/35">
                {p.played ? `${p.won} of ${p.played}` : 'none played'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
