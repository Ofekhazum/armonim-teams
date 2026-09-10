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
    he: 'נבחר לחמישייה של החודש הזה. צריך יותר ממחצית ממחזורי החודש כדי להיות זכאי.',
    en: "Picked in the five for this month. Needs more than half the month's nights to be eligible.",
  },

  // --- The jump strip -------------------------------------------------------
  'pp.jump.nights': { he: '🎽 מחזורים', en: '🎽 Nights' },
  'pp.jump.form': { he: '📈 כושר', en: '📈 Form' },
  'pp.jump.story': { he: '📖 סיפור', en: '📖 Story' },
  'pp.jump.milestones': { he: '🎯 אבני דרך', en: '🎯 Milestones' },
  'pp.jump.rivals': { he: '⚔️ יריבים', en: '⚔️ Rivals' },
  'pp.jump.arcs': { he: '🕗 המחזור', en: '🕗 The night' },
  'pp.jump.aria': { he: 'קפיצה לקטע', en: 'Jump to a section' },

  // --- The stat tiles -------------------------------------------------------
  'pp.noFootball': { he: 'עוד אין כדורגל', en: 'No football yet' },
  'pp.noFootball.body': {
    he: 'אין מה לספור — השחקן הזה עוד לא הופיע בדף הרכב שנרשם.',
    en: "Nothing to count — this player hasn't been on a recorded team sheet.",
  },
  'pp.stat.nights': { he: 'מחזורים', en: 'nights' },
  'pp.stat.nightsWon': { he: 'מחזורים שנוצחו', en: 'nights won' },
  'pp.stat.wins': { he: 'ניצחונות', en: 'match wins' },
  'pp.stat.perNight': { he: 'לכל מחזור', en: 'per night' },
  'pp.stat.mvp': {
    he: { one: 'מחזור מצטיין', other: 'מחזורי מצטיין' },
    en: { one: 'MVP night', other: 'MVP nights' },
  },

  // --- Every night ----------------------------------------------------------
  'pp.nights.title': { he: 'כל מחזור', en: 'Every night' },
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
  'pp.unit.nights': { he: 'מחזורים', en: 'nights' },
  'pp.unit.wins': { he: 'ניצחונות', en: 'wins' },
  'pp.unit.nightsWon': { he: 'מחזורים שנוצחו', en: 'nights won' },
  'pp.unit.mvps': { he: 'מצטיינים', en: 'MVPs' },

  // --- Mates and rivals -----------------------------------------------------
  'pp.rivals.title': { he: 'חברים ויריבים', en: 'Mates and rivals' },
  'pp.rivals.needsNights': {
    he: 'צריך {min} מחזורים לפני שמשהו מזה באמת עליו — {n} עד כה.',
    en: 'Needs {min} nights before any of this is about them — {n} so far.',
  },
  'pp.rivals.nobodyYet': {
    he: 'עוד אין מישהו שהוא חלק איתו מספיק כדורגל.',
    en: 'Nobody they have shared enough football with yet.',
  },
  'pp.rivals.playedMost': { he: 'הכי הרבה מחזורים עם', en: 'Most nights with' },
  'pp.rivals.playedMost.tail': { he: '{together} מתוך {nights}', en: '{together} of {nights}' },
  'pp.rivals.wonMost': { he: 'ניצח הכי הרבה עם', en: 'Won most with' },
  'pp.rivals.wonMost.tail': { he: '{n} מחזורים שנוצחו', en: '{n} nights won' },
  'pp.rivals.never': { he: 'אף פעם לא לצידו', en: 'Never once alongside' },
  'pp.rivals.never.tail': { he: '{n} מחזורים ממול', en: '{n} nights opposite' },
  'pp.rivals.facedMost': { he: 'התמודד הכי הרבה מול', en: 'Faced most' },
  'pp.rivals.facedMost.tail': { he: '{n} משחקים', en: '{n} matches' },
  'pp.rivals.bogey': { he: 'הקוץ בתחת', en: 'Bogey man' },
  'pp.rivals.bogey.tail': { he: 'ניצח אותך ב־{n} מתוך {faced}', en: 'has beaten you {n} of {faced}' },
  'pp.rivals.victim': { he: 'הקורבן האהוב', en: 'Favourite victim' },
  'pp.rivals.victim.tail': { he: 'נוצח על ידיך ב־{n} מתוך {faced}', en: 'beaten by you {n} of {faced}' },
  'pp.rivals.worthy': { he: 'יריב ראוי', en: 'Worthy opponent' },
  'pp.rivals.worthy.tail': { he: '{beat}–{beatenBy} — צמוד', en: '{beat}–{beatenBy} — nothing in it' },
  'pp.rivals.h2hNeedsLogs': {
    he: 'מאזן ישיר דורש מחזורים שנרשמו משחק־משחק — מחזור בפני עצמו לא יכול לומר מי ניצח את מי.',
    en: "Head-to-head needs nights logged match by match — a night alone can't say who beat whom.",
  },
  'pp.duo.better': { he: '🤝 מנצח יותר עם', en: '🤝 Wins more with' },
  'pp.duo.worse': { he: '🙃 מנצח פחות עם', en: '🙃 Wins less with' },
  'pp.duo.tail': { he: '{won} מתוך {together} מחזורים', en: '{won} of {together} nights' },

  // --- Shootouts and the night ---------------------------------------------
  'pp.shootouts.title': { he: 'פנדלים', en: 'Shootouts' },
  'pp.shootouts.hint': { he: '{n} מחזורים שנרשמו', en: '{n} logged nights' },
  'pp.shootouts.onPens': { he: 'בפנדלים', en: 'on penalties' },
  'pp.shootouts.inPlay': { he: 'במשחק', en: 'won in play' },
  'pp.shootouts.needsLogs': {
    he: 'רק מחזורים שנרשמו משחק־משחק יכולים לענות על זה — {n} עד כה, צריך {min}.',
    en: 'Only nights logged match by match can answer this — {n} so far, {min} needed.',
  },
  'pp.arcs.title': { he: 'לאורך המחזור', en: 'Across the night' },
  'pp.arcs.hint': { he: '{n} משחקים נרשמו', en: '{n} matches logged' },
  'pp.arcs.needsLogs': {
    he: 'זה דורש מחזורים שנרשמו משחק־משחק — {n} עד כה, צריך {min}. מחזור שנספר בסוף אומר כמה ניצחו, אף פעם לא מתי.',
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

  // --- The timeline (PlayerTimeline) ---------------------------------------
  //
  // `{ord}` is the count, already shaped for the language: "50th" in English,
  // a bare "50" in Hebrew, where the ordinal is carried by the "ה־" in the
  // string itself rather than by a suffix on the number.
  'tl.empty': {
    he: 'עוד לא קרה שום דבר פעמיים. אבני דרך, רצפים ושיאים ינחתו כאן ברגע שיקרו.',
    en: 'Nothing has happened twice yet. Milestones, runs and records land here as they do.',
  },
  'tl.debut': { he: 'המחזור הראשון ברישום', en: 'First night on record' },
  'tl.debut.place': { he: ' · סיים {ord}', en: ' · finished {ord}' },
  'tl.nthNight': { he: 'המחזור ה־{ord}', en: '{ord} night' },
  'tl.nthNight.detail': { he: 'מחזורים עם תוצאה שנרשמה', en: 'nights with a result recorded' },
  'tl.nthWin': { he: 'ניצחון המשחק ה־{ord}', en: '{ord} match win' },
  'tl.nthWin.detail': { he: 'על פני כל המחזורים ששיחק', en: 'across every night they have played' },
  'tl.nthNightWon': { he: 'המחזור ה־{ord} שנוצח', en: '{ord} night won' },
  'tl.nthNightWon.detail': {
    he: 'מחזורים שהקבוצה שלו סיימה בראשם',
    en: 'nights their team finished top of',
  },
  'tl.mvpFirst': { he: 'נבחר למצטיין', en: 'Picked MVP' },
  'tl.mvpFirst.detail': { he: 'בפעם הראשונה', en: 'the first time' },
  'tl.nthMvp': { he: 'מחזור המצטיין ה־{ord}', en: '{ord} MVP night' },
  'tl.streakEnded': { he: 'רצף של {n} נגמר', en: 'A run of {n} ended' },
  'tl.streakEnded.detail': {
    he: '{n} מחזורים שנוצחו ברצף, ואז זה',
    en: '{n} nights won in a row, then this one',
  },
  'tl.streakLive': { he: 'על רצף של {n}', en: 'On a run of {n}' },
  'tl.streakLive.detail': { he: 'עדיין נמשך', en: 'still going' },
  'tl.droughtEnded': { he: 'ניצח מחזור שוב', en: 'Won a night again' },
  'tl.droughtEnded.detail': { he: 'הראשון מזה {n}', en: 'first in {n}' },
  'tl.bestNight': { he: 'המחזור הטוב ביותר — {n} ניצחונות', en: 'Best night yet — {n} wins' },
  'tl.bestNight.detail': {
    he: 'הכי הרבה שהקבוצה שלו לקחה במחזור אחד',
    en: 'most their team has taken in one evening',
  },
  'tl.totm': { he: 'הרכב החודש', en: 'Team of the Month' },
  'tl.totm.detail': { he: 'נכלל בחמישייה', en: 'named in the five' },
  'tl.showLess': { he: '↑ להציג פחות', en: '↑ Show less' },
  'tl.showMore': {
    he: { one: '↓ רגע מוקדם אחד', other: '↓ {n} רגעים מוקדמים יותר' },
    en: { one: '↓ {n} earlier moment', other: '↓ {n} earlier moments' },
  },

  // --- Titles and badges (achievements.ts, playerProfile.ts) ---------------
  'ach.title.mostWins': { he: 'בראש המועדון', en: 'Top of the Club' },
  'ach.title.mvp': { he: 'הכוכב', en: 'The Star' },
  'ach.title.activeRun': { he: 'על רצף', en: 'On a Run' },
  'ach.title.mostFixtures': { he: 'לוקח המחזורים', en: 'Night Taker' },
  'ach.title.everPresent': { he: 'תמיד נוכח', en: 'Ever Present' },
  'ach.title.shootouts': { he: 'עצבים מברזל', en: 'Nerves of Steel' },
  'ach.title.ironMan': { he: 'איש הברזל', en: 'Iron Man' },
  'ach.title.veteran': { he: 'ותיק', en: 'Veteran' },

  'ach.mostWins': { he: 'הכי הרבה ניצחונות במועדון — {n}', en: 'Most wins in the club — {n}' },
  'ach.mostFixtures': { he: 'הכי הרבה מחזורים שנוצחו — {n}', en: 'Most nights won outright — {n}' },
  'ach.mvp': {
    he: { one: 'הכי הרבה בחירות מצטיין — פעם אחת', other: 'הכי הרבה בחירות מצטיין — {n} פעמים' },
    en: { one: 'Most MVP picks — {n} time', other: 'Most MVP picks — {n} times' },
  },
  'ach.shootouts': {
    he: 'הכי הרבה פנדלים שהקבוצה שלו ניצחה — {n}',
    en: 'Most shootouts won by their team — {n}',
  },
  'ach.ironMan': { he: 'לא פספס מחזור כבר {n}', en: "Hasn't missed a night in {n}" },
  'ach.winStreak': { he: 'הרצף המנצח הארוך ביותר — {n} מחזורים', en: 'Longest winning run — {n} nights' },
  'ach.activeRun': { he: 'על רצף מנצח של {n} מחזורים', en: 'On a {n}-night winning run' },
  'ach.everPresent': { he: 'שיחק בכל מחזור — כל {n}', en: 'Played every night — all {n}' },
  'ach.veteran': { he: '{n} מחזורים ששוחקו', en: '{n} nights played' },

  'ladder.nights': { he: '{n} מחזורים', en: '{n} nights' },
  'ladder.nights.detail': { he: 'שיחק {n} מחזורים שנרשמו.', en: 'Played {n} recorded nights.' },
  'ladder.wins': { he: '{n} ניצחונות', en: '{n} wins' },
  'ladder.wins.detail': {
    he: 'הקבוצות שלו ניצחו {n} משחקים כשהוא על המגרש.',
    en: 'Their teams have won {n} matches with them on the pitch.',
  },
  'ladder.fixtures': { he: '{n} מחזורים שנוצחו', en: '{n} nights won' },
  'ladder.fixtures.detail': { he: 'סיים בראש המחזור {n} פעמים.', en: 'Finished top of the night {n} times.' },
  'ladder.mvp.first': { he: 'מצטיין ראשון', en: 'First MVP' },
  'ladder.mvp.first.detail': { he: 'נבחר למצטיין בפעם הראשונה.', en: 'Picked MVP for the first time.' },
  'ladder.mvp': { he: '{n} מצטיינים', en: '{n} MVPs' },
  'ladder.mvp.detail': { he: 'נבחר למצטיין ב־{n} מחזורים שונים.', en: 'Picked MVP on {n} different nights.' },
} as const satisfies Record<string, Entry>;
