import type { Entry } from '../i18n';

// Match day, the organiser's workbench: who's playing, who can keep goal, and
// the board the balancer hands back. Also the live room — the share link that
// lets other people move players around the board in real time.

export const matchday = {
  // --- The three steps ------------------------------------------------------
  'md.step.players': { he: '1 · מי משחק', en: "1 · Who's playing" },
  'md.step.gk': { he: '2 · שוערים', en: '2 · Goalkeepers' },
  'md.step.teams': { he: '3 · הרכבים', en: '3 · Teams' },

  // --- The sticky status line ----------------------------------------------
  'md.status.tooFew': {
    he: 'צריך לפחות {min} שחקנים לערב משחק — כרגע {n}.',
    en: 'Need at least {min} players for the fixture — currently {n}.',
  },
  'md.status.perfect': {
    he: 'מושלם — שלוש קבוצות מלאות של 5! 🎉',
    en: 'Perfect — three full teams of 5! 🎉',
  },
  'md.status.short': {
    he: '{n} שחקנים — הרכבים של {sizes}. הקבוצה שנחה תשאיל שחקנים בכל משחק (כולל תוכנית רוטציה).',
    en: '{n} players — teams of {sizes}. The resting team will lend players each match (rotation plan included).',
  },
  'md.status.over': {
    he: '{n} שחקנים — הרכבים של {sizes}.',
    en: '{n} players — teams of {sizes}.',
  },

  // --- Step 1: availability -------------------------------------------------
  'md.rosterEmpty': {
    he: 'הסגל ריק — הוסיפו שחקנים בלשונית הסגל קודם.',
    en: 'The roster is empty — add players in the Roster tab first.',
  },
  'md.import.toggle': { he: '📋 ייבוא רשימה מודבקת', en: '📋 Import a pasted list' },
  'md.import.hint': {
    he: 'הדביקו את רשימת השחקנים (למשל מוואטסאפ) — ממוספרת, עם תבליטים, או פשוט שם בכל שורה. שמות מזוהים מסומנים למטה; שמות לא מזוהים נוספים אוטומטית כאורחים. הפעולה מחליפה לגמרי את הבחירה ורשימת האורחים הנוכחיות.',
    en: 'Paste the player list (e.g. from WhatsApp) — numbered, bulleted, or just one name per line all work. Recognized names get checked off below; unrecognized names are added as guests automatically. This replaces the current selection and guest list entirely.',
  },
  // Stays Hebrew in both languages: it is an example of what the organiser
  // pastes in, and what they paste in is a Hebrew WhatsApp list either way.
  'md.import.placeholder': {
    he: '1. חנגל\n2. הלחמי\n3. דורגי\n...',
    en: '1. חנגל\n2. הלחמי\n3. דורגי\n...',
  },
  'md.import.apply': { he: 'התאמה והוספה', en: 'Match & add' },
  'md.import.matched': { he: '✅ הותאמו {n}', en: '✅ Matched {n}' },
  'md.import.addedGuests': {
    he: ', נוספו {n} אורחים: {names}',
    en: ', added {n} guest(s): {names}',
  },

  'md.available.title': { he: 'זמינים היום', en: 'Available today' },
  'md.available.count': { he: '({n} מתוך {total} נבחרו)', en: '({n} of {total} selected)' },
  'md.random': { he: '🎲 אקראי {n}', en: '🎲 Random {n}' },
  'md.random.title': {
    he: 'קיצור לבדיקות: סימון סגל מלא אקראי',
    en: 'Testing shortcut: tick a random full squad',
  },
  'md.clear': { he: 'ניקוי', en: 'Clear' },

  // --- Guests ---------------------------------------------------------------
  'md.guests.title': { he: 'אורחים', en: 'Guests' },
  'md.guests.hint': {
    he: 'אורח משחק באותה קבוצה עם החבר שהביא אותו. אפשר להשאיר את המזמין ריק אם לא ידוע מי הביא אותו.',
    en: "A guest plays on the same team as the friend who brought them. Leave the inviter empty if you don't know who brought them.",
  },
  'md.guests.remove': { he: 'הסרה', en: 'remove' },
  'md.guests.rating.title': { he: 'דירוג', en: 'Rating' },
  'md.guests.rating.unknown': { he: 'דירוג: ?', en: 'Rating: ?' },
  'md.guests.rating.value': { he: 'דירוג: {r}', en: 'Rating: {r}' },
  'md.guests.invitedBy.title': { he: 'הוזמן על ידי', en: 'Invited by' },
  'md.guests.noInviter': { he: 'אין מזמין', en: 'No inviter' },
  'md.guests.with': { he: 'עם {name}', en: 'with {name}' },
  'md.guests.selectFirst': { he: 'בחרו קודם שחקנים זמינים.', en: 'Select available players first.' },
  'md.guests.name.placeholder': { he: 'שם האורח', en: 'Guest name' },
  'md.guests.invitedBy.placeholder': { he: 'הוזמן על ידי… (רשות)', en: 'Invited by… (optional)' },
  'md.guests.rating.guess': {
    he: 'דירוג, אם אפשר לנחש',
    en: 'Rating, if you can guess it',
  },
  'md.guests.add': { he: '+ הוספת אורח', en: '+ Add guest' },

  'md.next.gk': { he: 'הבא: שוערים ←', en: 'Next: goalkeepers →' },

  // --- Step 2: goalkeepers --------------------------------------------------
  'md.gk.title': { he: '🧤 מי יכול לשמור בשער היום?', en: '🧤 Who can play goalkeeper today?' },
  'md.gk.hint': {
    he: 'זה משתנה משבוע לשבוע — סמנו את כל מי שיכול להיכנס לשער היום. השוערים מתחלקים בין הקבוצות.',
    en: 'This changes week to week — mark everyone who can go in goal today. Keepers get spread across the teams.',
  },
  'md.gk.always': { he: 'תמיד', en: 'always' },
  'md.back': { he: '→ חזרה', en: '← Back' },
  'md.generate': { he: '⚡ יצירת הרכבים', en: '⚡ Generate teams' },

  // --- The live room --------------------------------------------------------
  'md.room.namePrompt': {
    he: 'בחרו שם שיוצג כשאתם עורכים שינויים:',
    en: 'Pick a name to show when you make changes:',
  },
  'md.room.closeConfirm': {
    he: 'לסגור את החדר? כל מי שמחזיק בקישור יתנתק.',
    en: 'Close the room? Anyone with the link will be disconnected.',
  },
  'md.room.copyPrompt': { he: 'העתיקו את קישור החדר:', en: 'Copy the room link:' },
  'md.room.copied': { he: '✓ הקישור הועתק!', en: '✓ Link copied!' },
  'md.room.copy': { he: '📋 העתקת קישור', en: '📋 Copy link' },
  'md.room.close': { he: '✕ סגירת החדר', en: '✕ Close room' },
  'md.room.goLive': {
    he: '🔴 פתיחת חדר — שאחרים יוכלו להזיז שחקנים בזמן אמת',
    en: '🔴 Go live — let others move players in real time',
  },

  'md.variation': { he: 'וריאציה {n}/{total}', en: 'Variation {n}/{total}' },

  // --- The teams board ------------------------------------------------------
  'board.back': { he: '→ הגדרות', en: '← Setup' },
  'board.reroll': { he: 'ערבוב מחדש', en: 'Re-roll' },
  'board.newFixture': { he: '🆕 ערב חדש', en: '🆕 New Fixture' },
  'board.newFixture.confirm': {
    he: 'להתחיל ערב משחק חדש? הפעולה מנקה את הבחירות, האורחים וההרכבים של היום.',
    en: "Start a new fixture? This clears today's selections, guests and teams.",
  },
  'board.balance': { he: 'פער איזון: {n}', en: 'Balance gap: {n}' },
  'board.balance.title': {
    he: 'ההפרש בין ממוצע הדירוג של הקבוצה החזקה לחלשה',
    en: "Difference between the strongest and weakest team's average rating",
  },
  'board.shareImages': { he: '🖼️ שיתוף תמונות', en: '🖼️ Share images' },
  'board.shareImages.title': {
    he: 'שיתוף ההרכב של כל קבוצה כתמונת חולצה',
    en: "Share each team's lineup as a shirt-card image",
  },
  'board.shareImages.failed': {
    he: 'לא הצלחנו ליצור את תמונות ההרכבים במכשיר הזה.',
    en: 'Could not create the lineup images on this device.',
  },
  'board.copied': { he: '✓ הועתק!', en: '✓ Copied!' },
  'board.copy': { he: '📋 העתקה לוואטסאפ', en: '📋 Copy for WhatsApp' },
  'board.copy.prompt': { he: 'העתיקו את ההרכבים:', en: 'Copy the teams:' },
  'board.start': { he: '▶️ התחלת המשחק', en: '▶️ Start fixture' },

  'board.help': {
    he: 'גררו שחקן על שחקן אחר כדי להחליף, או על כרטיס קבוצה כדי להעביר — או הקישו על שחקן, ואז על שחקן בקבוצה אחרת (הקישו ״העברה לכאן״ כדי להעביר).',
    en: 'Drag a player onto another player to swap, or onto a team card to move — or tap a player, then tap a player on another team (tap "move here" to move).',
  },

  'board.warn.keepers': { he: '{emoji} ל{team} יש {n} שוערים.', en: '{emoji} {team} has {n} goalkeepers.' },
  'board.warn.guest': {
    he: 'האורח {name} לא באותה קבוצה עם {inviter}.',
    en: 'Guest {name} is not on the same team as {inviter}.',
  },
  'board.warn.avoid': {
    he: '↔️ {a} ו{b} בדרך כלל מופרדים — כאן הם יחד.',
    en: "↔️ {a} and {b} are usually kept apart — they're together here.",
  },

  'board.swapColor.title': {
    he: 'החלפת הצבע של הקבוצה הזאת עם קבוצה אחרת',
    en: "Swap this team's color with another team",
  },
  'board.size': { he: '{n} שחקנים', en: '{n} players' },
  'board.avg': { he: ' · ממוצע {n}', en: ' · avg {n}' },
  'board.gkCount': { he: ' · {n} 🧤', en: ' · {n} 🧤' },
  'board.gkToday': { he: 'שוער היום', en: 'Goalkeeper today' },
  'board.guest': { he: 'אורח', en: 'guest' },
  'board.guestOf': { he: 'אורח של {name}', en: 'Guest of {name}' },
  'board.moveHere': { he: '⤵ העברה לכאן', en: '⤵ move here' },

  'board.rotation.title': { he: '🔁 תוכנית רוטציה', en: '🔁 Rotation plan' },
  'board.rotation.hint': {
    he: 'קבוצות חסרות מושלמות בשחקנים מהקבוצה שנחה, בסבב כך שזה לא תמיד אותו אחד.',
    en: "Short teams are completed by players from the resting team, rotated so it's not always the same person.",
  },
  'board.rotation.vs': { he: 'נגד', en: 'vs' },
  'board.rotation.rests': { he: '{emoji} {team} נחים', en: '{emoji} {team} rests' },
  'board.rotation.joins': { he: 'מצטרף ל{emoji}', en: 'joins {emoji}' },

  // The WhatsApp share text. Its own, fuller phrasing — a line in a group chat
  // has no shirt beside it to say what "Black" is short for.
  'board.share.team.black': { he: 'קבוצה שחורה', en: 'Black team' },
  'board.share.team.white': { he: 'קבוצה לבנה', en: 'White team' },
  'board.share.team.blue': { he: 'קבוצה כחולה', en: 'Blue team' },
  'board.share.rotation': {
    he: '🔁 רוטציה (הקבוצה שנחה משלימה את הצד החסר):',
    en: '🔁 Rotation (resting team completes the short side):',
  },
  'board.share.rotation.line': {
    he: '{a} נגד {b} — {resting} נחים',
    en: '{a} vs {b} — {resting} rests',
  },
  'board.share.rotation.joins': { he: '{name} מצטרף ל{team}', en: '{name} joins {team}' },
} as const satisfies Record<string, Entry>;
