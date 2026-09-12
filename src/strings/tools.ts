import type { Entry } from '../i18n';

// The Admin tools page (§2.55): the organiser's workbench — things you go
// somewhere to *use*, as opposed to the editing controls that stay beside the
// thing they edit.
//
// Everything here was on the Club tab until this page existed, which is why
// the recap, Team of the Month and rating-suggestion strings read the way they
// do: they were written to sit among a club's statistics. They keep their
// wording and change only their prefix, since the prefix names the screen.

export const tools = {
  'tools.title': { he: '🛠️ כלי מנהל', en: '🛠️ Admin tools' },
  'tools.intro': {
    he: 'הדברים שמפעילים מדי פעם: סיכום חודשי, הרכב החודש, ניתוח האיזון ובדיקת התראות. עריכה של מחזור או של שחקן נשארה במקום שבו הם נמצאים.',
    en: 'The things you run now and then: the monthly recap, Team of the Month, the balance analysis and the alerts check. Editing a night or a player stays where the night or the player is.',
  },

  // --- Monthly recap --------------------------------------------------------
  'tools.recap.title': { he: '📊 סיכום חודשי', en: '📊 Monthly recap' },
  'tools.recap.share': { he: '🖼️ שיתוף סיכום', en: '🖼️ Share recap' },

  // --- Team of the Month ----------------------------------------------------
  'tools.totm.title': { he: '👕 הרכב החודש', en: '👕 Team of the Month' },
  'tools.totm.hint': {
    he: 'נרשם מעצמו ב־1 בחודש — זה כאן בשביל אתחול ותיקונים',
    en: 'registers itself on the 1st — this is for seeding and corrections',
  },
  'tools.totm.registered': { he: ' · נרשם ב־{date}', en: ' · registered {date}' },
  'tools.totm.notRegistered': { he: 'לא נרשם', en: 'not registered' },
  'tools.totm.stillPlayed': { he: ' · עוד משחקים אותו', en: ' · still being played' },
  'tools.totm.runningConfirm': {
    he: '{period} עוד לא נגמר. תקבלו את ההרכב כפי שהוא היום, וה־1 בחודש לא יחליף אותו — הסירו אותו כשתסיימו לבדוק והוא יירשם כמו שצריך. להמשיך?',
    en: "{period} isn't over. You'll get the team as it stands today, and the 1st won't replace it — remove it when you're done testing and it'll register itself properly. Go ahead?",
  },
  'tools.totm.reregister.title': {
    he: 'לנקד את החודש הזה מחדש ולדרוס את מה ששמור',
    en: 'Score this month again and overwrite what is stored',
  },
  'tools.totm.register.title': {
    he: 'לרשום את חמשת השחקנים של החודש עכשיו',
    en: "Write this month's five down now",
  },
  'tools.totm.reregister': { he: 'רישום מחדש', en: 'Re-register' },
  'tools.totm.register': { he: 'רישום', en: 'Register' },
  'tools.totm.removeConfirm': {
    he: 'להסיר את הרכב החודש עבור {period}?',
    en: 'Remove the Team of the Month for {period}?',
  },
  'tools.totm.remove.title': {
    he: 'לשכוח מזה. ה־1 בחודש ירשום את החודש הזה מחדש אם הוא נגמר.',
    en: 'Forget it. The 1st will register this month again if it is over.',
  },
  'tools.totm.remove': { he: 'הסרה', en: 'Remove' },

  // --- Rating suggestions ---------------------------------------------------
  'tools.sugg.title': { he: '📈 הצעות דירוג', en: '📈 Rating suggestions' },
  'tools.sugg.body': {
    he: 'מבוסס על איך שהקבוצות של כל שחקן מסתדרות מול מה שהדירוג שלו מנבא, בהתחשב במי שהוא שיחק לצידו. הצעות מוקדמות נשענות על קומץ מחזורים — התייחסו אליהן כרמז להסתכל, לא כפסק דין.',
    en: "Based on how each player's teams do against what their rating predicts, allowing for who they lined up with. Early ones rest on a handful of nights — treat those as a nudge to look, not a verdict.",
  },
  'tools.sugg.staysAt': { he: 'נשאר על {r}', en: 'stays at {r}' },
  'tools.sugg.nights': {
    he: { one: 'מחזור אחד', other: '{n} מחזורים' },
    en: { one: '{n} night', other: '{n} nights' },
  },
  'tools.sugg.wins': { he: '{n} ניצחונות', en: '{n} wins' },
  'tools.sugg.early': { he: 'מוקדם', en: 'early' },
  'tools.sugg.solid': { he: 'מבוסס', en: 'solid' },
  'tools.sugg.strong': { he: 'חזק', en: 'strong' },
  'tools.sugg.early.title': { he: 'מוקדם — עוד יכול להיות מזל', en: 'Early — could still be luck' },
  'tools.sugg.held.title': {
    he: 'הדפוס החזיק מעמד על פני עוד כדורגל',
    en: 'The pattern has held up over more football',
  },
  'tools.sugg.apply': { he: 'החלה', en: 'Apply' },
  'tools.sugg.dismiss': { he: 'ביטול', en: 'Dismiss' },
  'tools.sugg.atLimit.up': {
    he: 'כבר על {r}★ — הסולם נעצר כאן, אבל התוצאות אומרות שהוא מקדים אפילו יותר ממה ש־{r} יכול להראות. קבוצות שנבנות סביבו חזקות יותר משהמספרים מודים, אז הורידו את שאר הסגל אם זה נמשך.',
    en: "Already at {r}★ — the scale stops here, but the results say they're further ahead than a {r} can show. Teams built around them are stronger than the numbers admit, so nudge the rest of the roster down if this keeps up.",
  },
  'tools.sugg.atLimit.down': {
    he: 'כבר על {r}★ — הסולם נעצר כאן, אבל התוצאות אומרות שהוא מפגר אפילו יותר ממה ש־{r} יכול להראות. קבוצות שנושאות אותו חלשות יותר משהמספרים מודים.',
    en: "Already at {r}★ — the scale stops here, but the results say they're further behind than a {r} can show. Teams carrying them are weaker than the numbers admit.",
  },
  // The panel is off at this club's volume (see ratingPanel.ts). Without this
  // the section would simply not be here, and "not here" is indistinguishable
  // from "broken" to the person who remembers it existing.
  'tools.sugg.notReady': {
    he: '⏳ הצעות דירוג כבויות עד שיהיו מספיק מחזורים רשומים כדי שהן יהיו צודקות לעיתים קרובות יותר משהן טועות.',
    en: '⏳ Rating suggestions are off until there are enough recorded nights for them to be right more often than wrong.',
  },

  // --- Alerts ---------------------------------------------------------------
  'tools.alerts.title': { he: '🔔 התראות', en: '🔔 Alerts' },
  'tools.alerts.body': {
    he: 'התראה שלא מגיעה לא משאירה שום עקבה. הכפתור מרטיט את המכשיר הזה בלבד ומדפיס מה כל חוליה בשרשרת ענתה.',
    en: 'A notification that never arrives leaves no trace anywhere. This buzzes only this device and prints what each link in the chain said.',
  },

  // --- The balance analysis -------------------------------------------------
  // The post-mortem brings its own title (`pm.title`); this is the empty case,
  // which only Admin tools can hit — the Club tab never rendered it at all
  // until there was a night to read.
  'tools.postmortem.empty': {
    he: 'עוד אין מחזורים לנתח.',
    en: 'No nights to analyse yet.',
  },
} as const satisfies Record<string, Entry>;
