import { useMemo, useState } from 'react';
import { GRADE_MAX, GRADE_MIN, BASE } from '../grades';
import {
  DEFAULT_RANGE,
  RANGES,
  inRange,
  meanGrade,
  rangeCounts,
  type GradePoint,
  type GradeRange,
} from '../gradeHistory';
import { fmtRating } from './ui';

// A player's marks over time (§2.39), drawn as a line.
//
// **Hand-rolled SVG, because the alternative is a dependency.** This project
// runs on `react` and `react-dom` and nothing else; a charting library for one
// graph would be the largest thing in the bundle by some distance, and the
// chart it drew would still need every decision below made by hand. Roughly
// eighty lines of `<path>` is the cheaper end of that trade.
//
// **The y-axis is pinned to the full 1–10 and never scaled to the data**, which
// is the single most important decision here. A chart fitted to its own range
// turns a season spent between 5.5 and 6.5 into a dramatic mountain, and that
// is a lie told in the reader's favour. Pinned, an ordinary run looks ordinary
// and a real collapse looks like one — the same reasoning `NightParts` records
// for its dashed average, and the same failure the league scatter's MIN_Y_SPAN
// exists to prevent.
//
// **The x-axis is real time, not one step per night.** Somebody who missed six
// weeks should have six weeks of empty graph, for exactly the reason
// `PlayerTimeline` gives about its rail: the gaps are as much of a career as
// the events, and evenly spacing the points would quietly delete them.

// Room for the axis labels, inside a viewBox everything else is measured in.
const W = 320;
const H = 132;
const PAD = { top: 10, right: 8, bottom: 18, left: 20 };
const PLOT = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };

const y = (grade: number) =>
  PAD.top + PLOT.h * (1 - (grade - GRADE_MIN) / (GRADE_MAX - GRADE_MIN));

/**
 * Where a point sits along the time axis.
 *
 * A single point has no span to sit inside, so it goes in the middle rather
 * than at `t = 0` — one night is a fact about a night, not a trend that began
 * at the left edge.
 */
const xOf = (t: number, from: number, to: number) =>
  to === from ? PAD.left + PLOT.w / 2 : PAD.left + (PLOT.w * (t - from)) / (to - from);

const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
};

