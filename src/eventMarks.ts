import type { FixtureRecord } from './types';

// The organiser's thumb on the scale (§2.57).
//
// A night knows almost nothing about one player. `MatchLogEntry` records team
// colours, not people, so every match and every shootout is identical for the
// five players on a shirt — which is why `grades.ts` can only separate
// teammates by the MVP vote, the private rating, and their own history. None of
// those know that somebody scored four goals on a losing side.
//
// The person standing on the touchline does know. This is the route by which
// what they saw reaches the number, and the design rule is that it has to stay
// **arithmetic over data already stored**: a mark is recomputed from history
// every time a night is opened, so anything that moves it must be recoverable
// from the fixture record forever. The organiser's note is in that record. A
// model's opinion, formed once when a button was pressed, is not.
//
// So: `@שי שם 4 גולים +@` — one marker, half a point, on the event you already
// write for the report.
//
// **Both ends accepted, deliberately.** The note is written in Hebrew, and in a
// right-to-left line "put it at the end" is advice nobody can follow with
// confidence. `@+ שי שם 4 גולים@` and `@שי שם 4 גולים +@` are the same thing.

/** Half a point per marker — see MARK_STEP's use in `grades.ts`. */
export const MARK_STEP = 0.5;

/**
 * The organiser's note, split into the separate events it describes.
 *
 * A TypeScript mirror of `splitEvents` in `worker/recap.js`, which reads the
 * same notes for the report. Duplicated rather than shared because the Worker
 * is plain JS on a separate deploy with no build step between them; the two
 * must agree, and the tests on both sides use the same examples so that a
 * change to one fails loudly against the other.
 *
 * Two separators, both of which an organiser types naturally:
 *
 * - **`@like this@`** — explicit. If any `@…@` pair is present, only those are
 *   read, so a half-marked note cannot produce a mix of marked and unmarked.
 * - **One per line** otherwise, with a leading bullet or number trimmed off.
 */
export function splitEvents(said: string | null | undefined): string[] {
  if (typeof said !== 'string') return [];
  const marked = [...said.matchAll(/@([^@]+)@/g)].map((m) => m[1].trim()).filter(Boolean);
  if (marked.length > 0) return marked;
  return said
    .split('\n')
    .map((line) => line.replace(/^\s*(?:(?:[-*•]|\d+[.)])\s*)+/, '').trim())
    .filter(Boolean);
}

/** One event with its markers peeled off: the words, and what they are worth. */
interface Marked {
  text: string;
  /** `+0.5` per `+`, `−0.5` per `−`, netted. Zero when the event carries none. */
  delta: number;
}

// A run of + or − at either end of an event, and nothing in between. Anchored
// to the ends on purpose: "הוא ניצח 5-2" and "3+4 שערים" are things people
// write, and a marker is a thing that sits on its own at the edge of the line.
const LEAD = /^([+\-−–]+)\s+/;
const TAIL = /\s+([+\-−–]+)$/;

const worth = (run: string): number => {
  let n = 0;
  for (const ch of run) n += ch === '+' ? MARK_STEP : -MARK_STEP;
  return n;
};

function peel(event: string): Marked {
  let text = event.trim();
  let delta = 0;
  const lead = text.match(LEAD);
  if (lead) {
    delta += worth(lead[1]);
    text = text.slice(lead[0].length).trim();
  }
  const tail = text.match(TAIL);
  if (tail) {
    delta += worth(tail[1]);
    text = text.slice(0, text.length - tail[0].length).trim();
  }
  return { text, delta };
}

