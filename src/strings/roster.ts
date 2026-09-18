import type { Entry } from '../i18n';

// The Roster tab: the squad as a list, the organiser's edit form behind it, and
// the guest tray that turns a regular visitor into a member.

export const roster = {
  'roster.intro': {
    he: 'הסגל הקבוע. אורחים מתווספים במחזור.',
    en: 'The permanent squad. Guests are added on match day.',
  },
  'roster.empty': {
    he: 'עוד אין שחקנים — הוסיפו את הסגל כדי להתחיל 🙌',
    en: 'No players yet — add your squad to get started 🙌',
  },
  'roster.add': { he: '+ הוספת שחקן', en: '+ Add player' },
  'roster.edit': { he: 'עריכה', en: 'Edit' },

  'roster.publish': { he: '📢 פרסום', en: '📢 Publish' },
  'roster.publishing': { he: 'מפרסם…', en: 'Publishing…' },
  'roster.publish.title': { he: 'עדכון הסגל לכולם', en: 'Update the roster for everyone' },

  // --- The edit form --------------------------------------------------------
  'roster.form.editTitle': { he: 'עריכת שחקן', en: 'Edit player' },
  'roster.form.newTitle': { he: 'שחקן חדש', en: 'New player' },
  // The placeholder names both scripts on purpose — it is the one field where
  // a Hebrew reader may well want to type English, and the other way round.
  'roster.form.name.placeholder': { he: 'שם (עברית או English)', en: 'Name (עברית or English)' },
  'roster.form.duplicate': { he: 'כבר נמצא בסגל תחת השם הזה.', en: 'is already on the roster under this name.' },
  'roster.form.aliases.placeholder': {
    he: 'שמות נוספים שקוראים לו, מופרדים בפסיק (רשות)',
    en: 'Other names people call them, comma-separated (optional)',
  },
  'roster.form.aliases.hint': {
    he: 'משמש להתאמת השחקן כשמדביקים רשימת נוכחות במחזור.',
    en: 'Used to match this player when importing a pasted list on match day.',
  },
  'roster.form.number.label': { he: 'מספר חולצה (רשות)', en: 'Shirt number (optional)' },
  'roster.form.number.placeholder': { he: 'למשל 9', en: 'e.g. 9' },
  'roster.form.number.hint': {
    he: 'מודפס על החולצה כששולחים את ההרכבים כתמונה — לא מוצג בשום מקום אחר. אפשר להשאיר ריק, ואין בעיה ששני שחקנים יחלקו מספר.',
    en: 'Printed on the shirt when sharing teams as images — not shown anywhere else. Fine to leave blank, and fine if two players share a number.',
  },
  'roster.form.rating.aria': { he: 'דירוג, 1 עד 5', en: 'Rating, 1 to 5' },
  'roster.form.role': { he: 'תפקיד', en: 'Role' },
  'roster.form.gk.toggle': { he: '🧤 שוער', en: '🧤 Goalkeeper' },
  'roster.form.gk.note': {
    he: 'שוערים קבועים נמצאים מחוץ לציר ההגנה־התקפה — הם תמיד זמינים לשער במחזור.',
    en: "Permanent goalkeepers sit outside the outfield spectrum — they're always GK-capable on match day.",
  },
  'roster.form.spectrum.aria': {
    he: 'מיקום על הציר בין הגנה להתקפה',
    en: 'Position on the defence to attack spectrum',
  },
  'roster.form.defence': { he: '🛡️ הגנה', en: '🛡️ Defence' },
  'roster.form.attack': { he: 'התקפה ⚔️', en: 'Attack ⚔️' },

  'roster.rel.title': { he: '🤝↔️ יחסים', en: '🤝↔️ Relationships' },
  'roster.rel.filter.placeholder': { he: 'סינון לפי שם…', en: 'Filter by name…' },
  'roster.rel.filter.aria': {
    he: 'סינון שחקנים לכימיה והפרדה',
    en: 'Filter players for chemistry and avoid',
  },
  'roster.rel.legend.chem': { he: '🤝 כימיה טובה', en: '🤝 good chemistry' },
  'roster.rel.legend.avoid': {
    he: ' · ↔️ עדיף בקבוצות נפרדות (המלצה, לא חוק — למנהל בלבד)',
    en: ' · ↔️ prefer separate teams (a nudge, not a rule — admin only)',
  },
  'roster.rel.chem.aria': { he: 'משחק טוב עם {name}', en: 'Plays well with {name}' },
  'roster.rel.chem.title': { he: 'משחק טוב עם', en: 'Plays well with' },
  'roster.rel.avoid.aria': { he: 'עדיף בקבוצה נפרדת מ{name}', en: 'Prefer separate teams from {name}' },
  'roster.rel.avoid.title': {
    he: 'עדיף בקבוצות נפרדות (למנהל בלבד)',
    en: 'Prefer on separate teams (admin only)',
  },
  'roster.rel.noMatch': { he: 'אף שחקן לא תואם ל״{q}״.', en: 'No players match “{q}”.' },
  // Worded as what it buys rather than as what it forbids: the player is not
  // objecting to keepers, they want the gloves to still be going spare so they
  // can take a breather in goal (§2.59).
  'roster.rel.nogk': { he: 'בקבוצה בלי שוער', en: 'On a team with no keeper' },
  'roster.rel.nogk.hint': {
    he: 'משאיר לו את האפשרות לרדת לשער לנוח · המלצה, לא חוק — למנהל בלבד',
    en: 'Keeps going in goal available as a rest · a nudge, not a rule — admin only',
  },

  // --- The row --------------------------------------------------------------
  'roster.row.open': { he: 'פתיחת {name}', en: 'Open {name}' },
  'roster.row.saved': { he: '✓ נשמר', en: '✓ Saved' },
  'roster.row.aka': { he: 'ידוע גם כ', en: 'aka' },
  'roster.row.akaTitle': { he: 'ידוע גם כ', en: 'Also known as' },

  // --- Guests ---------------------------------------------------------------
  'roster.guests.title': { he: '🚪 אורחים ({n})', en: '🚪 Guests ({n})' },
  'roster.guests.hint': {
    he: 'שיחקו אבל לא בסגל. קידום אורח שומר כל מחזור שכבר שיחק — המחזורים הולכים אחרי השם.',
    en: 'Played but not on the roster. Promoting one keeps every night they’ve already played — their nights follow the name.',
  },
  'roster.guests.nights': { he: { one: 'מחזור אחד', other: '{n} מחזורים' }, en: { one: '{n} night', other: '{n} nights' } },
  'roster.guests.promote': { he: '+ הוספה לסגל', en: '+ Add to roster' },
  'roster.guests.promote.title': {
    he: 'הוספת {name} לסגל, עם כל {n} המחזורים שכבר שיחק',
    en: 'Add {name} to the roster, keeping their {n} nights',
  },

  // --- Warnings and dialogs -------------------------------------------------
  'roster.stale.banner': {
    he: '⚠️ המכשיר הזה עוד לא טען את רשימות הכימיה וההפרדה המשותפות. פרסום עכשיו יחליף אותן במה שיש כאן — אולי בכלום. רעננו את הדף לפני הפרסום אם חשוב לכם לשמור אותן.',
    en: "⚠️ This device hasn't loaded the shared chemistry/keep-apart lists yet. Publishing now would replace them with whatever's on this device — possibly nothing. Reload the page before publishing if you want them kept.",
  },
  'roster.remove.title': { he: 'להסיר את השחקן?', en: 'Remove player?' },
  'roster.remove.body': {
    he: 'הפעולה מסירה את {name} מהסגל הקבוע.\nתמיד אפשר להוסיף אותו בחזרה.',
    en: 'This removes {name} from the permanent squad.\nYou can always add them back later.',
  },
  'roster.remove.confirm': { he: 'הסרה', en: 'Remove' },

  'roster.publishGate.title': {
    he: 'לפרסם בלי לאשר את הרשימות הפרטיות?',
    en: 'Publish without confirming private lists?',
  },
  'roster.publishGate.body': {
    he: 'פרסום עכשיו יחליף את רשימות הכימיה וההפרדה במה שנמצא במכשיר הזה — אולי בכלום.\nרעננו ופתחו מצב מנהל מחדש קודם, אם חשוב לכם לשמור אותן.',
    en: 'Publishing now would replace the chemistry and keep-apart lists with whatever is on this device — possibly nothing.\nReload and unlock admin again first if you want them kept.',
  },
  'roster.publishGate.confirm': { he: 'לפרסם בכל זאת', en: 'Publish anyway' },

  'roster.published.title': { he: 'הסגל פורסם', en: 'Roster published' },
  'roster.published.body': {
    he: '✅ כולם יקבלו אותו בפעם הבאה שיפתחו את האפליקציה.',
    en: '✅ Everyone gets it next time they open the app.',
  },
  'roster.publishFailed.title': { he: 'הפרסום נכשל', en: 'Publish failed' },
  'roster.publishFailed.wrongWord': {
    he: '❌ הסיסמה כבר לא תקפה. פתחו מצב מנהל מחדש.',
    en: '❌ The password is no longer valid. Please unlock admin again.',
  },
  'roster.publishFailed.rateLimited': {
    he: '❌ יותר מדי ניסיונות כושלים. חכו כמה דקות ונסו שוב.',
    en: '❌ Too many failed attempts. Please wait a few minutes and try again.',
  },
  'roster.publishFailed.offline': {
    he: 'לא הצלחנו לפרסם — בדקו את החיבור ונסו שוב.',
    en: 'Could not publish — check your connection and try again.',
  },
  'roster.staleRemote.title': { he: 'הסגל השתנה במקום אחר', en: 'Roster changed elsewhere' },
  'roster.staleRemote.body': {
    he: '⚠️ הסגל המשותף השתנה מאז שהמכשיר הזה טען אותו — פרסום עכשיו יבטל את השינויים האלה.\nרעננו את הדף כדי למשוך את הסגל הנוכחי, ואז החילו מחדש את העריכות שלכם.',
    en: '⚠️ The shared roster has changed since this device last loaded it — publishing now would undo those changes.\nReload the page to pull the current roster first, then re-apply your edits.',
  },

  // --- attackLabel, from types.ts ------------------------------------------
  'roster.attack.even': { he: 'חצי־חצי', en: 'even split' },
  'roster.attack.attacking': { he: '{n}% התקפי', en: '{n}% attacking' },
  'roster.attack.defensive': { he: '{n}% הגנתי', en: '{n}% defensive' },
} as const satisfies Record<string, Entry>;