export default function GradeGraph({ points }: { points: GradePoint[] }) {
  const [range, setRange] = useState<GradeRange>(DEFAULT_RANGE);
  const [picked, setPicked] = useState<string | null>(null);

  // `now` is read once per mount rather than per render: a window that shifts
  // underneath a reader mid-interaction would move the points while they are
  // trying to touch one.
  const now = useMemo(() => Date.now(), []);
  const counts = useMemo(() => rangeCounts(points, now), [points, now]);
  const shown = useMemo(() => inRange(points, range, now), [points, range, now]);

  const from = shown.length > 0 ? shown[0].t : 0;
  const to = shown.length > 0 ? shown[shown.length - 1].t : 0;
  const mean = meanGrade(shown);

  const selected = shown.find((p) => p.fixtureId === picked) ?? null;

  const coords = shown.map((p) => ({ p, x: xOf(p.t, from, to), cy: y(p.grade) }));
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.cy.toFixed(1)}`).join(' ');
  const area =
    coords.length > 1
      ? `M${coords[0].x.toFixed(1)},${(PAD.top + PLOT.h).toFixed(1)} L${line
          .split(' ')
          .join(' L')} L${coords[coords.length - 1].x.toFixed(1)},${(PAD.top + PLOT.h).toFixed(1)} Z`
      : '';

  return (
    <div>
      {/* The controls first, because which window you are looking at changes
          what the line means, and reading the line before knowing that is
          reading it wrong. */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => {
              setRange(r.id);
              setPicked(null);
            }}
            aria-pressed={range === r.id}
            className={`rounded-lg px-2 py-0.5 text-[11px] font-bold transition-colors ${
              range === r.id
                ? 'bg-orange-600 text-amber-50'
                : counts[r.id] === 0
                  ? 'text-amber-900/30 hover:text-amber-900/50'
                  : 'text-amber-900/70 hover:text-orange-700'
            }`}
          >
            {r.label}
          </button>
        ))}
        {/* The readout lives here rather than floating over the line: a
            tooltip that covers the chart on a phone hides the thing it is
            describing. Holds the row's height whether or not anything is
            selected, so picking a point never shifts the graph. */}
        <span className="ms-auto min-h-[16px] text-[11px] tabular-nums text-amber-900/60">
          {selected ? (
            <>
              <b className="text-amber-950">{fmtRating(selected.grade)}</b> on {shortDate(selected.date)}
            </>
          ) : mean !== null ? (
            <>average {fmtRating(Math.round(mean * 2) / 2)}</>
          ) : null}
        </span>
      </div>

      {shown.length === 0 ? (
        // Empty is a real answer here, not a failure — see `inRange` for why
        // the window is anchored to today. Says which way to go rather than
        // leaving somebody to guess the graph is broken.
        <p className="rounded-xl bg-amber-900/[0.04] px-3 py-6 text-center text-xs text-amber-900/50">
          No graded nights in this window.
          {counts.ALL > 0 && ' Try a longer one.'}
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none"
          role="img"
          aria-label={`Grades over time: ${shown.length} night${shown.length === 1 ? '' : 's'}`}
        >
          {/* Gridlines every two marks. Recessive on purpose: they are the
              ruler, not the reading. */}
          {[2, 4, 6, 8, 10].map((g) => (
            <line
              key={g}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(g)}
              y2={y(g)}
              className="stroke-amber-900/10"
              strokeWidth={1}
            />
          ))}
          {[GRADE_MAX, BASE, GRADE_MIN].map((g) => (
            <text
              key={g}
              x={PAD.left - 4}
              y={y(g) + 3}
              textAnchor="end"
              className="fill-amber-900/35 text-[8px] tabular-nums"
            >
              {g}
            </text>
          ))}

          {/* Their own average across what is on screen. The reference point
              that makes a single mark readable — the same job the dashed line
              does in NightParts. */}
          {mean !== null && shown.length > 1 && (
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(mean)}
              y2={y(mean)}
              className="stroke-orange-600/45"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {area && <path d={area} className="fill-orange-500/10" />}
          {coords.length > 1 && (
            <polyline
              points={line}
              fill="none"
              className="stroke-orange-600"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {coords.map(({ p, x, cy }) => (
            <circle
              key={p.fixtureId}
              cx={x}
              cy={cy}
              r={selected?.fixtureId === p.fixtureId ? 4.5 : 3}
              className={
                selected?.fixtureId === p.fixtureId
                  ? 'fill-amber-950 stroke-[#fffdf4]'
                  : 'fill-orange-600 stroke-[#fffdf4]'
              }
              strokeWidth={1.5}
            />
          ))}

          {/* Hit targets, drawn last so they sit above everything, and far
              bigger than the dots. A 3px circle is not a tap target on a
              phone; at fifty nights across 300px the dots are also closer
              together than a fingertip, so each one gets the whole column of
              chart nearest to it rather than its own outline. */}
          {coords.map(({ p, x }, i) => {
            const left = i === 0 ? PAD.left : (coords[i - 1].x + x) / 2;
            const right = i === coords.length - 1 ? W - PAD.right : (coords[i + 1].x + x) / 2;
            return (
              <rect
                key={p.fixtureId}
                x={left}
                y={PAD.top}
                width={Math.max(right - left, 1)}
                height={PLOT.h}
                fill="transparent"
                className="cursor-pointer"
                onPointerDown={() => setPicked(picked === p.fixtureId ? null : p.fixtureId)}
                onPointerEnter={() => setPicked(p.fixtureId)}
              >
                <title>{`${shortDate(p.date)} — ${fmtRating(p.grade)}`}</title>
              </rect>
            );
          })}

          {/* Only the ends of the window get a date. One label per night turns
              the axis into a wall of numbers at any range past a fortnight. */}
          <text
            x={PAD.left}
            y={H - 5}
            className="fill-amber-900/35 text-[8px] tabular-nums"
          >
            {shortDate(shown[0].date)}
          </text>
          {shown.length > 1 && (
            <text
              x={W - PAD.right}
              y={H - 5}
              textAnchor="end"
              className="fill-amber-900/35 text-[8px] tabular-nums"
            >
              {shortDate(shown[shown.length - 1].date)}
            </text>
          )}
        </svg>
      )}
    </div>
  );
}
