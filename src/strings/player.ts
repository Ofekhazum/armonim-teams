import type { Entry } from '../i18n';

// One player's page — the ten cards, their jump strip, and the tier ladder.
//
// The copy addresses the player ("beaten by you") because it is their page,
// not because a person ever won a match on their own (§2.18). The Hebrew keeps
// that: second person where the English uses it, counts everywhere else.

export const player = {
  'pp.back': { he: '→ חזרה', en: '← Back' },
  'pp.edit': { he: '✏️ עריכה', en: '✏️ Edit' },
  'pp.guest': { he: '★ אורח', en: '★ Guest' },
  'pp.aka': { he: 'ידוע גם כ', en: 'aka' },

  'pp.totm.title': { he: '👕 הרכב החודש', en: '👕 Team of the Month' },
  'pp.totm.chip.title': {
    he: 'נבחר לחמישייה של החודש הזה. צריך יותר ממחצית מערבי החודש כדי להיות זכאי.',
    en: "Picked in the five for this month. Needs more than half the month's nights to be eligible.",
  },

  // --- The jump strip -------------------------------------------------------
  'pp.jump.nights': { he: '🎽 ערבים', en: '🎽 Nights' },
  'pp.jump.form': { he: '📈 כושר', en: '📈 Form' },
  'pp.jump.story': { he: '📖 סיפור', en: '📖 Story' },
  'pp.jump.milestones': { he: '🎯 אבני דרך', en: '🎯 Milestones' },
  'pp.jump.rivals': { he: '⚔️ יריבים', en: '⚔️ Rivals' },
  'pp.jump.arcs': { he: '🕗 הערב', en: '🕗 The night' },
  'pp.jump.aria': { he: 'קפיצה לקטע', en: 'Jump to a section' },

  // --- The stat tiles -------------------------------------------------------
  'pp.noFootball': { he: 'עוד אין כדורגל', en: 'No football yet' },
  'pp.noFootball.body': {
    he: 'אין מה לספור — השחקן הזה עוד לא הופיע בדף הרכב שנרשם.',
    en: "Nothing to count — this player hasn't been on a recorded team sheet.",
  },
  'pp.stat.nights': { he: 'ערבים', en: 'nights' },
  'pp.stat.nightsWon': { he: 'ערבים שנוצחו', en: 'nights won' },
  'pp.stat.wins': { he: 'ניצחונות', en: 'match wins' },
  'pp.stat.perNight': { he: 'לכל ערב', en: 'per night' },
  'pp.stat.mvp': {
    he: { one: 'ערב מצטיין', other: 'ערבי מצטיין' },
    en: { one: 'MVP night', other: 'MVP nights' },
  },

  // --- Every night ----------------------------------------------------------
  'pp.nights.title': { he: 'כל ערב', en: 'Every night' },
  'pp.nights.hint': { he: 'החדש ראשון · {n} שוחקו', en: 'newest first · {n} played' },
  'pp.nights.spoken.noResult': {
    he: '{date}, {team}, לא נרשמה תוצאה',
    en: '{date}, {team}, no result recorded',
  },
  'pp.nights.spoken.place': { he: '{date}, {team}, סיים {place}', en: '{date}, {team}, finished {place}' },
  'pp.nights.bestRun': { he: 'הרצף הטוב ביותר', en: 'best run' },
  'pp.nights.onNow': { he: 'על', en: 'on' },
  'pp.nights.rightNow': { he: 'כרגע 🔥', en: 'right now 🔥' },

  // --- Cards ----------------------------------------------------------------
  'pp.form.title': { he: 'כושר', en: 'Form' },
  'pp.form.loading': { he: 'טוען', en: 'loading' },
  'pp.story.title': { he: 'הסיפור עד כה', en: 'The story so far' },
  'pp.story.hint': { he: 'החדש ראשון', en: 'newest first' },
  'pp.milestones.title': { he: 'אבני דרך', en: 'Milestones' },
  'pp.shirts.title': { he: 'חולצות שנלבשו', en: 'Shirts worn' },

  'pp.progress.allPassed': { he: '{n} {unit} — כל אבני הדרך עברו 🎖️', en: '{n} {unit} — every milestone passed 🎖️' },
  'pp.progress.toGo': { he: 'נותרו {n}', en: '{n} to go' },
  'pp.progress.aria': { he: '{now} מתוך {target} {unit}', en: '{now} of {target} {unit}' },
  'pp.unit.nights': { he: 'ערבים', en: 'nights' },
  'pp.unit.wins': { he: 'ניצחונות', en: 'wins' },
  'pp.unit.nightsWon': { he: 'ערבים שנוצחו', en: 'nights won' },
  'pp.unit.mvps': { he: 'מצטיינים', en: 'MVPs' },

  // --- Mates and rivals -----------------------------------------------------
  'pp.rivals.title': { he: 'חברים ויריבים', en: 'Mates and rivals' },
  'pp.rivals.needsNights': {
    he: 'צריך {min} ערבים לפני שמשהו מזה באמת עליו — {n} עד כה.',
    en: 'Needs {min} nights before any of this is about them — {n} so far.',
  },
  'pp.rivals.nobodyYet': {
    he: 'עוד אין מישהו שהוא חלק איתו מספיק כדורגל.',
    en: 'Nobody they have shared enough football with yet.',
  },
  'pp.rivals.playedMost': { he: 'הכי הרבה ערבים עם', en: 'Most nights with' },
  'pp.rivals.playedMost.tail': { he: '{together} מתוך {nights}', en: '{together} of {nights}' },
  'pp.rivals.wonMost': { he: 'ניצח הכי הרבה עם', en: 'Won most with' },
  'pp.rivals.wonMost.tail': { he: '{n} ערבים שנוצחו', en: '{n} nights won' },
  'pp.rivals.never': { he: 'אף פעם לא לצידו', en: 'Never once alongside' },
  'pp.rivals.never.tail': { he: '{n} ערבים ממול', en: '{n} nights opposite' },
  'pp.rivals.facedMost': { he: 'התמודד הכי הרבה מול', en: 'Faced most' },
  'pp.rivals.facedMost.tail': { he: '{n} משחקים', en: '{n} matches' },
  'pp.rivals.bogey': { he: 'הקוץ בתחת', en: 'Bogey man' },
  'pp.rivals.bogey.tail': { he: 'ניצח אותך ב־{n} מתוך {faced}', en: 'has beaten you {n} of {faced}' },
  'pp.rivals.victim': { he: 'הקורבן האהוב', en: 'Favourite victim' },
  'pp.rivals.victim.tail': { he: 'נוצח על ידיך ב־{n} מתוך {faced}', en: 'beaten by you {n} of {faced}' },
  'pp.rivals.worthy': { he: 'יריב ראוי', en: 'Worthy opponent' },
  'pp.rivals.worthy.tail': { he: '{beat}–{beatenBy} — צמוד', en: '{beat}–{beatenBy} — nothing in it' },
  'pp.rivals.h2hNeedsLogs': {
    he: 'מאזן ישיר דורש ערבים שנרשמו משחק־משחק — ערב בפני עצמו לא יכול לומר מי ניצח את מי.',
    en: "Head-to-head needs nights logged match by match — a night alone can't say who beat whom.",
  },
  'pp.duo.better': { he: '🤝 מנצח יותר עם', en: '🤝 Wins more with' },
  'pp.duo.worse': { he: '🙃 מנצח פחות עם', en: '🙃 Wins less with' },
  'pp.duo.tail': { he: '{won} מתוך {together} ערבים', en: '{won} of {together} nights' },

  // --- Shootouts and the night ---------------------------------------------
  'pp.shootouts.title': { he: 'פנדלים', en: 'Shootouts' },
  'pp.shootouts.hint': { he: '{n} ערבים שנרשמו', en: '{n} logged nights' },
  'pp.shootouts.onPens': { he: 'בפנדלים', en: 'on penalties' },
  'pp.shootouts.inPlay': { he: 'במשחק', en: 'won in play' },
  'pp.shootouts.needsLogs': {
    he: 'רק ערבים שנרשמו משחק־משחק יכולים לענות על זה — {n} עד כה, צריך {min}.',
    en: 'Only nights logged match by match can answer this — {n} so far, {min} needed.',
  },
  'pp.arcs.title': { he: 'לאורך הערב', en: 'Across the night' },
  'pp.arcs.hint': { he: '{n} משחקים נרשמו', en: '{n} matches logged' },
  'pp.arcs.needsLogs': {
    he: 'זה דורש ערבים שנרשמו משחק־משחק — {n} עד כה, צריך {min}. ערב שנספר בסוף אומר כמה ניצחו, אף פעם לא מתי.',
    en: 'This one needs nights logged match by match — {n} so far, {min} needed. A tallied night says how much they won, never when.',
  },

  // --- The tier ladder ------------------------------------------------------
  'pp.tier.bronze': { he: 'ארד', en: 'Bronze' },
  'pp.tier.silver': { he: 'כסף', en: 'Silver' },
  'pp.tier.gold': { he: 'זהב', en: 'Gold' },
  'pp.tier.emerald': { he: 'אמרלד', en: 'Emerald' },
  'pp.tier.sapphire': { he: 'ספיר', en: 'Sapphire' },
  'pp.tier.amethyst': { he: 'אחלמה', en: 'Amethyst' },
  'pp.tier.diamond': { he: 'יהלום', en: 'Diamond' },
} as const satisfies Record<string, Entry>;
