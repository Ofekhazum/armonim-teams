import type { Entry } from '../i18n';

// Match night: the log of results, the clock, and the spectator's view of both.
//
// The register here is deliberately plainer than the rest of the app. These are
// the labels somebody reads standing up, in the dark, holding a phone in one
// hand — so the Hebrew is short and literal, and none of it leans on wordplay
// that would need a second read.

export const fixture = {
  // --- MatchLog -------------------------------------------------------------
  'log.title': { he: '📋 משחקים', en: '📋 Matches' },
  'log.played': { he: '{n} שוחקו', en: '{n} played' },
  'log.win.full.title': {
    he: '{team} ניצחו במשחק — ניצחון מלא',
    en: '{team} won it in play — a full win',
  },
  'log.win.pens.title': {
    he: '{team} לקחו את זה בפנדלים — חצי ניצחון, לפי חוק הבית',
    en: '{team} took it on penalties — half a win, per the house rule',
  },
  'log.point': { he: 'נקודה 1', en: '1 point' },
  'log.pens.button': { he: 'פנדלים · ½', en: 'penalties · ½' },
  'log.opening.question': {
    he: 'מי פותחים? זה הצמד היחיד שמישהו בוחר — אחריו המנצחת נשארת והקבוצה שנחה נכנסת.',
    en: 'Who kicks off? This is the only pairing anyone picks — after it, the winner stays on and the resting team comes in.',
  },
  'log.pick.placeholder': { he: 'בחרו קבוצה…', en: 'Pick a team…' },
  'log.pick.first': { he: 'קבוצה ראשונה', en: 'First team' },
  'log.pick.second': { he: 'קבוצה שנייה', en: 'Second team' },
  'log.versus': { he: 'נגד', en: 'v' },
  'log.rests': { he: 'נחים', en: 'rests' },
  'log.onNow': { he: 'על המגרש:', en: 'On now:' },
  // Was "are on their 3rd in a row" — an English ordinal with no clean Hebrew
  // equivalent at this length. The count says the same thing in both.
  'log.streak': { he: 'שיחקו {n} ברצף.', en: 'have played {n} in a row.' },
  'log.undo': { he: 'ביטול המשחק האחרון', en: 'Undo last match' },
  'log.beat': { he: 'ניצחו את', en: 'beat' },
  'log.entry.pens': { he: 'בפנדלים · ½', en: 'on penalties · ½' },
} as const satisfies Record<string, Entry>;
