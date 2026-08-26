// Post-match grades, in the sandbox (§2.32, §2.39).
//
// The sandbox has no Worker and no Gemini, so a night page in test mode showed
// an empty marks panel and a write button that could only ever fail. This is
// what fills it in, and it is kept in its own file — loaded only from the test
// branches of `gradesApi` — so it can never be reached from live code, exactly
// as `testAwards.ts` is.
//
// **The marks are the real ones, not invented.** `nightGrades` over the
// invented history, which is the same call the profile's form panel already
// makes in test mode. Rolling a random number here instead would put a
// different mark on the night page from the one the panel shows for that night
// two taps away — a sandbox that misrepresents the feature rather than
// demonstrating it. The invented club's own results already spread the marks
// across most of the scale, which is the variety a random number was wanted for.
//
// **Only the banter is invented, and it has to be.** There is no model to ask.
// The lines below are written to the same brief the real prompt carries — mock
// the football, never the person — and are picked by a hash of the two ids, so
// a night reads the same every time it is opened.

import type { FixtureRecord } from './types';
import { nightGrades } from './grades';
import type { GradeLines } from './gradesApi';

// Four bands, because a single pool would put "carried the whole team" next to
// a 3.5 and the sandbox would look broken rather than invented.
const BANTER: Record<'standout' | 'good' | 'ordinary' | 'rough', string[]> = {
  standout: [
    'ערב כזה מגיע פעם בעונה, והוא לקח אותו בשתי ידיים.',
    'החזיק את הקבוצה על הגב וסירב לרדת מהמגרש.',
    'אפשר להתחיל לדבר ברצינות על פסל בכניסה למגרש.',
    'מי שלא היה שם לא יאמין, ומי שהיה עדיין מספר על זה.',
  ],
  good: [
    'ערב מסודר, בלי דרמות, בדיוק מה שהקבוצה הייתה צריכה.',
    'עשה את העבודה בשקט ואף אחד לא שם לב כמה זה עזר.',
    'לא כותרת ראשית, אבל בהחלט שווה אזכור.',
    'הגיע, סידר את הערב, והלך הביתה מרוצה.',
  ],
  ordinary: [
    'ערב שגרתי לחלוטין, כזה שנשכח עד יום רביעי.',
    'היה שם, שיחק, הלך הביתה. זה כל הסיפור.',
    'לא רע ולא טוב, בדיוק באמצע כמו הטבלה.',
    'ערב ללא הערות, וזה גם סוג של הישג.',
  ],
  rough: [
    'ערב לשכוח, ומהר. הלוח לא ריחם עליו.',
    'הקבוצה לא לקחה כלום, והוא היה שם לכל רגע מזה.',
    'אם אפשר היה להחזיר ערב אחד, הוא היה ראשון בתור.',
    'שבוע הבא זו הזדמנות, כי גרוע מזה כבר קשה.',
  ],
};

const bandOf = (grade: number) =>
  grade >= 8 ? 'standout' : grade >= 6.5 ? 'good' : grade >= 5 ? 'ordinary' : 'rough';

/** Stable per player per night, so a page does not reshuffle on every open. */
function pick(pool: string[], seed: string): string {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return pool[(h >>> 0) % pool.length];
}

/**
 * The marks and lines for one invented night, in the shape the Worker returns,
 * or `null` for a night with no result — the same answer `nightGrades` gives.
 */
export function testGradeLines(history: FixtureRecord[], fixtureId: string): GradeLines | null {
  const graded = nightGrades(history, fixtureId);
  if (!graded) return null;
  const lines: GradeLines = {};
  for (const g of graded) {
    const pool = BANTER[bandOf(g.grade)];
    lines[g.id] = { text: pick(pool, `${fixtureId}:${g.id}`), grade: g.grade };
  }
  return lines;
}
