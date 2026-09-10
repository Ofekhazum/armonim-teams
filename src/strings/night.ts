import type { Entry } from '../i18n';

// The organiser's own fixture page — the one they hold through the night — and
// the two questions it asks at the end of it. Plus the shared-room view a
// guest lands on from a link.

export const night = {
  // --- The organiser's fixture page ----------------------------------------
  'fx.backToTeams': { he: '→ חזרה להרכבים', en: '← Back to teams' },
  'fx.cancel': { he: '✕ ביטול המשחק', en: '✕ Cancel fixture' },
  'fx.cancel.confirm': {
    he: 'לבטל את ערב המשחק המתוזמן?\n\nההרכבים והספירה לאחור ייעלמו מהטלפונים של כולם. תחזרו ללוח ההרכבים הניתן לעריכה.',
    en: "Cancel this scheduled fixture?\n\nThe teams and countdown disappear from everyone's phones. You'll land back on the editable teams board.",
  },
  'fx.end': { he: '⏹️ סיום המשחק', en: '⏹️ End fixture' },
  'fx.avg': { he: ' · ממוצע {n}', en: ' · avg {n}' },

  // --- "Anything worth remembering?" ---------------------------------------
  'fx.note.title': { he: 'משהו ששווה לזכור?', en: 'Anything worth remembering?' },
  'fx.note.body': {
    he: 'רשות, וזה הולך לכתב — הדבר היחיד בסיכום הערב שאי אפשר להסיק מהתוצאות. דלגו ושום דבר לא משתנה.',
    en: "Optional, and it goes to the reporter — the one thing in the night's write-up that can't be worked out from the results. Skip it and nothing changes.",
  },
  'fx.note.format': {
    he: 'יותר מדבר אחד? כתבו כל אחד בשורה נפרדת, או עטפו כל אחד ב־@…@. אם תזכירו שחקן בשם — הוא יחטוף על זה; בלי שם, זה שייך לאף אחד.',
    en: "More than one thing? Put each on its own line, or wrap each in @…@. Name a player and they'll get the blame — leave the name out and it belongs to nobody.",
  },
  // Stays Hebrew in both languages, like the pasted-list example: it shows the
  // shape of what somebody actually writes here, and they write it in Hebrew.
  'fx.note.placeholder': {
    he: 'טום העיף את הכדור מעבר לגדר 5 פעמים\nמישהו הביא כלב למגרש',
    en: 'טום העיף את הכדור מעבר לגדר 5 פעמים\nמישהו הביא כלב למגרש',
  },
  'fx.note.saveWith': { he: '🗂️ שמירה עם ההערה וסיום', en: '🗂️ Save with the note & end' },
  'fx.note.save': { he: '🗂️ שמירה להיסטוריה וסיום', en: '🗂️ Save to history & end' },

  // --- "That's the night?" --------------------------------------------------
  'fx.ending.title': { he: 'זה הערב?', en: "That's the night?" },
  'fx.ending.body': {
    he: 'סיום מנקה את השחקנים, האורחים וההרכבים של הערב, והתצוגה החיה נעלמת מהטלפונים של כולם.',
    en: "Ending clears tonight's players, guests and teams, and the live view disappears from everyone's phones.",
  },
  'fx.ending.alreadySaved': {
    he: 'הערב כבר בהיסטוריה — שמירה חוזרת מעדכנת את אותה רשומה עם כל מה שנרשם מאז.',
    en: 'Tonight is already in history — filing again updates that same record with anything recorded since.',
  },
  'fx.ending.unsavedMatches': {
    he: '{n} המשחקים שנרשמו הערב עוד לא בהיסטוריה.',
    en: 'The {n} matches written down tonight are not in history yet.',
  },
  'fx.ending.unsavedTally': {
    he: 'הספירה של הערב עוד לא בהיסטוריה.',
    en: "Tonight's tally is not in history yet.",
  },
  'fx.ending.nothing': {
    he: 'לא נרשם כלום הערב, אז אין מה לתייק — סיום עכשיו משאיר את הערב מחוץ לרישום לגמרי.',
    en: 'Nothing was written down tonight, so there is nothing to file — ending now keeps the night off the record entirely.',
  },
  'fx.ending.update': { he: '🗂️ עדכון ההיסטוריה וסיום', en: '🗂️ Update history & end' },
  'fx.ending.needAdmin': {
    he: '🔒 פתחו מצב מנהל כדי לתייק את הערב להיסטוריה. סיום עכשיו משאיר את הערב מחוץ לרישום לגמרי.',
    en: '🔒 Unlock admin to file tonight into history. Ending now keeps the night off the record entirely.',
  },
  'fx.ending.endNoSave': { he: '⏹️ סיום בלי שמירה', en: '⏹️ End without saving' },
  'fx.ending.endNoUpdate': { he: '⏹️ סיום בלי עדכון', en: '⏹️ End without updating' },
  'fx.ending.endLose': { he: '🗑️ סיום ואיבוד התוצאה', en: '🗑️ End and lose the result' },
  'fx.ending.notYet': { he: '→ עוד לא', en: '← Not yet' },

  // --- The shared live room -------------------------------------------------
  'guest.title': { he: '🦁 ארמונים FC — חדר חי', en: '🦁 Armonim FC — live room' },
  'guest.club': { he: '🦁 ארמונים FC', en: '🦁 Armonim FC' },
  'guest.liveTitle': { he: 'ארמונים FC — חי', en: 'Armonim FC — live' },
  'guest.askName': {
    he: 'איך קוראים לכם? השם מוצג ליד כל שינוי שתעשו.',
    en: "What's your name? It's shown next to any change you make.",
  },
  'guest.name.placeholder': { he: 'השם שלכם', en: 'Your name' },
  'guest.join': { he: 'הצטרפות', en: 'Join' },
  'guest.connecting': { he: 'מתחבר…', en: 'Connecting…' },
  'guest.err.notFound': {
    he: 'החדר הזה לא קיים — בקשו מהמארח לשלוח קישור חדש.',
    en: "This room doesn't exist — ask the host to send a fresh link.",
  },
  'guest.err.closed': { he: 'המארח סגר את החדר.', en: 'The host closed this room.' },
  'guest.err.notConfigured': {
    he: 'חדרים חיים לא מוגדרים באפליקציה הזאת.',
    en: 'Live rooms are not set up for this app.',
  },
  'guest.err.disconnected': {
    he: 'החיבור לחדר אבד — נסו לפתוח מחדש את הקישור של המארח.',
    en: "Lost connection to the room — try reopening the host's link.",
  },
} as const satisfies Record<string, Entry>;
