import type { Entry } from '../i18n';

// The monthly recap poster (§2.20) — four canvas pages the organiser sends to
// the group chat when a month is done.
//
// This is the one surface where the *image* carries the language rather than
// the app around it, so it reads in whichever language the organiser was in
// when they pressed Share. `canvasKit` already handles the bidi shaping that
// makes a Hebrew name sit correctly beside a number.

export const share = {
  'wr.brand': { he: '🦁 ארמונים FC', en: '🦁 Armonim FC' },
  'wr.subtitle': { he: 'סיכום חודשי', en: 'Monthly recap' },
  'wr.footer': {
    he: 'כל מספר כאן הוא ספירה, לא פסק דין.',
    en: 'Every number here is a count, not a verdict.',
  },

  // --- Page 1: the podiums --------------------------------------------------
  'wr.nightsPlayed': { he: 'מחזורים ששוחקו', en: 'nights played' },
  'wr.thisMonth': { he: 'החודש', en: 'this month' },
  'wr.totalWins': { he: '⚽ {n} ניצחונות נצברו על ידי הסגל', en: '⚽ {n} wins banked by the squad' },
  'wr.topMvp': { he: '🌟 הכי הרבה בחירות מצטיין', en: '🌟 Most MVP picks' },
  'wr.topMvp.stat': {
    he: { one: 'מצטיין אחד', other: '{n} מצטיינים' },
    en: { one: '{n} MVP', other: '{n} MVPs' },
  },
  'wr.topWins': { he: '🏅 הכי הרבה משחקים שנוצחו', en: '🏅 Most matches won' },
  'wr.topWins.stat': { he: '{n} ניצחונות', en: '{n} wins' },
  'wr.topFixtures': { he: '🏆 הכי הרבה מחזורים שנוצחו', en: '🏆 Most fixtures won' },
  'wr.topFixtures.stat': {
    he: { one: 'מחזור אחד', other: '{n} מחזורים' },
    en: { one: '{n} fixture', other: '{n} fixtures' },
  },

  // --- Page 2: the winning teams -------------------------------------------
  'wr.page.teams': { he: 'הקבוצות המנצחות', en: 'Winning Teams' },
  // A night two teams finished level on, so both are on the card.
  'wr.sharedNight': {
    he: { one: '🤝 {date} · ניצחון אחד לכל אחת', other: '🤝 {date} · {n} ניצחונות לכל אחת' },
    en: { one: '🤝 {date} · {n} win each', other: '🤝 {date} · {n} wins each' },
  },

  // --- Page 3: the breakdown ------------------------------------------------
  'wr.page.breakdown': { he: 'הפירוט', en: 'The breakdown' },
  'wr.marks.best': { he: 'הממוצע הגבוה ביותר', en: 'Highest average' },
  'wr.marks.worst': { he: 'הממוצע הנמוך ביותר', en: 'Lowest average' },
  'wr.bully.detail': {
    he: 'המאזן הכי חד־צדדי של החודש — {n} משחקים מולו',
    en: "the month's most lopsided record — {n} matches faced",
  },
  'wr.duo.detail': { he: 'מחזורים שנוצחו יחד', en: 'nights won together' },
  'wr.run.detail': { he: 'משחקים ברצף', en: 'matches in a row' },
  'wr.reservists': {
    he: 'שיחקו פעם או פעמיים, ועדיין לקחו מחזור',
    en: 'played once or twice, and still took a night',
  },
  'wr.reservists.wins': {
    he: { one: 'ניצחון אחד', other: '{n} ניצחונות' },
    en: { one: '{n} win', other: '{n} wins' },
  },

  'wr.benched': { he: 'הכי הרבה על הספסל', en: 'Benched most' },
  'wr.benched.detail': {
    he: { one: 'ישב בחוץ משחק אחד', other: 'ישב בחוץ {n} משחקים' },
    en: { one: 'sat out {n} match', other: 'sat out {n} matches' },
  },
  'wr.cursedShirt': { he: 'החולצה הביש־מזלית', en: 'Unlucky shirt' },
  'wr.cursedShirt.detail': {
    he: 'ניצחה ב־{won} מתוך {played} מחזורים',
    en: 'won {won} of {played} nights',
  },
  'wr.outOfGas': { he: 'הזינוק המהיר ביותר', en: 'Fastest starter' },
  'wr.outOfGas.detail': { he: '{early}% בהתחלה, {late}% בסוף', en: '{early}% early, {late}% late' },
  'wr.bottomScorer': { he: 'הכי מעט ניצחונות', en: 'Fewest wins' },
  'wr.bottomScorer.detail': {
    he: { one: '{wins} במחזור אחד', other: '{wins} ב־{n} מחזורים' },
    en: { one: '{wins} in {n} night', other: '{wins} in {n} nights' },
  },
  'wr.longestWait': { he: 'ההמתנה הארוכה ביותר', en: 'Longest wait' },
  'wr.longestWait.detail': {
    he: { one: 'מחזור אחד בלי ניצחון', other: '{n} מחזורים בלי ניצחון' },
    en: { one: '{n} night without a win', other: '{n} nights without a win' },
  },

  // --- Page 4: the month's achievements ------------------------------------
  'wr.page.achievements': { he: 'הישגים', en: 'Achievements' },
  'wr.group.debuts': { he: '✨ מחזור ראשון במועדון', en: '✨ First night at the club' },
  'wr.group.nights': { he: '🎉 הגיעו לאבן דרך של מחזורים', en: '🎉 Hit a milestone night' },
  'wr.group.wins': { he: '🏆 הגיעו לאבן דרך של ניצחונות', en: '🏆 Hit a milestone win' },
  'wr.group.ironman': { he: '🦾 הגיעו כל שבוע', en: '🦾 Turned up every week' },
  'wr.group.streaks': { he: '📈 על רצף מנצח', en: '📈 On a winning run' },
  'wr.group.droughts': { he: '💤 עדיין מחכים לניצחון', en: '💤 Still waiting for a win' },
  'wr.chip.newFaces': { he: '{n} פנים חדשות', en: '{n} new faces' },
  'wr.chip.nthNight': { he: 'המחזור ה־{n}', en: '{n}th night' },
  'wr.chip.nthWin': { he: 'הניצחון ה־{n}', en: '{n}th win' },
  'wr.chip.ironman': { he: '{n} שבועות ברצף', en: '{n} weeks in a row' },
  'wr.chip.streak': { he: '{n} מחזורים ברצף', en: '{n} nights running' },
  'wr.chip.drought': { he: '{n} מחזורים עד כה', en: '{n} nights so far' },
} as const satisfies Record<string, Entry>;
