import { useEffect, useRef, useState } from 'react';
import { MARK_STEP, parseEvents, serialiseEvents, type Marked } from '../eventMarks';
import { t } from '../i18n';

/**
 * The night's events, edited as a list (§2.58).
 *
 * **What this replaces, and why it had to go.** A fixture stores its note as
 * one string, so both places that edit one handed the organiser a two-row
 * textarea containing the raw stored form:
 *
 *     @שאפו לסרן יועד שעשה שינוי בכוחות ברגע האחרון בזמן שהוא עושה מילואים
 *     בעזה.@ @מילה טובה לשי שהיה מעולה ושם 4 גולים.@
 *
 * Three separate things are wrong with that, and they compound. The `@`
 * delimiters are load-bearing syntax being maintained by hand. In a
 * right-to-left line they render where the eye does not expect them, so it is
 * genuinely hard to see which `@` closes which event. And with the text
 * wrapping across rows there is no visual boundary at all between one event
 * and the next — the screenshot that prompted this shows two events reading as
 * one paragraph.
 *
 * So the list stops being something the organiser types and becomes something
 * they see: one box per event, add and remove as buttons, and the delimiters
 * written by `serialiseEvents` on the way out. Nobody has to know `@` exists.
 *
 * **The markers become a stepper, which is the bigger win.** §2.57 let a note
 * move a mark by typing `+`, and typing punctuation at the end of an RTL line
 * is exactly the kind of instruction people follow wrongly and then cannot see
 * that they followed wrongly. A stepper says what the event is currently worth
 * in points, which is the thing the organiser actually wants to know.
 *
 * Typed markers still parse, because notes filed before this exist and because
 * `parseEvents` is the same function on both paths.
 */

// How far the stepper will go in one direction: ±3.0 on a mark out of ten.
//
// A cap on the *control*, not on the formula — `eventMarks` nets however many
// markers a note carries, and a note typed by hand can still say more than
// this. It is here because three points already outweighs every other term in
// the grade formula put together, so a stepper that kept going would only ever
// be answering a mis-click.
const MAX_STEPS = 6;

interface Props {
  /** The stored note, in whatever shape it was written. */
  value: string;
  /** Called with the serialised note — `@…@` form, ready to store. */
  onChange: (next: string) => void;
  /** `NOTE_MAX`. Measured against the serialised string, delimiters included. */
  max: number;
  placeholder?: string;
  autoFocus?: boolean;
}

