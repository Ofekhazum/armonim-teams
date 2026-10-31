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
    he: 'אין עדיין חודש מוכן — תוכנית נכתבת רק לחודש שהסתיים והרכב החודש שלו נרשם.',
    en: 'No month is ready yet — a show is written only for a finished month whose Team of the Month is registered.',
  },
  'tools.show.nothing': { he: 'עוד לא נכתבה תוכנית לחודש הזה.', en: 'No show written for this month yet.' },
  'tools.show.write': { he: '✍️ לכתוב את התוכנית', en: '✍️ Write the show' },
  'tools.show.err.notReady': {
    he: 'החודש הזה עוד לא מוכן: הוא עדיין משוחק, או שהרכב החודש שלו לא נרשם.',
    en: 'This month is not ready: it is still being played, or its Team of the Month is not registered.',
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
