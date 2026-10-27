// How excited the voice is allowed to sound (§2.73).
//
// The voice model reads the whole of a sentence knowing how it ends, so a "!"
// does not just lift the last word: the entire sentence is delivered excited,
// and a long one climbs to a very high pitch. A persona like Swissa is *meant*
// to write run-on, exclamatory sentences, and the writing is left as wild as it
// wants — what changes is only the text the voice is sent, where a long sentence
// that ends in "!" ends in "." instead. A short one ("איזו בונבוניירה!") is the
// kind of line an exclamation mark is for, and keeps it.
//
// The app and the stored report are never touched.

import { stripPoints } from './vocalize.js';

// The longest sentence, in characters, that keeps its "!" in the default mode.
export const EXCLAIM_SHORT = 45;

/**
 * How `VOICE_EXCLAIM` is set: "short" (the default) keeps "!" on short sentences
 * only, "calm" turns every "!" into a full stop, "all" leaves them alone.
 * Anything else is the default, so a typo cannot silently change the delivery.
 */
export const exclaimMode = (env) => {
  const set = String(env?.VOICE_EXCLAIM ?? '').trim().toLowerCase();
  return set === 'calm' || set === 'all' ? set : 'short';
};

/** `text`, a sentence to a line or several, with its "!" softened as `mode` says. */
export function calmExclamations(text, mode = 'short') {
  if (mode === 'all') return text;
  return String(text ?? '')
    .split('\n')
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => {
          if (!/!$/.test(sentence)) return sentence;
          if (mode === 'short' && stripPoints(sentence).length <= EXCLAIM_SHORT) return sentence;
          // "?!" stays a question; anything else ending in "!" becomes a full stop
          return sentence.replace(/(\?)?!+$/, (_, question) => question ?? '.');
        })
        .join(' '),
    )
    .join('\n');
}