export default function EventsEditor({ value, onChange, max, placeholder, autoFocus }: Props) {
  const [rows, setRows] = useState<Marked[]>(() => {
    const parsed = parseEvents(value);
    // One empty row to type into, so an untouched night shows a box rather
    // than a bare "add" button with nothing to explain itself.
    return parsed.length > 0 ? parsed : [{ text: '', delta: 0 }];
  });

  // What we last handed upwards. A parent that changes `value` to something
  // else — a different night opened in the same drawer — re-seeds the list; a
  // parent echoing back what we just sent does not, which would otherwise
  // reset the caret on every keystroke.
  const mine = useRef(value);
  const latest = useRef(rows);
  useEffect(() => {
    if (value === mine.current) return;
    mine.current = value;
    const parsed = parseEvents(value);
    const seeded = parsed.length > 0 ? parsed : [{ text: '', delta: 0 }];
    // `latest` too, or the first edit after a re-seed is applied to the list
    // this component was showing before the parent swapped it.
    latest.current = seeded;
    setRows(seeded);
  }, [value]);

  // **Read through a ref, and update the ref inside `push` rather than during
  // render.** Two taps on the stepper in one tick both saw the same `rows` and
  // the second wrote the value the first had already written — so a double tap
  // moved a mark half a point instead of a full one, silently, which is the
  // worst way for a control that edits somebody's grade to be wrong.
  //
  // A ref assigned during render does not fix that on its own, which is the
  // part worth writing down: React 18 batches, so three synchronous clicks all
  // run before a single re-render, and a ref refreshed on render is as stale as
  // the closure was. It has to be advanced at the moment the edit is made.
  //
  // This is also why the first test of it passed while the browser still
  // failed — `fireEvent` flushes between clicks, so a test can only see this
  // bug if it fires them inside one `act`.
  const push = (next: Marked[]) => {
    latest.current = next;
    setRows(next);
    const out = serialiseEvents(next);
    mine.current = out;
    onChange(out);
  };

  const edit = (fn: (prev: Marked[]) => Marked[]) => push(fn(latest.current));

  const used = serialiseEvents(rows).length;

  // Trimmed against what the note *serialises to*, not against the words in the
  // box — the delimiters and the markers are stored too, and budgeting for the
  // text alone let a full note come back two characters over the limit. Measure
  // the finished string and give back exactly the excess.
  const setText = (i: number, text: string) =>
    edit((prev) => {
      const next = prev.map((r, j) => (j === i ? { ...r, text } : r));
      const over = serialiseEvents(next).length - max;
      if (over > 0) next[i] = { ...next[i], text: text.slice(0, Math.max(0, text.length - over)) };
      return next;
    });

  const nudge = (i: number, by: number) =>
    edit((prev) =>
      prev.map((r, j) =>
        j === i
          ? {
              ...r,
              delta: Math.max(
                -MAX_STEPS * MARK_STEP,
                Math.min(MAX_STEPS * MARK_STEP, r.delta + by * MARK_STEP),
              ),
            }
          : r,
      ),
    );

  const remove = (i: number) =>
    edit((prev) => {
      const next = prev.filter((_, j) => j !== i);
      return next.length > 0 ? next : [{ text: '', delta: 0 }];
    });

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div
          key={i}
          className="rounded-xl border border-amber-900/20 bg-white/70 p-2 shadow-sm"
        >
          <textarea
            value={row.text}
            onChange={(e) => setText(i, e.target.value)}
            rows={2}
            autoFocus={autoFocus && i === 0}
            placeholder={i === 0 ? placeholder : undefined}
            aria-label={t('ev.event', { n: String(i + 1) })}
            className="w-full resize-y rounded-lg border border-amber-900/15 bg-white px-2 py-1.5 text-sm text-amber-950 outline-none focus:border-orange-500"
          />
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {/* The stepper reads in points, not in markers. "+1.0" is the
                question the organiser is actually asking; "++" is how the
                answer happens to be stored. */}
            <button
              type="button"
              onClick={() => nudge(i, -1)}
              disabled={row.delta <= -MAX_STEPS * MARK_STEP}
              aria-label={t('ev.down')}
              className="grid h-7 w-7 place-items-center rounded-lg border border-amber-900/25 text-sm font-bold text-amber-900 enabled:hover:border-orange-500 disabled:opacity-30"
            >
              −
            </button>
            <span
              dir="ltr"
              className={`min-w-[3.5rem] text-center font-mono text-xs font-bold ${
                row.delta > 0
                  ? 'text-green-700'
                  : row.delta < 0
                    ? 'text-red-700'
                    : 'text-amber-900/35'
              }`}
            >
              {/* "0.0" rather than a dash: an em-dash between two small square
                  buttons reads as a third button, which is exactly what it
                  looked like the first time this was rendered. */}
              {row.delta === 0 ? '0.0' : `${row.delta > 0 ? '+' : '−'}${Math.abs(row.delta).toFixed(1)}`}
            </span>
            <button
              type="button"
              onClick={() => nudge(i, 1)}
              disabled={row.delta >= MAX_STEPS * MARK_STEP}
              aria-label={t('ev.up')}
              className="grid h-7 w-7 place-items-center rounded-lg border border-amber-900/25 text-sm font-bold text-amber-900 enabled:hover:border-orange-500 disabled:opacity-30"
            >
              +
            </button>
            <span className="text-[10px] text-amber-900/40">{t('ev.effect')}</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={t('ev.remove', { n: String(i + 1) })}
              className="rounded-lg border border-amber-900/20 px-2 py-1 text-xs text-amber-900/60 hover:border-red-500/50 hover:text-red-700"
            >
              🗑
            </button>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => push([...rows, { text: '', delta: 0 }])}
          disabled={used >= max}
          className="rounded-lg border border-amber-900/25 px-2.5 py-1 text-xs font-bold text-amber-900 enabled:hover:border-orange-500 disabled:opacity-40"
        >
          {t('ev.add')}
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-amber-900/35">
          {used}/{max}
        </span>
      </div>
    </div>
  );
}
