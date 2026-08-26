import { useMemo, useState } from 'react';
import {
  DEFAULT_RANGE,
  FORM_NIGHTS,
  RANGES,
  inRange,
  meanGrade,
  rangeCounts,
  recentForm,
  type GradePoint,
  type GradeRange,
} from '../gradeHistory';
import { MEDAL, Name, TEAM_META, fmtRating, fmtWins } from './ui';

// A player's recent form (§2.40), in the shape every football screen uses for
// it: a row of coloured squares, a summary of the last few, and a table with a
// mark on the end of each row.
//
// **This replaced a line chart, and the reason is worth keeping.** The graph
// was drawing a continuous trend through points that are a week apart, which
// invites reading a slope into what is really five separate evenings — and it
// spent most of its pixels on the empty space between them. Squares and rows
// say the same thing without implying anything between the nights.
//
// **The columns are what a night actually knows.** The screens this is modelled
// on show minutes, xG, goals and assists; this app records none of those,
// because nobody writes them down (§2.24). What it does record is the shirt,
// what the team took, where they finished and the player-of-the-night pick, so
// those are the columns. Inventing the others is the exact failure the grades
// prompt spends three paragraphs preventing.

// Five steps rather than the three `NightGrades` uses for its chip. A form
// strip is read as a *gradient* — the eye is looking for a run of green or a
// slide into red — and three tones cannot show a slide. Written out in full
// because Tailwind only ships class names it can see in the source.
const TONE = [
  { min: 8, block: 'bg-emerald-500', pill: 'bg-emerald-500/15 text-emerald-800 ring-emerald-600/25' },
  { min: 7, block: 'bg-lime-500', pill: 'bg-lime-500/20 text-lime-900 ring-lime-700/25' },
  { min: 6, block: 'bg-amber-400', pill: 'bg-amber-400/25 text-amber-900 ring-amber-700/25' },
  { min: 5, block: 'bg-orange-400', pill: 'bg-orange-500/15 text-orange-800 ring-orange-700/25' },
  { min: 0, block: 'bg-rose-500', pill: 'bg-rose-500/15 text-rose-800 ring-rose-700/25' },
] as const;

const toneOf = (grade: number) => TONE.find((t) => grade >= t.min) ?? TONE[TONE.length - 1];

const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
};

/** How many rows before the table folds — see PlayerTimeline for the same trade. */
const PAGE = 8;

export default function GradeForm({ points }: { points: GradePoint[] }) {
  const [range, setRange] = useState<GradeRange>(DEFAULT_RANGE);
  const [all, setAll] = useState(false);

  // Read once per mount: a window that shifted mid-read would move the rows
  // under somebody's thumb.
  const now = useMemo(() => Date.now(), []);
  const counts = useMemo(() => rangeCounts(points, now), [points, now]);
  const shown = useMemo(() => inRange(points, range, now), [points, range, now]);

  const strip = recentForm(shown);
  const stripMean = meanGrade(strip);
  const won = strip.filter((p) => p.wonNight).length;
  const mvps = strip.filter((p) => p.isMvp).length;

  // Newest first: the question this card answers is "how has it been lately",
  // and the answer to that belongs at the top rather than eight rows down.
  const rows = [...shown].reverse();
  const visible = all ? rows : rows.slice(0, PAGE);

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => {
              setRange(r.id);
              setAll(false);
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
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl bg-amber-900/[0.04] px-3 py-6 text-center text-xs text-amber-900/50">
          No graded nights in this window.
          {counts.ALL > 0 && ' Try a longer one.'}
        </p>
      ) : (
        <>
          {/* The strip and its summary. Oldest on the left, so a run reads
              left-to-right the way the dates below it run. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-900/10 pb-3">
            <div className="flex gap-1" aria-hidden>
              {strip.map((p) => (
                <span
                  key={p.fixtureId}
                  title={`${shortDate(p.date)} — ${fmtRating(p.grade)}`}
                  className={`h-7 w-7 rounded-md ${toneOf(p.grade).block}`}
                />
              ))}
            </div>

            {/* Counts, not goals and assists — the two per-night facts this app
                actually holds about a person rather than a team. */}
            <div className="flex items-center gap-4 text-center">
              <Summary n={String(won)} label={`won of last ${strip.length}`} />
              <Summary n={String(mvps)} label={`MVP of last ${strip.length}`} />
            </div>

            {stripMean !== null && (
              <div className="ms-auto text-end">
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-sm font-black tabular-nums ring-1 ${
                    toneOf(stripMean).pill
                  }`}
                >
                  {fmtRating(Math.round(stripMean * 100) / 100)}
                </span>
                <div className="mt-0.5 text-[10px] text-amber-900/45">
                  last {strip.length} night{strip.length === 1 ? '' : 's'}
                </div>
              </div>
            )}
          </div>

          <table className="mt-1 w-full text-[12px]">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wide text-amber-900/40">
                <th className="py-1 text-start font-bold">Date</th>
                <th className="py-1 text-start font-bold">Night</th>
                <th className="py-1 text-end font-bold">Took</th>
                <th className="py-1 text-end font-bold">Mark</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.fixtureId} className="border-t border-amber-900/[0.07]">
                  <td className="py-1.5 tabular-nums text-amber-900/60">{shortDate(p.date)}</td>
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      {/* The medal is the placing, in the same three colours
                          the night ribbon uses — one visual language for
                          "where did they finish" across the app.

                          A shared placing is marked "=1", the way every sports
                          table marks a tie. Without it a gold 1 sits next to a
                          summary reading "0 won of last 5" and looks like a
                          bug, when it is §2.6 doing exactly its job: level at
                          the top means nobody took the night. */}
                      {p.place !== null && (
                        <span
                          title={p.shared ? `Level on ${p.place}` : `Finished ${p.place}`}
                          className={`grid h-4 min-w-[1rem] shrink-0 place-items-center rounded px-0.5 font-mono text-[9px] font-black ${MEDAL[p.place]}`}
                        >
                          {p.shared ? `=${p.place}` : p.place}
                        </span>
                      )}
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${TEAM_META[p.shirt].tile}`}>
                        <Name>{TEAM_META[p.shirt].label}</Name>
                      </span>
                      {p.isMvp && <span title="Player of the night">🌟</span>}
                    </span>
                  </td>
                  <td className="py-1.5 text-end tabular-nums text-amber-900/70">
                    {fmtWins(p.teamWins)}
                  </td>
                  <td className="py-1.5 text-end">
                    <span
                      className={`inline-block min-w-[34px] rounded-full px-1.5 py-0.5 text-center font-mono text-[11px] font-black tabular-nums ring-1 ${
                        toneOf(p.grade).pill
                      }`}
                    >
                      {fmtRating(p.grade)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length > PAGE && (
            <button
              onClick={() => setAll(!all)}
              className="mt-2 w-full rounded-lg border border-amber-900/15 py-1 text-[11px] font-bold text-amber-900/60 hover:border-orange-500 hover:text-orange-700"
            >
              {all ? '▲ Show fewer' : `▼ All ${rows.length} nights`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

const Summary = ({ n, label }: { n: string; label: string }) => (
  <div>
    <div className="font-mono text-sm font-black tabular-nums text-amber-950">{n}</div>
    <div className="text-[10px] leading-tight text-amber-900/45">{label}</div>
  </div>
);
