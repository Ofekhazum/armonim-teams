import type { Entry } from '../i18n';

// Words that belong to no one screen: the verbs on buttons, the handful of
// nouns ("night", "player", "team") that half the app's labels are built from,
// and the shirt colours.
//
// Keys read `area.thing`, and the area here is `ui`. A string used by exactly
// one screen lives in that screen's file instead — this one stays small enough
// that "is it already in here?" is a question you can answer by looking.

export const common = {
  'ui.save': { he: 'שמירה', en: 'Save' },
  'ui.cancel': { he: 'ביטול', en: 'Cancel' },
  'ui.delete': { he: 'מחיקה', en: 'Delete' },
  'ui.edit': { he: 'עריכה', en: 'Edit' },
  'ui.done': { he: 'סיום', en: 'Done' },
  'ui.close': { he: 'סגירה', en: 'Close' },
  'ui.back': { he: 'חזרה', en: 'Back' },
  'ui.next': { he: 'הבא', en: 'Next' },
  'ui.add': { he: 'הוספה', en: 'Add' },
  'ui.remove': { he: 'הסרה', en: 'Remove' },
  'ui.undo': { he: 'ביטול פעולה', en: 'Undo' },
  'ui.share': { he: 'שיתוף', en: 'Share' },
  'ui.copy': { he: 'העתקה', en: 'Copy' },
  'ui.copied': { he: 'הועתק', en: 'Copied' },
  'ui.confirm': { he: 'אישור', en: 'Confirm' },
  'ui.yes': { he: 'כן', en: 'Yes' },
  'ui.no': { he: 'לא', en: 'No' },
  'ui.search': { he: 'חיפוש', en: 'Search' },
  'ui.loading': { he: 'טוען…', en: 'Loading…' },
  'ui.none': { he: 'אין', en: 'None' },
  'ui.all': { he: 'הכול', en: 'All' },
  'ui.more': { he: 'עוד', en: 'More' },
  'ui.less': { he: 'פחות', en: 'Less' },
  'ui.show': { he: 'הצגה', en: 'Show' },
  'ui.hide': { he: 'הסתרה', en: 'Hide' },

  'ui.night': { he: { one: 'מחזור', other: 'מחזורים' }, en: { one: 'night', other: 'nights' } },
  'ui.player': {
    he: { one: 'שחקן', other: 'שחקנים' },
    en: { one: 'player', other: 'players' },
  },
  'ui.match': { he: { one: 'משחק', other: 'משחקים' }, en: { one: 'match', other: 'matches' } },
  'ui.win': { he: { one: 'ניצחון', other: 'ניצחונות' }, en: { one: 'win', other: 'wins' } },
  'ui.goal': { he: { one: 'שער', other: 'שערים' }, en: { one: 'goal', other: 'goals' } },

  'ui.team.black': { he: 'שחורים', en: 'Black' },
  'ui.team.white': { he: 'לבנים', en: 'White' },
  'ui.team.blue': { he: 'כחולים', en: 'Blue' },

  'ui.role.defensive': { he: 'הגנתי', en: 'Defensive' },
  'ui.role.balanced': { he: 'מאוזן', en: 'Balanced' },
  'ui.role.attacking': { he: 'התקפי', en: 'Attacking' },
  'ui.role.gk': { he: 'שוער', en: 'Goalkeeper' },

  'ui.ok': { he: 'אישור', en: 'OK' },
  'ui.fold.hide': { he: '▲ הסתרה', en: '▲ hide' },
  'ui.fold.show': { he: '▼ הצגה', en: '▼ show' },

  'ui.stars.newLabel': { he: 'חדש ?', en: 'NEW ?' },
  'ui.stars.newTitle': { he: 'שחקן חדש — הרמה עוד לא ידועה', en: 'New player — ability unknown' },
  'ui.stars.rating': { he: 'דירוג {r}/5', en: 'Rating {r}/5' },

  // Only the control's own name needs translating. The languages inside it are
  // each written in their own language and never translated — that row is the
  // way out for somebody who cannot read the one currently showing.
  'ui.lang.label': { he: 'שפה', en: 'Language' },
} as const satisfies Record<string, Entry>;