// Words, for matching a name against what was written. Hebrew letters are not
// `\w`, so `\b` is useless here — splitting on everything that is not a letter
// or a digit is what gives us word boundaries in both scripts.
const words = (s: string): string[] => s.split(/[^\p{L}\p{N}']+/u).filter(Boolean);

/**
 * Hebrew glues its function words onto the front of the next word, so a name in
 * a sentence is very often not a word on its own.
 *
 * "יוני ויועד שיחקו מצוין" — *Yoni and Yoad played brilliantly* — tokenises as
 * `יוני` and **`ויועד`**, because "and" is the letter ו stuck to the front of
 * the name. Straight token equality found Yoni and silently missed Yoad, which
 * is the worst possible failure for this feature: half the instruction obeyed,
 * no error, and a mark that did not move for reasons invisible to the person
 * who wrote the line.
 *
 * So a token matches a name if it *is* the name, or if it is the name behind at
 * most two of ו ב ל ה מ כ ש — and/in/to/the/from/as/that, which is the whole
 * set that behaves this way. Two because they stack: "וכשדור" is real Hebrew.
 *
 * The length bound is what keeps this honest. A name buried deeper inside a
 * longer word is a coincidence, not a mention: "אישי" ends in "שי" but reaches
 * it past א and י, neither of which is a prefix, so שי's mark stays put.
 */
const PREFIXES = /^[ובלהמכש]+$/u;

const tokenIs = (token: string, name: string): boolean => {
  if (token === name) return true;
  if (name.length < 2 || !token.endsWith(name)) return false;
  const prefix = token.slice(0, token.length - name.length);
  return prefix.length > 0 && prefix.length <= 2 && PREFIXES.test(prefix);
};

/**
 * Does `needle`'s words appear as a consecutive run inside `hay`'s?
 *
 * Only the first word of a name may carry a prefix, because that is the only
 * place Hebrew puts one: "ודור גי" is *and Dor Gi*, while "דור וגי" is two
 * different people.
 */
const runIn = (hay: string[], needle: string[]): boolean => {
  if (needle.length === 0 || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    if (!tokenIs(hay[i], needle[0])) continue;
    for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

/**
 * Who a marked event is about, and what it is worth to them.
 *
 * Returns `id → total adjustment`, summed across every event that names them —
 * four separate good things on one night is four markers and two points.
 *
 * **An event naming two people moves both marks by the full amount**, rather
 * than splitting one marker between them: "יוני ויועד שיחקו מצוין בשער +" says
 * two players were good, not that half a good thing happened. Splitting would
 * also make the value of a marker depend on how the sentence was phrased, so
 * praising two people together would be worth less than praising them on
 * consecutive lines — which is not something an organiser writing a note in a
 * hurry should have to think about.
 *
 * **An event that names nobody adjusts nobody**, which is the same rule the
 * report follows for attribution (§2.24). A marker on an unattributed line is
 * an instruction with no target, and guessing at one — the player who lost
 * most, the player the sentence would be funniest about — is exactly the
 * invention that rule exists to stop. It is silently ignored rather than
 * reported: the organiser can see that nobody's mark moved.
 *
 * **Matching is on tonight's sheet only**, by the names the fixture itself
 * stored. A full name matches as a consecutive run of words, so "דור גי" finds
 * that player and not a "דור" elsewhere. A first name alone matches only when
 * it is unambiguous among the fifteen playing — with two שי on the sheet,
 * writing "שי" moves neither, because the alternative is moving the wrong one.
 */
export function eventMarks(fx: FixtureRecord): Map<string, number> {
  const out = new Map<string, number>();
  const events = splitEvents(fx.note).map(peel).filter((e) => e.delta !== 0);
  if (events.length === 0) return out;

  const squad = fx.players.map((p) => ({ id: p.id, full: words(p.name) })).filter((p) => p.full.length > 0);

  // A first name is only usable as a handle when exactly one player answers to
  // it. Counted across the whole sheet rather than per event, so the answer
  // does not change depending on which line is being read.
  const firstCount = new Map<string, number>();
  for (const p of squad) firstCount.set(p.full[0], (firstCount.get(p.full[0]) ?? 0) + 1);

  for (const { text, delta } of events) {
    const said = words(text);
    for (const p of squad) {
      const named =
        runIn(said, p.full) ||
        (p.full.length > 1 &&
          firstCount.get(p.full[0]) === 1 &&
          said.some((w) => tokenIs(w, p.full[0])));
      if (named) out.set(p.id, (out.get(p.id) ?? 0) + delta);
    }
  }
  return out;
}

/**
 * The note with its markers taken off, for anything that shows it to a reader.
 *
 * The report and the grade sentences are both written from this note, and
 * neither should ever quote a `+` back at the group — it is punctuation
 * addressed to the app, not part of what happened. Stripped here, at the point
 * the facts are built, so the Worker never sees one and no prompt has to be
 * taught to ignore it.
 */
export function stripMarks(said: string | null | undefined): string | null {
  if (typeof said !== 'string') return null;
  const marked = [...said.matchAll(/@([^@]+)@/g)];
  if (marked.length > 0) {
    // Rebuilt in the same `@…@` shape the Worker's splitter expects, so the
    // event boundaries the organiser drew survive the strip.
    const kept = marked.map((m) => peel(m[1]).text).filter(Boolean);
    return kept.length ? kept.map((t) => `@${t}@`).join(' ') : null;
  }
  const lines = said
    .split('\n')
    .map((line) => peel(line).text)
    .filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}
