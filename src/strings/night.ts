import type { Entry } from '../i18n';

// The organiser's own fixture page — the one they hold through the night — and
// the two questions it asks at the end of it. Plus the shared-room view a
// guest lands on from a link.

export const night = {
  // --- The organiser's fixture page ----------------------------------------
  'fx.backToTeams': { he: '→ חזרה להרכבים', en: '← Back to teams' },
  'fx.cancel': { he: '✕ ביטול המשחק', en: '✕ Cancel fixture' },
  'fx.cancel.confirm': {
    he: 'לבטל את המחזור המתוזמן?\n\nההרכבים והספירה לאחור ייעלמו מהטלפונים של כולם. תחזרו ללוח ההרכבים הניתן לעריכה.',
    en: "Cancel this scheduled fixture?\n\nThe teams and countdown disappear from everyone's phones. You'll land back on the editable teams board.",
  },
  'fx.end': { he: '⏹️ סיום המשחק', en: '⏹️ End fixture' },
  'fx.avg': { he: ' · ממוצע {n}', en: ' · avg {n}' },

  // --- "Anything worth remembering?" ---------------------------------------
  'fx.note.title': { he: 'משהו ששווה לזכור?', en: 'Anything worth remembering?' },
  'fx.note.body': {
    he: 'רשות, וזה הולך לכתב — הדבר היחיד בסיכום המחזור שאי אפשר להסיק מהתוצאות. דלגו ושום דבר לא משתנה.',
    en: "Optional, and it goes to the reporter — the one thing in the night's write-up that can't be worked out from the results. Skip it and nothing changes.",
  },
  'fx.note.format': {
    he: 'יותר מדבר אחד? כתבו כל אחד בשורה נפרדת, או עטפו כל אחד ב־@…@. אם תזכירו שחקן בשם — הוא יחטוף על זה; בלי שם, זה שייך לאף אחד.',
    en: "More than one thing? Put each on its own line, or wrap each in @…@. Name a player and they'll get the blame — leave the name out and it belongs to nobody.",
  },
  // The grade markers (§2.57). Its own line rather than another clause on the
  // one above, because it is the only thing an organiser can type here that
  // changes a *number* — everything else in this box only changes what gets
  // written about the night.
  'fx.note.marks': {
    he: 'רוצים שזה ישפיע גם על הציון? הוסיפו + בקצה האירוע (חצי נקודה לכל +), או − להורדה. שני שחקנים באותו אירוע — שניהם מקבלים.',
    en: 'Want it to move the mark too? Put a + at either end of the event — half a point each, or − to go down. Two players in one event and both get it.',
  },
  // Hebrew in both languages, like the placeholder above and for the same
  // reason: it shows the shape of a line somebody actually types.
  'fx.note.marks.example': {
    he: '@שי שם 4 גולים ++@',
    en: '@שי שם 4 גולים ++@',
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
  'fx.ending.title': { he: 'זה המחזור?', en: "That's the night?" },
  'fx.ending.body': {
    he: 'סיום מנקה את השחקנים, האורחים וההרכבים של המחזור, והתצוגה החיה נעלמת מהטלפונים של כולם.',
    en: "Ending clears tonight's players, guests and teams, and the live view disappears from everyone's phones.",
  },
  'fx.ending.alreadySaved': {
    he: 'המחזור כבר בהיסטוריה — שמירה חוזרת מעדכנת את אותה רשומה עם כל מה שנרשם מאז.',
    en: 'Tonight is already in history — filing again updates that same record with anything recorded since.',
  },
  'fx.ending.unsavedMatches': {
    he: '{n} המשחקים שנרשמו במחזור עוד לא בהיסטוריה.',
    en: 'The {n} matches written down tonight are not in history yet.',
  },
  'fx.ending.unsavedTally': {
    he: 'הספירה של המחזור עוד לא בהיסטוריה.',
    en: "Tonight's tally is not in history yet.",
  },
  'fx.ending.nothing': {
    he: 'לא נרשם כלום במחזור, אז אין מה לתייק — סיום עכשיו משאיר את המחזור מחוץ לרישום לגמרי.',
    en: 'Nothing was written down tonight, so there is nothing to file — ending now keeps the night off the record entirely.',
  },
  'fx.ending.update': { he: '🗂️ עדכון ההיסטוריה וסיום', en: '🗂️ Update history & end' },
  'fx.ending.needAdmin': {
    he: '🔒 פתחו מצב מנהל כדי לתייק את המחזור להיסטוריה. סיום עכשיו משאיר את המחזור מחוץ לרישום לגמרי.',
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

  // --- A past night's page (NightPage) -------------------------------------
  'np.close': { he: '✕ סגירה', en: '✕ Close' },
  'np.older': { he: '→ קודם', en: '← older' },
  'np.newer': { he: 'הבא ←', en: 'newer →' },
  'np.nothingThatWay': { he: 'לא נרשם שום דבר בכיוון הזה', en: 'nothing recorded that way' },
  'np.headline': { he: 'המחזור', en: 'The night' },
  'np.wonTheNight': { he: 'לקחו את המחזור', en: 'Won the night' },
  'np.played': { he: '{n} שיחקו', en: '{n} played' },

  'np.tallied': {
    he: 'המחזור הזה נספר בסוף במקום להירשם משחק־משחק, אז אין רצף לקרוא: הרישום הוא שלושה סכומים. מחזורים שנרשמים תוך כדי מקבלים ציר זמן, צורה ואת הרגעים שבתוכם.',
    en: 'This night was tallied at the end rather than logged match by match, so there is no sequence to read: the record is three totals. Nights logged as they happen get a timeline, a shape and the moments in them.',
  },

  'np.matchByMatch': { he: 'איך זה הלך, משחק אחרי משחק', en: 'How it went, match by match' },
  'np.thinBar': { he: 'פס דק = את מי הם ניצחו', en: 'thin bar = who they beat' },
  'np.matchTitle': { he: 'משחק {n}: {winner} ניצחו את {loser}', en: 'Match {n}: {winner} beat {loser}' },
  'np.matchTitle.pens': { he: ' בפנדלים', en: ' on penalties' },
  'np.matches': { he: 'משחקים', en: 'matches' },
  'np.longestRun': { he: 'הרצף הארוך ביותר', en: 'longest run' },
  'np.leadChanged': { he: 'ההובלה התחלפה', en: 'lead changed' },
  'np.onPenalties': { he: 'בפנדלים', en: 'on penalties' },

  // The one-line summary of the rarest thing that happened, from nightStory's
  // detectors. Each is a count phrased as the event it is (§2.9).
  'np.fact.streakBroken': { he: '{by} עצרו את הרצף של {over} על {n}', en: "{by} ended {over}'s run of {n}" },
  'np.fact.breakAndRun': { he: '{team} פרצו ונשארו על המגרש ל־{n}', en: '{team} opened up and stayed on for {n}' },
  'np.fact.perfect': { he: '{team} ניצחו את כל {n} המשחקים ששיחקו', en: '{team} won all {n} they played' },
  'np.fact.blanked': { he: '{team} שיחקו {n} ולא ניצחו אף אחד', en: '{team} played {n} and won none' },
  'np.fact.heist': {
    he: '{team} ניצחו {early} מ־{earlyOf} הראשונים ו־{late} מ־{lateOf} האחרונים',
    en: '{team} won {early} of their first {earlyOf} and {late} of their last {lateOf}',
  },
  'np.fact.yoYo': { he: '{team} ניצחו והפסידו לסירוגין, {n} עמוק', en: '{team} won and lost alternately, {n} deep' },
  'np.fact.shootouts': { he: '{n} מהם הוכרעו בפנדלים', en: '{n} of them went to penalties' },

  // --- The report -----------------------------------------------------------
  'np.report.title': { he: '📰 הדיווח', en: '📰 The report' },
  'np.report.written': { he: 'נכתב ב־{date}', en: 'written {date}' },
  'np.report.draft': { he: 'טיוטה — אף אחד אחר עוד לא רואה את זה', en: 'draft — nobody else can see this yet' },
  'np.report.nothing': { he: 'עוד לא נכתב כלום למחזור הזה.', en: 'Nothing written for this night yet.' },
  'np.report.share': { he: '📤 שיתוף', en: '📤 Share' },
  'np.report.writing': { he: 'כותב…', en: 'writing…' },
  'np.report.writeAnother': { he: '↻ לכתוב עוד אחד', en: '↻ Write another' },
  'np.report.write': { he: '✍️ לכתוב את הדיווח', en: '✍️ Write the report' },
  'np.report.saving': { he: 'שומר…', en: 'saving…' },
  'np.report.publish': { he: '✓ לפרסם את זה', en: '✓ Publish this one' },
  'np.report.discard': { he: 'ביטול', en: 'Discard' },
  'np.report.delete': { he: '🗑️ מחיקה', en: '🗑️ Delete' },
  'np.report.deleteConfirm': { he: 'למחוק את הדיווח הזה עבור כולם?', en: 'Delete this recap for everyone?' },
  'np.report.err.notConfigured': {
    he: 'אין כתב בפריסה הזאת: לוורקר אין GEMINI_KEY.',
    en: 'No reporter on this deployment: the worker has no GEMINI_KEY set.',
  },
  'np.report.err.tooMany': {
    he: 'זה תריסר דיווחים בשעה. הכתב הלך לנוח — נסו מאוחר יותר.',
    en: 'That is a dozen reports in an hour. The reporter has gone for a lie down — try again later.',
  },
  'np.report.err.unreachable': { he: 'לא הצלחנו להגיע לכתב.', en: 'Could not reach the reporter.' },

  // --- Night headlines (nightStory.ts) -------------------------------------
  //
  // Four per flavour, picked by the fixture's own id so a night reads the same
  // every time and differently from the one before it. Both languages keep
  // four, because the pick is an index into the bank.
  'story.dictatorship.1': { he: 'דיקטטורה', en: 'A dictatorship' },
  'story.dictatorship.2': { he: 'קבוצה אחת, מחזור אחד', en: 'One team, one evening' },
  'story.dictatorship.3': { he: 'מישהו השתלט', en: 'Somebody took over' },
  'story.dictatorship.4': { he: 'שלטון יחיד', en: 'A reign' },
  'story.chaos.1': { he: 'כאוס מוחלט', en: 'Complete chaos' },
  'story.chaos.2': { he: 'אף אחד לא הצליח להחזיק את המגרש', en: 'Nobody could hold the pitch' },
  'story.chaos.3': { he: 'חילופים בכל משחק', en: 'All change, every match' },
  'story.chaos.4': { he: 'אנרכיה', en: 'Anarchy' },
  'story.tugOfWar.1': { he: 'משיכת חבל', en: 'A tug of war' },
  'story.tugOfWar.2': { he: 'צמוד עד הסוף', en: 'Nothing in it' },
  'story.tugOfWar.3': { he: 'החליפו הובלה כל המחזור', en: 'Traded all night' },
  'story.tugOfWar.4': { he: 'אחד מול השני', en: 'Toe to toe' },
  'story.ordinary.1': { he: 'עוד יום שלישי רגיל', en: 'An ordinary Tuesday' },
  'story.ordinary.2': { he: 'מחזור של כדורגל', en: 'A night of football' },
  'story.ordinary.3': { he: 'עסקים כרגיל', en: 'Business as usual' },
  'story.ordinary.4': { he: 'פשוט כדורגל', en: 'Just football' },
} as const satisfies Record<string, Entry>;
