// Hebrew vowel marks for the voice (§2.71).
//
// The recording is read by a TTS model that guesses at unpointed Hebrew, and
// guesses wrong on names. Pointed text (ניקוד) tells it how each word is said.
// The people reading the report in the app should never see the points, so this
// does not touch the report at all: it adds them to the *spoken* text, at the
// moment a recording is made, and only to what the voice server is sent.
//
// **Why a second call rather than asking the report-writer to point as it
// writes.** The report prompt is long, and the more it is asked to do the less
// each part is done well; vowelling every word roughly doubles the tokens it
// has to produce, and it would have to be undone for the app (and kept in step
// in storage, provenance and the draft list) every time. A call of its own is
// one job with one check: the letters that come back must be the letters that
// went in. The check is made a line at a time. A line whose letters differ — a
// word "corrected", a sentence dropped — is thrown away and that line is read
// unpointed; the lines that pass keep their points. So the voice can never be
// made to say a word the report does not contain, which is the whole safety
// story of the feature (§2.69), and it can never be *worse* for trying:
// failure costs the points, nothing else.
//
// Per line, and on letters and digits only, because the first version checked
// the whole text and every character: one apostrophe the model rewrote
// anywhere in a recap, and the entire recording was made unpointed, silently.
// Punctuation decides a pause, not a word.
//
// It also points what the report never could: speakable() has already spelled
// the numbers out, so "חמש" gets its vowels like any other word.

import { callGemini } from './gemini.js';

/**
 * Strip vowel points and cantillation, keeping the letters and the punctuation.
 *
 * Not the whole block U+0591–U+05C7: that range also holds the maqaf (U+05BE,
 * the Hebrew hyphen "־"), the paseq and the sof pasuq, which are punctuation —
 * deleting them would glue "מורט־עצבים" into one word.
 */
export const stripPoints = (text) =>
  String(text ?? '').replace(/[֑-ׇֽֿׁׂׅׄ]/g, '');

/** How many vowel points a text carries (cantillation does not count). */
export const pointCount = (text) => (String(text ?? '').match(/[ְ-ׇּׁׂ]/g) ?? []).length;

const OPEN = '<nikud>';
const CLOSE = '</nikud>';

export function buildVocalizePrompt(spoken) {
  return `You are a Hebrew language expert adding niqqud (ניקוד מלא, full vowel points) to a text that will be read aloud by a speech synthesiser, so that every word is pronounced correctly.

THE LETTERS MUST NOT CHANGE. Copy the text exactly, letter for letter, and add the vowel points to it. Do not add, remove, replace, reorder, correct, translate or "improve" any word, letter, digit, space, punctuation mark or line break. Do not switch between spelling with and without matres lectionis (ktiv male / haser). If a word seems misspelled, point it as written. The text you return, with the points removed, must be identical to the text you were given.

HOW TO POINT.
- Full points on every Hebrew word: vowels, dagesh where it belongs, and the shin dot (שׁ / שׂ). No cantillation marks (te'amim).
- Modern Israeli pronunciation, as an Israeli broadcaster would say it.
- Names of people are first names of Israelis: point them the way that name is normally said in Israel.
- Keep every line break exactly where it is.
- Leave anything that is not a Hebrew word (a number, a Latin letter) as it is.

OUTPUT FORMAT. Return the pointed text, and nothing else, between ${OPEN} and ${CLOSE}. No explanation, no notes.

${OPEN}
${spoken}
${CLOSE}`;
}

const lines = (text) =>
  String(text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

/** The letters and digits of a text, in order, with points, punctuation and spacing gone. */
export const lettersOf = (text) =>
  String(text ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]/gu, '');

/** The pointed text between the tags, or null if the model did not use them. */
function between(raw) {
  const from = raw.indexOf(OPEN);
  if (from === -1) return null;
  const to = raw.lastIndexOf(CLOSE);
  return raw.slice(from + OPEN.length, to === -1 ? undefined : to).trim() || null;
}

/**
 * Where two texts first part company, on letters: a few letters either side of
 * the first one that differs. For a reason a person can read.
 */
