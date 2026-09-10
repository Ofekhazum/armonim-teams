import type { Entry } from '../i18n';

// The match clock and everything hanging off it: the banner that shouts at one
// minute left, the notification opt-in beside it, and the organiser's
// diagnostic for when that opt-in silently does nothing.

export const clock = {
  // --- The clock card -------------------------------------------------------
  'clock.banner.penalties': { he: '🥅 עדיין שוויון — פנדלים', en: '🥅 Still level — penalties' },
  'clock.banner.fullTime': {
    he: '⏱️ סיום — שוויון? {n} דקות, גול זהב',
    en: '⏱️ Full time — level? {n} minutes, golden goal',
  },
  'clock.banner.oneMinute': {
    he: '🔔 דקה — הקבוצה שנחה צועקת!',
    en: '🔔 One minute — resting team shouts!',
  },
  'clock.banner.added': { he: '⚽ זמן נוסף — גול זהב', en: '⚽ Added time — golden goal' },

  // The same states in two or three words, for pitch mode — from ten metres
  // away neither the emoji nor the sentence survives.
  'clock.head.penalties': { he: 'פנדלים', en: 'Penalties' },
  'clock.head.fullTime': { he: 'סיום', en: 'Full time' },
  'clock.head.oneMinute': { he: 'דקה', en: 'One minute' },
  'clock.head.added': { he: 'זמן נוסף', en: 'Added time' },
  'clock.head.paused': { he: 'מושהה', en: 'Paused' },

  'clock.pause': { he: '⏸ השהיה', en: '⏸ Pause' },
  'clock.startAdded': { he: '▶️ התחלת זמן נוסף', en: '▶️ Start added time' },
  'clock.startMatch': { he: '▶️ התחלת משחק', en: '▶️ Start match' },
  'clock.resume': { he: '▶️ המשך', en: '▶️ Resume' },
  'clock.level': { he: '⚽ שוויון — זמן נוסף', en: '⚽ Level — added time' },
  'clock.addTime.title': { he: 'הוספת 30 שניות לשעון', en: 'Add 30 seconds to the clock' },
  'clock.next': { he: '⏭ המשחק הבא', en: '⏭ Next match' },
  'clock.reset': { he: '↺ איפוס', en: '↺ Reset' },
  'clock.reset.title': { he: 'איפוס השעון למשחק הבא', en: 'Reset the clock for the next match' },
  'clock.inProgress': { he: 'משחק בעיצומו', en: 'match in progress' },
  'clock.pitchMode': { he: '⛶ מצב מגרש', en: '⛶ Pitch mode' },
  'clock.pitchMode.title': {
    he: 'מסך מלא — לטלפון שמונח על התיק במגרש',
    en: 'Fill the screen — for a phone propped up at the pitch',
  },

  // --- The notification opt-in ---------------------------------------------
  'notify.on': { he: '🔔 התראות פועלות', en: '🔔 Alerts on' },
  'notify.off': { he: '🔕 התראות כבויות', en: '🔕 Alerts off' },
  'notify.on.title': {
    he: 'להפסיק את הרטט במכשיר הזה בדקה האחרונה ובסיום',
    en: 'Stop this device buzzing at one minute left and full time',
  },
  'notify.off.title': {
    he: 'לרטוט במכשיר הזה בדקה האחרונה ובסיום, גם כשהמסך כבוי',
    en: 'Buzz this device at one minute left and full time, even with the screen off',
  },
  'notify.denied': { he: 'חסום בהגדרות הדפדפן', en: 'Blocked in your browser settings' },
  'notify.notConfigured': { he: 'עוד לא הוגדר בשרת', en: 'Not set up on the server yet' },
  'notify.failed': { he: 'לא הצלחנו להפעיל — נסו שוב', en: "Couldn't turn on — try again" },
  'notify.needsInstall': {
    he: '🔔 להתראות משחק: שיתוף ← הוספה למסך הבית, ואז פתחו משם',
    en: '🔔 For match alerts: Share → Add to Home Screen, then open it from there',
  },
  'notify.needsInstall.title': {
    he: 'אפל מאפשרת התראות רק לאפליקציות ווב שהותקנו למסך הבית',
    en: 'Apple only allows notifications for web apps installed to the Home Screen',
  },

  // --- The organiser's alert diagnostic ------------------------------------
  'alerts.test': { he: '🔎 בדיקת התראות', en: '🔎 Test alerts' },
  'alerts.test.title': {
    he: 'לרטוט בטלפון הזה עכשיו ולדווח מה ענה כל שלב',
    en: 'Buzz this phone now and report what each step answered',
  },
  'alerts.unreachable': { he: 'לא הצלחנו להגיע לשרת', en: "Couldn't reach the server" },
  'alerts.configured': { he: 'השרת יכול לשלוח', en: 'server can send' },
  'alerts.noVapid': { he: 'לשרת אין מפתח VAPID', en: 'server has no VAPID key' },
  'alerts.neverSubscribed': {
    he: 'המכשיר הזה מעולם לא נרשם — הפעילו 🔔 התראות',
    en: 'this device never subscribed — turn 🔔 Alerts on',
  },
  'alerts.subscribed': {
    he: 'רשום ({n} מכשירים בסך הכול)',
    en: 'subscribed ({n} devices total)',
  },
  'alerts.unknownHere': {
    he: 'נרשם כאן, אבל השרת מעולם לא שמע עליו',
    en: 'subscribed here, but the server has never heard of it',
  },
  'alerts.answered': { he: '{host} ענה {status}', en: '{host} answered {status}' },
  'alerts.keyOk': { he: 'מפתח החתימה עקבי עם עצמו', en: 'signing key is self-consistent' },
  'alerts.keyBad': {
    he: 'סוד ה־VAPID פגום — החצי הציבורי והפרטי שלו לא מסכימים',
    en: 'the VAPID secret is corrupt — its public and private halves disagree',
  },
  'alerts.subject': { he: 'נושא: {subject}', en: 'subject: {subject}' },
  'alerts.keyMismatch': {
    he: 'הרישום הזה נעשה מול מפתח אחר — כבו 🔔 ואז הפעילו',
    en: 'this subscription was made against a different key — turn 🔔 off, then on',
  },
  'alerts.keyUnknown': {
    he: 'לא הצלחנו להשוות את הרישום הזה למפתח הנוכחי',
    en: 'could not compare this subscription to the current key',
  },
  'alerts.keyMatches': { he: 'הרישום תואם למפתח הנוכחי', en: 'subscription matches the current key' },
  'alerts.next': { he: 'ההתראה הבאה: {kind} בעוד {in}', en: 'next alert: {kind} in {in}' },
  'alerts.nothingScheduled': {
    he: 'לא מתוזמן כלום — הפעילו את השעון ולחצו שוב',
    en: 'nothing scheduled — start the clock, then press this again',
  },
  'alerts.sent': {
    he: 'נשלח. אם לא הופיעה התראה תוך כמה שניות ← הטלפון סירב לה, לא השרת.',
    en: 'Sent. No banner within a few seconds → the phone refused it, not the server.',
  },
} as const satisfies Record<string, Entry>;
