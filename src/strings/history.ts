import type { Entry } from '../i18n';

// The Club tab: the shelf of past nights, the career table, the organiser's
// monthly tooling, and the rating suggestions.

export const history = {
  'hist.empty.title': { he: 'עוד לא נרשמו מחזורים', en: 'No nights recorded yet' },
  'hist.empty.body': {
    he: 'צרו הרכבים במחזור, רשמו את המשחקים תוך כדי, ותייקו את המחזור עם 🗂️ שמירה להיסטוריה כשאתם מסיימים. מספרי הקריירה והצעות הדירוג נבנים משם.',
    en: "Generate teams on Match day, log the matches as they're won, and file the night with 🗂️ Save to history when you end it. The career numbers and rating suggestions build from there.",
  },
  'hist.title': { he: '📊 סטטיסטיקות המועדון', en: '📊 Club statistics' },
  'hist.recorded': {
    he: { one: 'מחזור אחד נרשם', other: '{n} מחזורים נרשמו' },
    en: { one: '{n} night recorded', other: '{n} nights recorded' },
  },
  'hist.noResult': { he: '{n} נשמרו ללא תוצאה', en: '{n} saved with no result' },

  // --- Monthly recap --------------------------------------------------------
  'hist.recap.title': { he: '📊 סיכום חודשי', en: '📊 Monthly recap' },
  'hist.recap.share': { he: '🖼️ שיתוף סיכום', en: '🖼️ Share recap' },

  // --- Team of the Month ----------------------------------------------------
  'hist.totm.title': { he: '👕 הרכב החודש', en: '👕 Team of the Month' },
  'hist.totm.hint': {
    he: 'נרשם מעצמו ב־1 בחודש — זה כאן בשביל אתחול ותיקונים',
    en: 'registers itself on the 1st — this is for seeding and corrections',
  },
  'hist.totm.registered': { he: ' · נרשם ב־{date}', en: ' · registered {date}' },
  'hist.totm.notRegistered': { he: 'לא נרשם', en: 'not registered' },
  'hist.totm.stillPlayed': { he: ' · עוד משחקים אותו', en: ' · still being played' },
  'hist.totm.runningConfirm': {
    he: '{period} עוד לא נגמר. תקבלו את ההרכב כפי שהוא היום, וה־1 בחודש לא יחליף אותו — הסירו אותו כשתסיימו לבדוק והוא יירשם כמו שצריך. להמשיך?',
    en: "{period} isn't over. You'll get the team as it stands today, and the 1st won't replace it — remove it when you're done testing and it'll register itself properly. Go ahead?",
  },
  'hist.totm.reregister.title': {
    he: 'לנקד את החודש הזה מחדש ולדרוס את מה ששמור',
    en: 'Score this month again and overwrite what is stored',
  },
  'hist.totm.register.title': {
    he: 'לרשום את חמשת השחקנים של החודש עכשיו',
    en: "Write this month's five down now",
  },
  'hist.totm.reregister': { he: 'רישום מחדש', en: 'Re-register' },
  'hist.totm.register': { he: 'רישום', en: 'Register' },
  'hist.totm.removeConfirm': {
    he: 'להסיר את הרכב החודש עבור {period}?',
    en: 'Remove the Team of the Month for {period}?',
  },
  'hist.totm.remove.title': {
    he: 'לשכוח מזה. ה־1 בחודש ירשום את החודש הזה מחדש אם הוא נגמר.',
    en: 'Forget it. The 1st will register this month again if it is over.',
  },
  'hist.totm.remove': { he: 'הסרה', en: 'Remove' },

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
  'hist.edit.wonBy': { he: 'משחקים שנוצחו על ידי {team}', en: 'Matches won by {team}' },
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

  // --- Rating suggestions ---------------------------------------------------
  'hist.sugg.title': { he: '📈 הצעות דירוג', en: '📈 Rating suggestions' },
  'hist.sugg.body': {
    he: 'מבוסס על איך שהקבוצות של כל שחקן מסתדרות מול מה שהדירוג שלו מנבא, בהתחשב במי שהוא שיחק לצידו. הצעות מוקדמות נשענות על קומץ מחזורים — התייחסו אליהן כרמז להסתכל, לא כפסק דין.',
    en: "Based on how each player's teams do against what their rating predicts, allowing for who they lined up with. Early ones rest on a handful of nights — treat those as a nudge to look, not a verdict.",
  },
  'hist.sugg.staysAt': { he: 'נשאר על {r}', en: 'stays at {r}' },
  'hist.sugg.nights': {
    he: { one: 'מחזור אחד', other: '{n} מחזורים' },
    en: { one: '{n} night', other: '{n} nights' },
  },
  'hist.sugg.wins': { he: '{n} ניצחונות', en: '{n} wins' },
  'hist.sugg.early': { he: 'מוקדם', en: 'early' },
  'hist.sugg.solid': { he: 'מבוסס', en: 'solid' },
  'hist.sugg.strong': { he: 'חזק', en: 'strong' },
  'hist.sugg.early.title': { he: 'מוקדם — עוד יכול להיות מזל', en: 'Early — could still be luck' },
  'hist.sugg.held.title': {
    he: 'הדפוס החזיק מעמד על פני עוד כדורגל',
    en: 'The pattern has held up over more football',
  },
  'hist.sugg.apply': { he: 'החלה', en: 'Apply' },
  'hist.sugg.dismiss': { he: 'ביטול', en: 'Dismiss' },
  'hist.sugg.atLimit.up': {
    he: 'כבר על {r}★ — הסולם נעצר כאן, אבל התוצאות אומרות שהוא מקדים אפילו יותר ממה ש־{r} יכול להראות. קבוצות שנבנות סביבו חזקות יותר משהמספרים מודים, אז הורידו את שאר הסגל אם זה נמשך.',
    en: "Already at {r}★ — the scale stops here, but the results say they're further ahead than a {r} can show. Teams built around them are stronger than the numbers admit, so nudge the rest of the roster down if this keeps up.",
  },
  'hist.sugg.atLimit.down': {
    he: 'כבר על {r}★ — הסולם נעצר כאן, אבל התוצאות אומרות שהוא מפגר אפילו יותר ממה ש־{r} יכול להראות. קבוצות שנושאות אותו חלשות יותר משהמספרים מודים.',
    en: "Already at {r}★ — the scale stops here, but the results say they're further behind than a {r} can show. Teams carrying them are weaker than the numbers admit.",
  },

  // --- The career table -----------------------------------------------------
  'hist.col.name': { he: 'שחקן', en: 'Player' },
  'hist.col.nights': { he: 'מחזורים', en: 'Nights' },
  'hist.col.wins': { he: 'ניצחונות', en: 'Wins' },
  'hist.col.fixtures': { he: 'מחזורים שנוצחו', en: 'Fixtures' },
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
