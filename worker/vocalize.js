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
// went in. If a single one differs — a word "corrected", a sentence dropped —
// the answer is thrown away and the recording is made unpointed. So the voice
// can never be made to say a word the report does not contain, which is the
// whole safety story of the feature (§2.69), and it can never be *worse* for
// trying: failure costs the points, nothing else.
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

/** The pointed text between the tags, or null if the model did not use them. */
function between(raw) {
  const from = raw.indexOf(OPEN);
  if (from === -1) return null;
  const to = raw.lastIndexOf(CLOSE);
  return raw.slice(from + OPEN.length, to === -1 ? undefined : to).trim() || null;
}

/**
 * True if `pointed` is `spoken` with vowels added and nothing else: the same
 * lines, and in each line the same characters once the points are stripped.
 * Normalised to NFC first, because a model may emit a letter and its points in
 * either order and the two spellings are the same word.
 */
export function sameLetters(spoken, pointed) {
  const a = lines(spoken.normalize('NFC'));
  const b = lines(stripPoints(pointed.normalize('NFC')));
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

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
 * Never throws and never returns anything but `spoken` or `spoken` with points:
 *
 *   { text, pointed: true }            the model's text, checked letter for letter
 *   { text: spoken, pointed: false, reason }   the text as it came, and why not
 *
 * `ask` is `callGemini`; the tests pass their own.
 */
export async function vocalize(env, spoken, { ask = callGemini } = {}) {
  let reason = 'no answer';
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
    if (!pointed) {
      reason = 'no tags';
      continue;
    }
    if (!sameLetters(spoken, pointed)) {
      reason = 'the letters changed';
      continue;
    }
    if (pointCount(pointed) === 0) {
      reason = 'no points were added';
      continue;
    }
    return { text: pointed.normalize('NFC'), pointed: true };
  }
  return { text: spoken, pointed: false, reason };
}
