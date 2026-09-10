import type { Entry } from '../i18n';

// The Club tab's own furniture: the podiums, the fact strips a match night
// carries, the thirds-of-the-night bars, and the form panel.
//
// The fact lines are the app's one piece of real prose, and the Hebrew keeps
// the rule the English set itself (§2.9): everything here is a *count*, never
// a verdict. "ניצח 3 ערבים ברצף" is a number; "בכושר" would be a claim about
// how somebody is playing that three win totals cannot support.

export const club = {
  // --- Podiums (leaderboards.ts) -------------------------------------------
  'lb.wins': { he: 'הכי הרבה ניצחונות', en: 'Most match wins' },
  'lb.nightsWon': { he: 'הכי הרבה ערבים שנוצחו', en: 'Most nights won outright' },
  'lb.nights': { he: 'הכי הרבה ערבים', en: 'Most nights played' },
  'lb.mvp': { he: 'הכי הרבה בחירות מצטיין', en: 'Most MVP picks' },
  'lb.winRun': { he: 'הרצף המנצח הארוך ביותר', en: 'Longest winning run' },
  'lb.activeRun': { he: 'על רצף כרגע', en: 'On a run right now' },
  'lb.unit.pick': { he: { one: 'בחירה', other: 'בחירות' }, en: { one: 'pick', other: 'picks' } },

  // --- On the line tonight --------------------------------------------------
  'facts.line.title': { he: '🎯 על הכף הערב', en: '🎯 On the line tonight' },
  'facts.line.nthWin': { he: 'במרחק {away} מ־{target} ניצחונות בקריירה', en: 'is {away} from {target} career wins' },
  'facts.line.ironMan': {
    he: 'משלים {n} ערבים ברצף עצם ההגעה',
    en: 'makes it {n} nights in a row by turning up',
  },
  'facts.line.winStreak': {
    he: 'הקבוצה שלו מנצחת וזה {n} ערבים ברצף',
    en: "'s team wins and that's {n} nights running",
  },
  'facts.bounty': {
    he: '🎖️ פרס ראש — {name} על {n} ערבים מנצחים. שמישהו יעצור את זה.',
    en: '🎖️ Bounty — {name} is on {n} winning nights. Somebody end it.',
  },

  // --- Coming in tonight ----------------------------------------------------
  'facts.strip.title': { he: '📋 נכנסים לערב', en: '📋 Coming in tonight' },
  'facts.debutGroup': { he: '✨ {n} ערבים ראשונים הערב', en: '✨ {n} first nights tonight' },
  'facts.debut': { he: '✨ ערב ראשון ל', en: '✨ First night for' },
  'facts.nthNight': { he: 'בערב ה־{n} שלו', en: "'s {n}th night" },
  'facts.nthWin': { he: 'בניצחון ה־{n} שלו', en: "'s {n}th win" },
  'facts.ironMan': { he: 'לא פספס ערב כבר {n} ברצף', en: "hasn't missed a night in {n} straight" },
  'facts.winStreak': { he: 'ניצח {n} ערבים ברצף', en: 'has won {n} nights running' },
  'facts.winless': { he: 'לא ניצח כבר {n} ערבים', en: "hasn't won in {n} nights" },
  'facts.duo': {
    he: 'ניצחו ב־{won} מתוך {together} הערבים המשותפים שלהם',
    en: 'have won {won} of their {together} nights together',
  },
  'facts.duo.and': { he: 'ו', en: '&' },

  // --- Thirds of the night (NightParts) ------------------------------------
  'parts.beginning': { he: 'התחלה', en: 'Beginning' },
  'parts.middle': { he: 'אמצע', en: 'Middle' },
  'parts.end': { he: 'סוף', en: 'End' },
  'parts.intro': {
    he: 'באיזו תדירות ניצח, לפי מתי בערב שוחק המשחק. הקו המקווקו הוא',
    en: 'How often they won, by when in the evening the match was played. The dashed line is their',
  },
  // Split either side of the percentage, which is bold — the one number on the
  // card the sentence exists to point at.
  'parts.overallTail': {
    he: 'על פני כל הערב — עמודה מעליו היא חלק מהערב שבו הוא מנצח יותר.',
    en: 'across the whole night — a bar above it is a part of the evening they win more of.',
  },
  'parts.barTitle': {
    he: '{won} מתוך {played} משחקים שנוצחו ב{part} של הערב',
    en: '{won} of {played} matches won in the {part} of the night',
  },
  'parts.wonOf': { he: '{won} מתוך {played}', en: '{won} of {played}' },
  'parts.nonePlayed': { he: 'לא שוחק', en: 'none played' },

  // --- Form panel (GradeForm) ----------------------------------------------
  'form.empty': {
    he: 'עוד אין ציונים לשחקן הזה.',
    en: 'No marks for this player yet.',
  },
  'form.col.date': { he: 'תאריך', en: 'Date' },
  'form.col.night': { he: 'ערב', en: 'Night' },
  'form.col.wins': { he: 'ניצחונות', en: 'Wins' },
  'form.col.mark': { he: 'ציון', en: 'Mark' },
  'form.range.1M': { he: '1ח׳', en: '1M' },
  'form.range.3M': { he: '3ח׳', en: '3M' },
  'form.range.6M': { he: '6ח׳', en: '6M' },
  'form.range.1Y': { he: '1ש׳', en: '1Y' },
  'form.range.ALL': { he: 'הכול', en: 'All' },
  'form.noneInWindow': { he: 'אין ערבים מדורגים בחלון הזה.', en: 'No graded nights in this window.' },
  'form.tryLonger': { he: ' נסו חלון ארוך יותר.', en: ' Try a longer one.' },
  'form.lastNights': {
    he: { one: 'הערב האחרון', other: '{n} הערבים האחרונים' },
    // Hebrew's singular does not carry the count — "הערב האחרון" already says
    // there is one. The English keeps the wording it had.
    en: { one: 'last {n} night', other: 'last {n} nights' },
  },

  // --- The joker's marks (NightGrades) -------------------------------------
  'marks.title': { he: '📋 הציונים', en: '📋 The marks' },
  'marks.written': { he: 'נכתב ב־{date}', en: 'written {date}' },
  'marks.draft': { he: 'טיוטה — אף אחד אחר עוד לא רואה את זה', en: 'draft — nobody else can see this yet' },
  'marks.mvpTitle': { he: 'שחקן הערב', en: 'Player of the night' },
  'marks.noLine': { he: 'אין שורה ל{names}', en: 'no line for {names}' },
  'marks.share': { he: '📤 שיתוף', en: '📤 Share' },
  'marks.writing': { he: 'כותב…', en: 'writing…' },
  'marks.writeAnother': { he: '↻ לכתוב עוד אחד', en: '↻ Write another' },
  'marks.write': { he: '✍️ לכתוב את הציונים', en: '✍️ Write the marks' },
  'marks.saving': { he: 'שומר…', en: 'saving…' },
  'marks.publish': { he: '✓ לפרסם את זה', en: '✓ Publish this one' },
  'marks.discard': { he: 'ביטול', en: 'Discard' },
  'marks.delete': { he: '🗑️ מחיקה', en: '🗑️ Delete' },
  'marks.delete.confirm': { he: 'למחוק את הציונים האלה עבור כולם?', en: 'Delete these marks for everyone?' },
  'marks.err.notConfigured': {
    he: 'אין ג׳וקר בפריסה הזאת: לוורקר אין GEMINI_KEY.',
    en: 'No joker on this deployment: the worker has no GEMINI_KEY set.',
  },
  'marks.err.wrongWord': { he: 'סיסמת המנהל נדחתה.', en: 'That admin word was refused.' },
  'marks.err.rateLimited': {
    he: 'יותר מדי ניסיונות מכאן. חכו עשר דקות.',
    en: 'Too many attempts from here. Give it ten minutes.',
  },
  'marks.err.tooMany': {
    he: 'זה תריסר סטים של ציונים בשעה. תנו לזה לנוח ונסו מאוחר יותר.',
    en: 'That is a dozen sets of marks in an hour. Give it a rest and try later.',
  },
  'marks.err.unavailable': { he: 'ג׳מיני סירב', en: 'Gemini turned it down' },
  'marks.err.unreachable': { he: 'לא הצלחנו להגיע לג׳וקר.', en: 'Could not reach the joker.' },

  // --- Head to head (PlayerCompare) ----------------------------------------
  'cmp.pickA': { he: 'בחרו שחקן…', en: 'Pick a player…' },
  'cmp.pickB': { he: 'בחרו עוד אחד…', en: 'Pick another…' },
  'cmp.versus': { he: 'נגד', en: 'v' },
  'cmp.pickDifferent': { he: 'בחרו שני שחקנים שונים.', en: 'Pick two different players.' },
  'cmp.pickTwo': {
    he: 'בחרו שני שחקנים כדי להעמיד את הרשומות שלהם זו מול זו.',
    en: 'Pick two players to put their records side by side.',
  },
  'cmp.row.nights': { he: 'ערבים ששוחקו', en: 'Nights played' },
  'cmp.row.nightsWon': { he: 'ערבים שנוצחו', en: 'Nights won' },
  'cmp.row.wins': { he: 'ניצחונות', en: 'Match wins' },
  'cmp.row.perNight': { he: 'לכל ערב', en: 'Per night' },
  'cmp.row.mvps': { he: 'בחירות מצטיין', en: 'MVP picks' },
  'cmp.row.bestRun': { he: 'הרצף הארוך ביותר', en: 'Longest run' },
  'cmp.never': {
    he: 'השניים האלה מעולם לא היו באותו דף הרכב.',
    en: 'These two have never been on the same team sheet.',
  },
  'cmp.together': { he: '🤝 באותה קבוצה', en: '🤝 On the same team' },
  'cmp.together.nights': { he: { one: 'ערב', other: 'ערבים' }, en: { one: 'night', other: 'nights' } },
  'cmp.together.winning': { he: ', וניצחו ב־', en: ', winning' },
  'cmp.together.ofThem': { he: 'מתוכם', en: 'of them' },
  'cmp.against': { he: '⚔️ בקבוצות יריבות', en: '⚔️ On opposite teams' },
  'cmp.h2h.beaten': { he: 'ניצחה את הקבוצה של', en: "'s team has beaten" },
  'cmp.h2h.in': { he: 'ב־', en: "'s in" },
  'cmp.h2h.of': { he: 'מתוך', en: 'of' },
  'cmp.h2h.matches': { he: 'משחקים', en: 'matches' },
  'cmp.h2h.none': {
    he: 'אף אחד מהערבים האלה לא נרשם משחק־משחק, אז אין מאזן ישיר לקרוא.',
    en: 'None of those nights was written down match by match, so there is no head-to-head to read.',
  },
} as const satisfies Record<string, Entry>;
