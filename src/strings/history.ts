import type { Entry } from '../i18n';

// The Club tab: the shelf of past nights, a night's organiser drawer, and the
// career table.
//
// The monthly recap, Team of the Month and the rating suggestions used to live
// here too. They moved to `tools.ts` with the panels themselves (§2.55).

export const history = {
  'hist.empty.title': { he: 'עוד לא נרשמו מחזורים', en: 'No nights recorded yet' },
  'hist.empty.body': {
    he: 'צרו הרכבים במחזור, רשמו את המשחקים תוך כדי, ותייקו את המחזור עם 🗂️ שמירה להיסטוריה כשאתם מסיימים. מספרי הקריירה נבנים משם.',
    en: "Generate teams on Match day, log the matches as they're won, and file the night with 🗂️ Save to history when you end it. The career numbers build from there.",
  },
  'hist.title': { he: '📊 סטטיסטיקות המועדון', en: '📊 Club statistics' },
  'hist.recorded': {
    he: { one: 'מחזור אחד נרשם', other: '{n} מחזורים נרשמו' },
    en: { one: '{n} night recorded', other: '{n} nights recorded' },
  },
  'hist.noResult': { he: '{n} נשמרו ללא תוצאה', en: '{n} saved with no result' },

  // --- The shelf of past nights --------------------------------------------
  'hist.shelf.title': { he: '📅 מחזורים קודמים', en: '📅 Past nights' },
  'hist.shelf.read': { he: 'לקרוא את המחזור של {date}', en: 'Read the night of {date}' },
  'hist.shelf.onTheBooks': { he: 'מחזור שנרשם', en: 'A night on the books' },
  'hist.shelf.noResultRecorded': { he: 'לא נרשמה תוצאה', en: 'No result recorded' },
  'hist.shelf.noResult': { he: 'ללא תוצאה', en: 'no result' },
  'hist.shelf.actions': {
    he: 'פעולות מארגן למחזור של {date}',
    en: 'Organiser actions for the night of {date}',
  },

  // --- The organiser's drawer ----------------------------------------------
  'hist.edit.actions': { he: 'פעולות מארגן', en: 'organiser actions' },
  'hist.edit.close': { he: '× סגירה', en: '× close' },
  'hist.edit.wonBy': { he: 'ניצחונות של {team}', en: 'Matches won by {team}' },
  'hist.edit.date': { he: 'תאריך', en: 'Date' },
  'hist.edit.note': { he: 'הערה לכתב', en: 'Note for the reporter' },
  'hist.edit.note.placeholder': {
    he: 'משהו שהתוצאות לא יכולות לספר — ריק כדי למחוק',
    en: "Something the results can't say — empty to delete",
  },
  'hist.edit.note.counter': {
    he: ' · לא מוצג בשום דף — הולך רק לכתב',
    en: ' · never shown on any page — it only goes to the reporter',
  },
  'hist.edit.logged': {
    he: 'המחזור הזה נרשם משחק־משחק, כך שהניצחונות נספרים מהמשחקים ואי אפשר להקליד מעליהם. ',
    en: 'This night was logged match by match, so its wins are counted from the matches and can’t be typed over. ',
  },
  'hist.edit.halfWin': {
    he: 'חצי ניצחון אומר שזה נלקח בפנדלים. ',
    en: 'Half a win means it was taken on penalties. ',
  },
  'hist.edit.sheetFixed': {
    he: 'אי אפשר לשנות את דף ההרכב — מחקו את המחזור ושמרו אותו מחדש אם ההרכבים היו שגויים.',
    en: "The team sheet can't be changed — delete the night and save it again if the teams were wrong.",
  },
  'hist.edit.save': { he: 'שמירת שינויים', en: 'Save changes' },
  'hist.edit.pickMvp': { he: '🌟 בחירת מצטיין', en: '🌟 Pick MVP' },
  'hist.edit.editResult': { he: '✏️ עריכת תוצאה', en: '✏️ Edit result' },
  'hist.edit.delete': { he: '🗑️ מחיקת המחזור הזה', en: '🗑️ Delete this night' },
  'hist.edit.deleteConfirm': {
    he: 'למחוק את המחזור של {date} מההיסטוריה?',
    en: 'Delete the night of {date} from history?',
  },

  // --- Sections -------------------------------------------------------------
  'hist.section.leaders': { he: '🏆 טבלאות מובילים', en: '🏆 Leaderboards' },
  'hist.section.career': { he: '📊 מספרי קריירה', en: '📊 Career numbers' },
  'hist.section.compare': { he: '⚖️ השוואת שני שחקנים', en: '⚖️ Compare two players' },

  // --- The career table -----------------------------------------------------
  'hist.col.name': { he: 'שחקן', en: 'Player' },
  'hist.col.nights': { he: 'מחזורים', en: 'Nights' },
  'hist.col.wins': { he: 'ניצחונות', en: 'Wins' },
  'hist.col.fixtures': { he: 'מחזורים שנלקחו', en: 'Fixtures' },
  'hist.col.perNight': { he: 'לכל מחזור', en: 'Per night' },
  'hist.col.mvps': { he: 'מצטיינים', en: 'MVPs' },
  'hist.col.vsRating': { he: 'מול הדירוג', en: 'vs rating' },
  'hist.vsRating.note': {
    he: ' לוקח בחשבון עם מי ונגד מי שיחקו, כך שהוא יכול להציב מישהו מעל חבר לקבוצה עם מספר גבוה יותר למחזור. ריק מתחת ל־{n} מחזורים.',
    en: ' accounts for who they played with and against, so it can put someone above a teammate on a higher per-night number. Blank under {n} nights.',
  },
  'hist.fixturesWon.title': {
    he: 'מחזורים שלמים שהקבוצה של השחקן הזה סיימה בראש',
    en: "Whole nights this player's team finished top of",
  },
  'hist.vsRating.needs': {
    he: 'צריך {n} מחזורים לפני שזה אומר משהו',
    en: 'Needs {n} nights before this means anything',
  },
  'hist.vsRating.meaningful': {
    he: 'מבצע באופן עקבי מעל/מתחת לדירוג שלו',
    en: 'Consistently over/under-performing their rating',
  },
  'hist.vsRating.thin': {
    he: 'עוד אין מספיק ראיות כדי לקרוא מזה משהו',
    en: 'Not enough evidence to read anything into this yet',
  },
} as const satisfies Record<string, Entry>;
