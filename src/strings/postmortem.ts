import type { Entry } from '../i18n';

// The night post-mortem (§2.54): an admin-only diagnostic that answers "why
// were the teams uneven" — usually with "they weren't, that's the format".
//
// The tone matters here more than in most of the app. Every one of these
// strings is a verdict on the organiser's own team-making, delivered to the
// person who made the teams, so they are written to explain rather than to
// grade. "The format did this" is the most common answer and it is phrased as
// a relief, not a shrug.

export const postmortem = {
  'pm.title': { he: '🔍 ניתוח איזון הקבוצות', en: '🔍 Why were the teams uneven?' },

  // --- The season verdict ---------------------------------------------------
  'pm.season.heading': { he: 'התמונה הכללית', en: 'The big picture' },
  'pm.season.empty': {
    he: 'עוד אין מחזורים עם תוצאה לנתח.',
    en: 'No nights with a result to analyse yet.',
  },
  // The headline. Deliberately leads with the format, because that is what the
  // numbers almost always say.
  'pm.season.median': {
    he: 'פער חציוני בין הקבוצה הראשונה לאחרונה: {actual} נצחונות. קבוצות שוות לגמרי היו מייצרות {equal}.',
    en: 'Median gap between first and last team: {actual} wins. Perfectly equal teams would give {equal}.',
  },
  'pm.season.lopsided': {
    he: '{n} מתוך {of} מחזורים היו חריגים מעבר למה שהפורמט מסביר — כשגם בקבוצות מושלמות היינו מצפים לכ־{expected}.',
    en: '{n} of {of} nights were lopsided beyond what the format explains — where even perfect teams would give about {expected}.',
  },
  'pm.season.inconclusive': {
    he: '⏳ {n} מחזורים זה מעט מדי כדי להבדיל בין הרכבים לא מאוזנים לבין מזל. בערך {need} מחזורים יתנו תשובה.',
    en: "⏳ {n} nights is too few to tell uneven team-making from luck. About {need} nights would answer it.",
  },
  'pm.season.settled': {
    he: '✅ מספיק מחזורים כדי להסיק מסקנות.',
    en: '✅ Enough nights on record to draw a conclusion.',
  },

  // --- How the format works -------------------------------------------------
  'pm.format.title': { he: 'למה מחזור נראה חד־צדדי', en: 'Why a night looks one-sided' },
  'pm.format.body': {
    he: 'המנצח נשאר על המגרש. זה אומר שהקבוצה שמנצחת גם *משחקת יותר*, ולכן צוברת יותר נצחונות ממה שאחוז הנצחונות שלה לבדו מסביר. בסימולציה של מחזורים בין חמישה־עשר שחקנים זהים לחלוטין, הפער החציוני הוא 3.5 נצחונות, ואחד מכל ארבעה מחזורים נגמר בפער של 5 ומעלה.',
    en: 'The winner stays on. That means the team that is winning is also *playing more*, so it collects more wins than its win rate alone explains. Simulating nights between fifteen identical players gives a median gap of 3.5 wins, and one night in four ends 5 or more apart.',
  },

  // --- A night --------------------------------------------------------------
  'pm.nights.title': { he: 'מחזור אחר מחזור ({n})', en: 'Night by night ({n})' },
  'pm.night.spread': { he: 'פער {n}', en: '{n} apart' },
  'pm.night.percentile': {
    he: 'אחוזון {n} מול קבוצות שוות',
    en: '{n}th percentile against equal teams',
  },
  'pm.night.estimated': {
    he: 'מספר המשחקים משוער — המחזור לא נרשם משחק־משחק',
    en: 'Match count estimated — this night was not logged match by match',
  },

  'pm.cause.format': { he: 'הפורמט', en: 'the format' },
  'pm.cause.sheet': { he: 'ההרכב', en: 'the sheet' },
  'pm.cause.ratings': { he: 'הדירוגים', en: 'the ratings' },
  'pm.cause.unclear': { he: 'לא ברור', en: 'unclear' },

  'pm.cause.format.why': {
    he: 'הפער הזה נמצא בתוך מה שהפורמט מייצר גם מקבוצות שוות. אין פה מה לתקן.',
    en: 'This gap sits inside what the format produces from equal teams. Nothing to fix here.',
  },
  'pm.cause.sheet.why': {
    he: 'ההרכבים לא היו שווים על הנייר עוד לפני השריקה — הפער בדירוג הממוצע היה {gap}.',
    en: 'The teams were not level on paper before kick-off — the rating averages were {gap} apart.',
  },
  'pm.cause.ratings.why': {
    he: 'על הנייר ההרכבים היו שווים, אבל לפי התוצאות לאורך זמן הם לא באמת היו.',
    en: 'Level on paper, but the results over time say the teams were not actually even.',
  },
  'pm.cause.unclear.why': {
    he: 'המחזור היה חד־צדדי יותר ממה שהפורמט מסביר, אבל ההרכב היה מאוזן ואין מספיק נתונים כדי להאשים את הדירוגים.',
    en: 'More one-sided than the format explains, but the sheet was level and there is not enough data to blame the ratings.',
  },

  // --- The buckets ----------------------------------------------------------
  'pm.rate.title': { he: 'נצחונות מול משחקים ששוחקו', en: 'Wins vs matches played' },
  'pm.rate.note': {
    he: 'הקבוצה שנשארת על המגרש משחקת יותר. אחוז הנצחונות הוא ההשוואה ההוגנת.',
    en: 'A team that stays on plays more matches. The win rate is the fair comparison.',
  },
  'pm.rate.of': { he: '{wins} מתוך {played}', en: '{wins} of {played}' },
  'pm.rate.unavailable': {
    he: 'רק מחזור שנרשם משחק־משחק יכול להגיד כמה משחקים כל קבוצה שיחקה.',
    en: 'Only a night logged match by match can say how many matches each team played.',
  },

  'pm.paper.title': { he: 'האיזון על הנייר', en: 'Balance on paper' },
  'pm.paper.gap': { he: 'פער של {gap} כוכבים', en: '{gap}★ apart' },
  'pm.paper.level': { he: 'ההרכבים היו מאוזנים', en: 'The sheet was level' },
  'pm.paper.gkNote': {
    he: 'שוער מהשדה לא נספר בממוצע ההתקפי — בדיוק כפי שהמאזן חישב.',
    en: 'An outfield player in goal is left out of the average — exactly as the balancer scored it.',
  },
  'pm.paper.noGk': {
    he: 'למחזור הזה לא נשמר מי עמד בשער, אז הממוצע הוא קירוב.',
    en: 'This night has no record of who kept goal, so the average is approximate.',
  },

  'pm.ratings.title': { he: 'טעות בדירוגים', en: 'Rating error carried in' },
  'pm.ratings.uncertain': {
    he: 'אין עדיין מספיק מחזורים כדי להגיד אם מישהו טוב או חלש מהדירוג שלו. זו התשובה הכנה, לא פער בכלי.',
    en: 'Not enough nights yet to say whether anyone is better or worse than their rating. That is the honest answer, not a gap in the tool.',
  },
  'pm.ratings.gap': {
    he: 'אחרי תיקון לפי התוצאות, הפער בין הקבוצות היה {gap} כוכבים.',
    en: 'Corrected for results over time, the teams were really {gap}★ apart.',
  },
  // "We looked and found nothing" — a different statement from "we cannot see
  // yet", and worth its own sentence so the tool stops saying "not enough
  // nights" on a history that has long since become conclusive.
  'pm.ratings.level': {
    he: 'לפי התוצאות לאורך זמן, הדירוגים של השחקנים האלה נראים נכונים. ההרכב היה מאוזן גם במציאות.',
    en: 'Judged on results over time, these players are rated about right. The sheet was level in life as well as on paper.',
  },
  // The interval itself, so "cannot tell" is a number rather than a shrug —
  // and so it can be watched narrowing as the club plays more football.
  'pm.ratings.margin': {
    he: 'תיקון מדוד: {correction}★ ± {margin}',
    en: 'Measured correction: {correction}★ ± {margin}',
  },

  'pm.expected.title': { he: 'מה היה צפוי', en: 'What was expected' },
  'pm.expected.equal': { he: 'קבוצות שוות', en: 'Equal teams' },
  'pm.expected.paper': { he: 'ההרכב שנבנה', en: 'The sheet as built' },
  'pm.expected.actual': { he: 'מה שקרה בפועל', en: 'What actually happened' },
} as const satisfies Record<string, Entry>;