export function firstDifference(was, now) {
  const a = lettersOf(was);
  const b = lettersOf(now);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const around = (text) => text.slice(Math.max(0, i - 6), i + 8);
  return { was: around(a), now: around(b) };
}

/**
 * Take the pointed lines that are the original's own words, keep the original
 * for the rest.
 *
 * Returns `{ text, ok, of, same, marked, diff }`, or null when the two cannot be
 * lined up at all — a different number of lines — and there is nothing to
 * compare line by line. A line counts (`ok`) only if its letters and digits are
 * exactly the original's *and* it carries some points; pointing nothing is not
 * pointing. `same` and `marked` say which of those two it was that failed, and
 * `diff` is where the first changed line first changed.
 */
export function mergePointed(spoken, pointed) {
  const original = lines(spoken.normalize('NFC'));
  const answer = lines(pointed.normalize('NFC'));
  if (original.length !== answer.length) return null;
  let ok = 0;
  let same = 0;
  let marked = 0;
  let diff = null;
  const text = original
    .map((line, i) => {
      const alike = lettersOf(answer[i]) === lettersOf(line);
      const pointedLine = pointCount(answer[i]) > 0;
      if (alike) same++;
      else diff ??= firstDifference(line, answer[i]);
      if (pointedLine) marked++;
      if (alike && pointedLine) ok++;
      return alike && pointedLine ? answer[i] : line;
    })
    .join('\n');
  return { text, ok, of: original.length, same, marked, diff };
}

/** True if `pointed` is `spoken` with vowels added: the same letters and digits, in order. */
export const sameLetters = (spoken, pointed) => lettersOf(spoken) === lettersOf(pointed);

// Which models point the text. Not the recap's own list: its first model writes
// the best reports but allows only ~20 requests a day (gemini.js), and pointing
// a recording shouldn't spend what a night's report needs. Pointing is a
// mechanical job with a mechanical check, so a lighter model does it — the
// check, not the model, is what makes the result safe — and the first in line
// is a step down, not the bottom. `GEMINI_MODEL` pins the recap writer and is
// deliberately not consulted here.
export const POINTING_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash',
];

// Pointed text is about twice as long in tokens, and the model may think first.
const MAX_TOKENS = 16000;
// A different answer is no use, but a different *sample* might pass the check.
const TRIES = 2;
// Pointing is not a creative act: the lowest-variance setting that still lets a
// retry differ.
const TEMPERATURE = 0.2;

/**
 * Add niqqud to `spoken`.
 *
 * Never throws and never returns anything but `spoken`, or `spoken` with points
 * on the lines that passed the check:
 *
 *   { text, pointed: true, ok, of, raw }         `ok` of `of` lines pointed
 *   { text: spoken, pointed: false, reason, raw } the text as it came, and why not
 *
 * `raw` is the model's last answer, pointed or not, so a rejected one can be
 * looked at (the organiser's "text sent" panel, §2.71).
 *
 * `ask` is `callGemini`; the tests pass their own.
 */
export async function vocalize(env, spoken, { ask = callGemini } = {}) {
  let reason = 'no answer';
  let best = null;
  let raw = null;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const said = await ask(env, buildVocalizePrompt(spoken), {
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      models: POINTING_MODELS,
    });
    if (said.error) {
      reason = said.error;
      // a refused key or a spent quota will not change on the second ask
      if (said.error === 'quota' || said.error === 'not-configured') break;
      continue;
    }
    const pointed = between(said.raw);
    raw = said.raw;
    if (!pointed) {
      reason = 'no tags';
      continue;
    }
    const merged = mergePointed(spoken, pointed);
    if (!merged) {
      reason = 'the lines did not match';
      continue;
    }
    if (merged.ok === 0) {
      reason =
        merged.same === 0
          ? `the letters changed in every line (“${merged.diff.was}” became “${merged.diff.now}”)`
          : 'the answer had no vowel points';
      continue;
    }
    if (!best || merged.ok > best.ok) best = merged;
    // every line passed: nothing a second answer could add
    if (best.ok === best.of) break;
  }
  if (best) return { text: best.text.normalize('NFC'), pointed: true, ok: best.ok, of: best.of, raw };
  return { text: spoken, pointed: false, reason, raw };
}
