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

  // --- Kickoff countdown / scheduling --------------------------------------
  'kick.countdown': { he: '⏳ נפתח {when}', en: '⏳ Kicks off {when}' },
  // kickoffLabel(), from kickoff.ts. The short forms are what fits in a tab
  // pill beside a pulsing dot.
  'kick.anyMoment': { he: 'נפתח עוד רגע', en: 'kicking off any moment' },
  'kick.in.days': { he: 'בעוד {d} ימ׳ {h} שע׳', en: 'in {d}d {h}h' },
  'kick.in.hours': { he: 'בעוד {h} שע׳ {m} דק׳', en: 'in {h}h {m}m' },
  'kick.in.mins': { he: 'בעוד {m} דק׳', en: 'in {m}m' },
  'kick.in.secs': { he: 'בעוד 0:{s}', en: 'in 0:{s}' },
  'kick.ago.justNow': { he: 'ממש עכשיו', en: 'just now' },
  'kick.ago.mins': { he: 'לפני {m} דק׳', en: '{m} min ago' },
  'kick.ago.hours': { he: 'לפני {h} שע׳ {m} דק׳', en: '{h}h {m}m ago' },

  'start.title': { he: 'התחלת המחזור', en: 'Start the fixture' },
  'start.body': {
    he: 'נועל את ההרכבים של המחזור ומציג אותם לכל הקבוצה. תמיד אפשר לבטל אחר כך אם נמלכתם בדעתכם.',
    en: "Locks tonight's teams in and puts them in front of the group. Cancel is always there afterwards if you change your mind.",
  },
  'start.now': { he: '▶️ להתחיל עכשיו', en: '▶️ Start now' },
  'start.later': { he: '🗓️ תזמון למועד מאוחר', en: '🗓️ Schedule for later' },
  'start.notYet': { he: '→ עוד לא', en: '← Not yet' },
  'start.schedule.title': { he: 'תזמון המחזור', en: 'Schedule the fixture' },
  'start.schedule.body': {
    he: 'ההרכבים ננעלים עכשיו, בדיוק כמו בהתחלה — הקבוצה רואה אותם מיד, עם ספירה לאחור לפתיחה במקום כמשחק חי. עד שבוע מראש.',
    en: 'Teams lock in now, the same as starting — the group sees them right away, counting down to kickoff rather than reading them as live. Up to a week ahead.',
  },
  'start.schedule.confirm': { he: '🗓️ נעילת הרכבים ותזמון', en: '🗓️ Lock in teams & schedule' },
  'start.schedule.error': {
    he: 'בחרו זמן בין עכשיו לעוד שבוע.',
    en: 'Pick a time between now and a week from now.',
  },

  // --- The spectator's live view -------------------------------------------
  'live.title.running': { he: 'המחזור', en: "Tonight's fixture" },
  'live.title.scheduled': { he: 'ההרכבים של המחזור', en: "Tonight's teams" },
  'live.kickedOff': { he: 'נפתח {ago}', en: 'kicked off {ago}' },
  'live.starts': { he: 'מתחיל {when}', en: 'starts {when}' },
  'live.end': { he: '⏹️ סיום המשחק', en: '⏹️ End fixture' },
  'live.cancel': { he: '✕ ביטול המשחק', en: '✕ Cancel fixture' },
  'live.end.confirm': {
    he: 'לסיים את המחזור עבור כולם?\n\nהתצוגה החיה תיעלם מהטלפונים של הקבוצה. שום דבר שכבר נשמר בהיסטוריה לא מושפע.',
    en: "End tonight's fixture for everyone?\n\nThe live view disappears from the group's phones. Nothing already saved to history is affected.",
  },
  'live.cancel.confirm': {
    he: 'לבטל את המחזור המתוזמן?\n\nההרכבים והספירה לאחור ייעלמו מהטלפונים של כולם.',
    en: "Cancel this scheduled fixture?\n\nThe teams and countdown disappear from everyone's phones.",
  },

  // --- Score bar / team cards ----------------------------------------------
  'score.chip.title': {
    he: '{team} — {points} מתוך {n} משחקים',
    en: '{team} — {points} from {n} matches',
  },
  'cards.gkTonight': { he: 'שוער המחזור', en: 'Goalkeeper tonight' },

  // --- Pitch mode -----------------------------------------------------------
  'pitch.leave': { he: 'יציאה ממצב מגרש', en: 'Leave pitch mode' },
  'pitch.pause': { he: '⏸ השהיה', en: '⏸ Pause' },
  'pitch.addedTime': { he: '▶️ זמן נוסף', en: '▶️ Added time' },
  'pitch.start': { he: '▶️ התחלה', en: '▶️ Start' },
  'pitch.resume': { he: '▶️ המשך', en: '▶️ Resume' },
  'pitch.level': { he: '⚽ שוויון — זמן נוסף', en: '⚽ Level — added time' },
  'pitch.next': { he: '⏭ הבא', en: '⏭ Next' },
  'pitch.reset': { he: '↺ איפוס', en: '↺ Reset' },
  'pitch.watcher': {
    he: 'מי שהכי קרוב לטלפון מנהל את השעון',
    en: 'Whoever is nearest the phone runs the clock',
  },

  // --- MVP ------------------------------------------------------------------
  'mvp.title': { he: '🌟 מצטיין המחזור', en: '🌟 MVP' },
  'mvp.hint': {
    he: 'רשות — כמה קולות קיבל כל אחד. מי שקיבל הכי הרבה הוא המצטיין.',
    en: 'Optional — how many votes each player got. Most votes takes it.',
  },
  'mvp.from.one': { he: 'מתוך {team}, שניצחו את המחזור.', en: 'From {team}, who won the night.' },
  'mvp.from.level': { he: 'המחזור הסתיים בשוויון, אז כל מי ששיחק.', en: 'The night finished level, so anyone who played.' },
  'mvp.from.tied': { he: 'מתוך {teams}, שוות בראש.', en: 'From {teams}, level at the top.' },
  'mvp.and': { he: 'ו', en: ' and ' },

  // The vote sheet (§2.46). The footer line has three states and they are three
  // separate entries rather than one string with holes in it — "level, nobody
  // picked yet" is a different sentence in Hebrew, not the same sentence with a
  // word swapped.
  'mvp.vote.none': { he: 'עוד לא נספרו קולות', en: 'No votes counted yet' },
  'mvp.vote.cast': {
    he: {
      one: '{n} קול · מצטיין המחזור: {name}',
      other: '{n} קולות · מצטיין המחזור: {name}',
    },
    en: {
      one: '{n} vote · player of the night: {name}',
      other: '{n} votes · player of the night: {name}',
    },
  },
  'mvp.vote.tied': {
    he: {
      one: 'שוויון על {n} קול — הוסיפו קול כדי להכריע',
      other: 'שוויון על {n} קולות — הוסיפו קול כדי להכריע',
    },
    en: {
      one: 'Level on {n} vote — add one to settle it',
      other: 'Level on {n} votes — add one to settle it',
    },
  },
  // A level sheet where somebody was already picked. The pick stands rather
  // than being dropped — correcting a tally is not a reason to un-name
  // somebody — so the line has to say that, or it would be telling the
  // organiser nobody has won while a star sits on a row above it.
  'mvp.vote.tied.holds': {
    he: {
      one: 'שוויון על {n} קול — {name} נשאר המצטיין',
      other: 'שוויון על {n} קולות — {name} נשאר המצטיין',
    },
    en: {
      one: 'Level on {n} vote — {name} keeps it',
      other: 'Level on {n} votes — {name} keeps it',
    },
  },
  // A night picked before the sheet existed. Says so plainly rather than
  // showing a zero, which would read as "nobody voted for him".
  'mvp.vote.legacy': { he: 'נבחר: {name} — ללא ספירת קולות', en: 'Picked: {name} — no tally on file' },
  'mvp.vote.clear': { he: 'ניקוי הבחירה', en: 'Clear the pick' },
  'mvp.vote.more': { he: 'קול נוסף ל{name}', en: 'One more vote for {name}' },
  'mvp.vote.less': { he: 'קול אחד פחות ל{name}', en: 'One fewer vote for {name}' },
  'mvp.vote.count': { he: 'קולות ל{name}', en: 'Votes for {name}' },

  // --- Derby ----------------------------------------------------------------
  'derby.title': { he: '⚔️ הדרבי של המחזור', en: "⚔️ Tonight's derby" },
  'derby.faced': { he: '{n} משחקים בצדדים מנוגדים', en: '{n} matches on opposite sides' },
  'derby.level': { he: ', ובשוויון מוחלט', en: ', and dead level' },

  // --- Test mode ------------------------------------------------------------
  'test.banner.title': { he: '🧪 מצב בדיקה — מועדון מומצא', en: '🧪 Test mode — invented club' },
  'test.banner.body': {
    he: '{players} שחקנים, {nights} מחזורים. שום דבר כאן לא מתפרסם, והמועדון האמיתי לא נוגע בכלום.',
    en: '{players} players, {nights} nights. Nothing here is published, and the real club is untouched.',
  },
  'test.banner.back': { he: '→ חזרה למועדון האמיתי', en: '← Back to the real club' },

  // --- Live room bar --------------------------------------------------------
  'room.live': { he: '🔴 חי', en: '🔴 Live' },
  'room.host': { he: ' · מארח', en: ' · host' },

  // --- Price tag ------------------------------------------------------------
  'price.first': { he: 'הערכה ראשונה', en: 'first valuation' },
  'price.unchanged': { he: '— ללא שינוי', en: '— unchanged' },
  'price.note': {
    he: 'מתומחר לפי תוצאות, הופעות ותארים — לא לפי דירוג.',
    en: 'Priced from results, appearances and honours — not a rating.',
  },
} as const satisfies Record<string, Entry>;
