import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MARK_STEP, parseEvents, serialiseEvents, type Marked } from '../eventMarks';
import { EVENTS_MAX, EVENT_MAX } from '../types';
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

  // **Each box is trimmed against its own limit, not against a shared pool.**
  // The first version measured the whole serialised note and gave back the
  // excess, which is correct arithmetic and a bad control: what an organiser
  // could type into event four depended on how much they had written in event
  // one, so the box stopped taking letters part-way through a word with nothing
  // on screen that could explain why. `EVENT_MAX` is the same number in every
  // box on every night, which is the property that makes a limit plannable.
  //
  // `max` stays as the backstop on the finished string, because `EVENTS_MAX`
  // only caps the *button* — a note filed before this, or written by hand, can
  // arrive with more rows than that, and the store must still take what it is
  // handed whole rather than have `MatchDay` cut it mid-event.
  const setText = (i: number, text: string) =>
    edit((prev) => {
      const clipped = text.slice(0, EVENT_MAX);
      const next = prev.map((r, j) => (j === i ? { ...r, text: clipped } : r));
      const over = serialiseEvents(next).length - max;
      if (over > 0) {
        next[i] = { ...next[i], text: clipped.slice(0, Math.max(0, clipped.length - over)) };
      }
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

  // **Each box grows to its own text.** Two fixed rows was right when an event
  // was a handful of words and wrong the moment it could be a sentence or two:
  // a full one scrolled inside a box shorter than itself, which is the same
  // "I cannot see what I wrote" problem the single textarea had — solved for
  // the list and reintroduced inside each row.
  //
  // In a layout effect rather than on keystroke, so it also catches the two
  // cases nobody types their way into: the first paint of a night opened with
  // events already on it, and a re-seed when the drawer is pointed at another.
  const boxes = useRef<(HTMLTextAreaElement | null)[]>([]);
  useLayoutEffect(() => {
    boxes.current.length = rows.length;
    for (const el of boxes.current) {
      if (!el) continue;
      // Collapse first: `scrollHeight` on an already-tall box reports the tall
      // height, so without this a box that lost text would never shrink back.
      el.style.height = 'auto';
      // `scrollHeight` counts padding but not border, and `box-sizing` is
      // border-box here, so assigning it straight leaves every box exactly its
      // border short — enough to keep the last line clipped and the scrollbar
      // live, which is the whole thing this was meant to stop.
      const border = el.offsetHeight - el.clientHeight;
      el.style.height = `${el.scrollHeight + border}px`;
    }
  }, [rows]);

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div
          key={i}
          className="rounded-xl border border-amber-900/20 bg-white/70 p-2 shadow-sm"
        >
          <textarea
            ref={(el) => {
              boxes.current[i] = el;
            }}
            value={row.text}
            onChange={(e) => setText(i, e.target.value)}
            rows={2}
            autoFocus={autoFocus && i === 0}
            placeholder={i === 0 ? placeholder : undefined}
            aria-label={t('ev.event', { n: String(i + 1) })}
            // `resize-none`, because the height is the text's to decide now and
            // a dragged one would be overwritten by the next keystroke anyway.
            className="w-full resize-none overflow-hidden rounded-lg border border-amber-900/15 bg-white px-2 py-1.5 text-sm text-amber-950 outline-none focus:border-orange-500"
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
            {/* Shown only once the box is nearly full. A counter that is always
                there is read as a target to fill; one that appears at three
                quarters is the answer to "why did it stop taking letters",
                arriving just before the question does. */}
            {row.text.length >= EVENT_MAX * 0.75 && (
              <span
                dir="ltr"
                className={`font-mono text-[10px] ${
                  row.text.length >= EVENT_MAX ? 'font-bold text-red-700' : 'text-amber-900/40'
                }`}
              >
                {row.text.length}/{EVENT_MAX}
              </span>
            )}
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
          // `edit`, not `push([...rows, …])`. No user can reach the difference
          // — two taps are two tasks and React flushes between them — so this
          // is consistency rather than a fix: `rows` is the last *rendered*
          // list and `latest` is the current one, and having one control read
          // the rendered value is how the stepper's batching bug got in twice.
          // Every write goes through the ref; there is no second way to one.
          onClick={() => edit((prev) => [...prev, { text: '', delta: 0 }])}
          disabled={rows.length >= EVENTS_MAX}
          className="rounded-lg border border-amber-900/25 px-2.5 py-1 text-xs font-bold text-amber-900 enabled:hover:border-orange-500 disabled:opacity-40"
        >
          {t('ev.add')}
        </button>
        <div className="flex-1" />
        {/* The count, not the character total. How many events the report has
            to find something to say about is a thing worth knowing; how many
            characters they serialise to, now that no single box can be starved
            by another, is the app's arithmetic and not the organiser's. */}
        <span className="text-[10px] text-amber-900/35">
          {t('ev.count', { n: String(rows.length), max: String(EVENTS_MAX) })}
        </span>
      </div>
    </div>
  );
}
