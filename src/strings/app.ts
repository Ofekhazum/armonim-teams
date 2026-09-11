import type { Entry } from '../i18n';

// The shell: the tabs across the top, the admin padlock beside them, and the
// four things that can go wrong when this device tries to share what it just
// recorded.

export const app = {
  'app.tab.matchday': { he: 'מחזור', en: 'Match day' },
  'app.tab.roster': { he: 'סגל ({n})', en: 'Roster ({n})' },
  'app.tab.club': { he: 'מועדון', en: 'Club' },
  'app.tab.live': { he: 'חי', en: 'Live' },

  'app.admin.badge': { he: 'מנהל', en: 'ADMIN' },
  'app.admin.unlock': { he: 'פתיחת מצב מנהל', en: 'Unlock admin mode' },
  'app.admin.logoff': { he: 'יציאה ממצב מנהל', en: 'Log off admin' },

  'app.version.title': {
    he: 'גרסת בנייה — משתנה בכל פריסה',
    en: 'Build version — changes on every deploy',
  },

  'app.live.none.title': { he: 'אין משחק חי כרגע', en: 'No fixture is live right now' },
  'app.live.none.body': {
    he: 'הלשונית הזאת מופיעה מעצמה ברגע שמחזור נפתח.',
    en: 'This tab appears on its own the moment a night kicks off.',
  },

  // All four keep the same promise in the same order: it *is* saved here, it
  // is *not* shared yet, and here is the one thing to do about it.
  'app.sync.wrongWord': {
    he: '❌ הסיסמה כבר לא תקפה — הנתונים נשמרו במכשיר הזה אבל עדיין לא שותפו. פתחו מצב מנהל מחדש ושמרו שוב.',
    en: '❌ The password is no longer valid — this is saved on this device but not shared yet. Unlock admin again and re-save.',
  },
  'app.sync.rateLimited': {
    he: '❌ יותר מדי ניסיונות כושלים לאחרונה — הנתונים נשמרו במכשיר הזה, אבל השיתוף מושהה לכמה דקות.',
    en: '❌ Too many failed attempts recently — this is saved on this device, but sharing is paused for a few minutes.',
  },
  'app.sync.stale': {
    he: '⚠️ מישהו אחר עדכן את ההיסטוריה המשותפת מאז הפעם האחרונה שהמכשיר הזה טען אותה.\n\nהשינוי נשמר כאן אבל לא שותף — רעננו את הדף כדי למשוך קודם את הגרסה שלהם, ואז הזינו את השינוי מחדש.',
    en: '⚠️ Someone else has updated the shared history since this device last loaded it.\n\nThis is saved here, but not shared — reload the page to pull their version first, then re-enter this change.',
  },
  'app.sync.failed': {
    he: 'לא הצלחנו לשתף — השינוי נשמר במכשיר הזה, אבל אחרים עדיין לא יראו אותו.',
    en: "Could not share this — it's saved on this device, but others won't see it yet.",
  },

  // --- Unlocking admin ------------------------------------------------------
  'admin.prompt': { he: 'הזינו את סיסמת המנהל:', en: 'Enter the admin password:' },
  'admin.wrong': { he: '❌ סיסמה שגויה.', en: '❌ Wrong password.' },
  'admin.rateLimited': {
    he: '❌ יותר מדי סיסמאות שגויות. חכו כמה דקות ונסו שוב.',
    en: '❌ Too many wrong passwords. Please wait a few minutes and try again.',
  },
  'admin.notConfigured': {
    he: 'הסגל המשותף עוד לא מוגדר (REMOTE_URL ריק ב־remote.ts).',
    en: 'The shared roster is not set up yet (REMOTE_URL is empty in remote.ts).',
  },
  'admin.unreachable': {
    he: 'לא הצלחנו להגיע לשרת — בדקו את החיבור ונסו שוב.',
    en: 'Could not reach the server — check your connection and try again.',
  },
} as const satisfies Record<string, Entry>;
