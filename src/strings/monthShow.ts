import type { Entry } from '../i18n';

// The month's show (§2.74), on the organiser's workbench. Its own file so the
// feature arrives — and, if it ever has to, leaves — as one block.
export const monthShow = {
  'tools.show.title': { he: '🎙️ תוכנית החודש', en: '🎙️ The month’s show' },
  'tools.show.hint': {
    he: 'תוכנית רדיו קצרה על החודש: האירועים, הפרסים והרכב החודש בספירה לאחור. רק אתם רואים את הטקסט; הקבוצה מקבלת את ההקלטה.',
    en: 'A short radio show about the month: the events, the awards, and the Team of the Month as a countdown. Only you see the text; the group gets the recording.',
  },
  'tools.show.month': { he: 'חודש', en: 'Month' },
  'tools.show.none': {
    he: 'עוד אין חודש עם מחזור מתועד.',
    en: 'No month has a recorded night yet.',
  },
  'tools.show.nothing': { he: 'עוד לא נכתבה תוכנית לחודש הזה.', en: 'No show written for this month yet.' },
  'tools.show.write': { he: '✍️ לכתוב את התוכנית', en: '✍️ Write the show' },
  'tools.show.soFar': {
    he: 'החודש עוד לא נגמר: התוכנית תספר את החודש עד עכשיו, והרכב החודש יהיה נכון להיום. מחזור נוסף אחרי ההקלטה לא ייכנס אליה — כתבו תוכנית חדשה.',
    en: 'This month is not over: the show tells the month so far, with the Team of the Month as it stands today. A night played after recording is not in it — write a new show.',
  },
  'tools.show.err.notReady': {
    he: 'אין עדיין מחזור מתועד לחודש הזה. פרסמו את ההיסטוריה ונסו שוב.',
    en: 'There is no recorded night for this month yet. Publish the history and try again.',
  },
  'tools.show.deleteConfirm': {
    he: 'למחוק את התוכנית של החודש הזה ואת ההקלטה שלה?',
    en: 'Delete this month’s show and its recording?',
  },
  'tools.show.shareText': {
    he: '🎙️ תוכנית החודש בקול שנוצר בבינה מלאכותית — לא הקלטה אמיתית',
    en: '🎙️ The month’s show in an AI-generated voice — not a real recording',
  },
} as const satisfies Record<string, Entry>;
