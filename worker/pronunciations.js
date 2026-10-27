// How the voice should say the words it gets wrong (§2.71.2).
//
// The voice model reads plain Hebrew letters and guesses at vowels. It cannot
// read niqqud (§2.71), so a name it mispronounces is fixed the other way round:
// the word is *respelled* in the text the voice is sent, and only there. The
// report the app shows, stores and checks is never touched.
//
// An entry maps a word, as the report spells it, to how to say it:
//
//   שגב: 'Segev'          a Latin spelling — the voice reads it in the cloned
//                         voice's own accent
//   שיא: 'סיא'            a respelling in Hebrew letters — stays in the script,
//                         and is the safer one for a sin (שׂ) read as shin (שׁ)
//   דור: { to: 'Dor', exact: true }
//                         `exact` — the word on its own only, with no prefix
//                         ("מדור" is a section, not "from Dor")
//
// To add one: add a line below and deploy the Worker. To change one, change the
// line. Recordings are cached per spoken text, so a changed entry simply means
// the next take is made again.

export const PRONUNCIATIONS = {
  שגב: 'Segev',
  יועד: 'Yoed',
  דובצקי: 'Dovtski',
  זרקא: 'Zarka',
  שיא: 'סיא',
};

// The letters Hebrew glues onto the front of a word, and the ways they stack:
// ו ה ב כ ל מ ש, "and the", "that in", "when". A prefix is only ever one of
// these *exactly*; any other letters in front make it a different word.
const PREFIX = /^(?:[ובכלמשה]|ו[הבכלמש]|ש[הבכלמ]|כש|וכש|וש[הבכלמ])$/;

// How each prefix letter sounds in front of a Latin spelling.
const SAID = { ו: 've', ה: 'ha', ב: 'be', כ: 'ke', ל: 'le', מ: 'me', ש: 'she' };

const LATIN = /[A-Za-z]/;

/** A Hebrew word is a run of Hebrew letters; punctuation and everything else is not part of it. */
const WORD = /[א-ת]+/g;

/**
 * Rewrite the words in `text` that have an entry in `dictionary`.
 *
 * Matches a whole word, or a valid prefix followed by the entry — never a piece
 * of a longer word, so "והשחורים" and "ישגב" are left alone. A prefix in front
 * of a Latin spelling is written the way it is said ("לשגב" → "le Segev"); in
 * front of a Hebrew respelling it stays as it was ("בשיא" → "בסיא").
 */
export function pronounce(text, dictionary = PRONUNCIATIONS) {
  const entries = new Map(
    Object.entries(dictionary).map(([word, entry]) => [
      word,
      typeof entry === 'string' ? { to: entry } : entry,
    ]),
  );

  return String(text ?? '').replace(WORD, (word) => {
    const whole = entries.get(word);
    if (whole) return whole.to;

    // a prefix, then an entry: try each split of the word that leaves a known one
    for (let cut = 1; cut <= 3 && cut < word.length; cut++) {
      const prefix = word.slice(0, cut);
      const entry = entries.get(word.slice(cut));
      if (!entry || entry.exact || !PREFIX.test(prefix)) continue;
      if (!LATIN.test(entry.to)) return `${prefix}${entry.to}`;
      return `${[...prefix].map((letter) => SAID[letter]).join('')} ${entry.to}`;
    }
    return word;
  });
}
