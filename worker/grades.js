// Post-match grades: a computed mark and a one-line ribbing to go with it
// (§2.39).
//
// **The model never decides the number.** `src/grades.ts` computes the mark out
// of ten from the night's result, the MVP pick, and the player's own record and
// current run. This file hands that finished figure to Gemini and asks for one
// sentence explaining it. Same split as Market Value: the arithmetic is the
// app's, the phrasing is the model's.
//
// **The model also has no idea what happened on the pitch, and that is the
// constraint the whole prompt is built around.** Nobody records goals, saves,
// assists or moments, so a model asked for banter will happily invent a
// backheel that never happened and attribute it to a real person who will read
// it. The night reporter took four rounds to stop doing exactly this (§2.24).
// Every joke here therefore has to be built out of the counts supplied — a
// drought, a run, a hammering, being picked player of the night — and the
// prompt says so at length.
//
// **Inventing a *connection* is the same offence as inventing an event, and it
// is the one the first spike actually committed.** Handed the organiser's note
// — "the ball went over the fence about five times, all by the same guy" — and
// a player who had lost every match, the model put the two together and named
// him. Nothing in the record said it was him; he was simply the most available
// culprit. So WHO A FACT BELONGS TO below is not a tone rule, it is a factual
// one: every fact in the payload is attached to a key, or to nobody, and the
// model may not move it.

import { callGemini } from './gemini.js';

const list = (items, empty) => (items.length ? items.map((s) => `- ${s}`).join('\n') : empty);

const TEAM_HE = { black: 'השחורים', white: 'הלבנים', blue: 'הכחולים' };

const he = (team) => TEAM_HE[team] ?? team;

/** What a stored set of lines looks like in KV under `grades:<fixtureId>`. */
const GRADES_PREFIX = 'grades:';
export const gradesKey = (fixtureId) => `${GRADES_PREFIX}${fixtureId}`;

/**
 * Every published mark in the club, as `{ fixtureId: { playerId: grade } }`.
 *
 * **Why a bulk read exists at all.** Grades are stored one key per fixture,
 * which is exactly right for the night page — it reads one night. A player's
 * grade graph (§2.39) reads *every* night they have played, and doing that a
 * key at a time is a request per night: fine at three, absurd at fifty. This is
 * the same problem `/awards` already solved by keeping one document ("a player
 * page wants all of them at once"), reached from the other direction: the
 * per-night keys stay, and the fan-out happens here, inside one request, on the
 * side of the wire that can do it concurrently.
 *
 * **Marks only, deliberately.** The banter is the bulky half — one Hebrew
 * sentence per player per night — and a graph plots numbers. Dropping the text
 * takes a season from something like 150KB to under 20KB, and keeps this
 * endpoint from quietly becoming the way a whole season of writing gets
 * downloaded to draw a line.
 */
export async function readAllMarks(env) {
  const out = {};
  let cursor;
  do {
    const page = await env.ROSTER_KV.list({ prefix: GRADES_PREFIX, cursor });
    const records = await Promise.all(
      page.keys.map(async (k) => {
        const raw = await env.ROSTER_KV.get(k.name);
        if (!raw) return null;
        try {
          return { id: k.name.slice(GRADES_PREFIX.length), value: JSON.parse(raw) };
        } catch {
          // one unreadable night must not take the whole graph down with it
          return null;
        }
      }),
    );
    for (const rec of records) {
      const lines = rec?.value?.lines;
      if (!lines || typeof lines !== 'object') continue;
      const marks = {};
      for (const [playerId, line] of Object.entries(lines)) {
        if (Number.isFinite(line?.grade)) marks[playerId] = line.grade;
      }
      if (Object.keys(marks).length > 0) out[rec.id] = marks;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/**
 * One player's line in the payload, as prose the prompt can read.
 *
 * Everything here is a count. There is no rating anywhere in it, and there is a
 * test asserting that stays true.
 */
function describe(p) {
  const bits = [`ציון ${p.grade}`, he(p.team), `הקבוצה לקחה ${p.teamWins} משחקים`];
  if (p.place === 1 && p.wonNight) bits.push('לקחו את הערב');
  if (p.place === 3) bits.push('סיימו אחרונים');
  if (p.isMvp) bits.push('נבחר לשחקן הערב');
  if (p.nightsBefore === 0) bits.push('ערב ראשון במועדון');
  else {
    if (p.trend === 'hot') bits.push('בכושר עולה בחודש האחרון');
    if (p.trend === 'cold') bits.push('בירידת כושר בחודש האחרון');
    if (p.runBefore >= 2) bits.push(`הגיע עם ${p.runBefore} ערבים ברצף של ניצחון`);
    if (p.droughtBefore >= 3) bits.push(`לא לקח ערב כבר ${p.droughtBefore} ערבים`);
  }
  return `[${p.key}] ${p.name} — ${bits.join(', ')}`;
}

/**
 * The derby, and permission to use it — for exactly two players.
 *
 * The one head-to-head fact a night can produce. Everything else in the payload
 * is a team result shared by five people or a career count; this is two named
 * players who were announced against each other before kick-off and then
 * actually played. Worth a sentence in both of their lines, in whichever
 * direction the evening went.
 */
function derbySection(d) {
  // English, like every other instruction here — only the data lines are
  // Hebrew, and a rule sentence with Hebrew grammar spliced through it is
  // harder to follow for no gain. The two names stay as they are, because a
  // name is the one thing that must never be rewritten.
  const before = `[${d.aKey}] ${d.aName} against [${d.bKey}] ${d.bName}, ${d.aBefore}–${d.bBefore} across ${d.faced} matches on opposite sides`;

  if (d.met === 0) {
    return `TONIGHT'S DERBY
Before kick-off the group was shown one rivalry: ${before} — level enough that neither can put the other away.

Tonight the two shirts never met. Not once, all evening. The rivalry of the season and the rotation kept them apart.

This belongs to ${d.aKey} and ${d.bKey} and to nobody else on the sheet, and it is worth a mention in both of their sentences — they were billed against each other and then spent the night waiting.
`;
  }

  const shootouts = d.penalties > 0
    ? ` ${d.penalties} of those meetings went to penalties.`
    : '';
  const verdict =
    d.aTook === d.bTook
      ? `they split it ${d.aTook}–${d.bTook}, which settles precisely nothing and is entirely in character`
      : d.aTook > d.bTook
        ? `${d.aName} came out ahead, ${d.aTook}–${d.bTook}`
        : `${d.bName} came out ahead, ${d.bTook}–${d.aTook}`;

  return `TONIGHT'S DERBY
Before kick-off the group was shown one rivalry: ${before} — level enough that neither can put the other away.

Tonight their two shirts met ${d.met} times and ${verdict}.${shootouts}

This belongs to ${d.aKey} and ${d.bKey} and to nobody else on the sheet. Both of their sentences should be about it: whoever came out ahead gets to enjoy it, and whoever came off worse hears about it. It is the only head-to-head in the entire record, so do not waste it — and do not mention it in anybody else's line.
`;
}

/**
 * The prompt. Hebrew out, one sentence per player, and a long list of things
 * the model is not allowed to make up.
 */
export function buildGradesPrompt(facts) {
  const players = facts.players.map(describe).join('\n');
  const winners = facts.winners?.length
    ? facts.winners.map(he).join(' and ')
    : 'nobody — the top was level';

  return `You are the dressing-room joker for a weekly amateur 5-a-side football night in Israel. After every night you post one line about each player next to the mark they got.

WRITE IN HEBREW. Every word must be Hebrew, except the player names, which are already Hebrew and which you must copy EXACTLY as given — never translate, transliterate, shorten or nickname a name.

HOW THE NIGHT WORKS. Three teams of five share one pitch. Two play, one rests. The winner stays on and the resting team comes on. A match is 8 minutes or ends early at a two-goal lead; still level after golden goal means penalties, worth half a win. The shirts are redrawn every week, so a colour is a team for one evening and nothing more.

THE MARKS ARE ALREADY DECIDED. Each player's mark out of ten was calculated before you saw it, from how their team did that night, whether they were picked player of the night, their record, and the run they came in on. You are NOT grading anybody. You are writing the line that goes beside a mark that already exists. Never argue with a mark, never say a mark is unfair, and never state the number itself — it is printed right next to your sentence.

WHAT YOU KNOW AND WHAT YOU DO NOT. The lines below are the ENTIRE record of the night. There are NO goals, NO scorers, NO assists, NO saves, NO tackles, NO skills and NO moments, because nobody writes them down. You must not invent any. Do not describe a goal, a miss, a save, a nutmeg, a slide tackle or anything that happened on the grass. If you catch yourself writing about a specific moment, you are making it up about a real person who will read it. Build every joke out of the facts you are given: the score, the drought, the run, the player-of-the-night pick, the first night, the collapse.

WHO A FACT BELONGS TO. Never attribute a general event, a quote or an organiser's note to a specific player unless that player's key or name is explicitly attached to it in the data below. Do not guess and do not infer who did what. If a note is unassigned, do not assign it.

You can always tell who a fact belongs to by looking at it:
- a player's own line, the one starting with their key — theirs, and only theirs
- a line naming a player — that player's
- the derby, if there is one — those two players', and nobody else's
- the organiser's note — whoever it names, and NOBODY AT ALL if it names nobody

A bad night is not evidence. The player with the lowest mark did not do it, the player who lost every match did not do it, the new player did not do it. That a line would be funnier if it were about somebody is not a reason to make it about them — it is the reason you are about to get it wrong. An unassigned note is a thing that happened at the pitch with no author, and if you cannot use it that way, do not use it.

THE TONE. Dressing-room banter between friends who have played together for years. Funny, sharp, a bit rude.

A SCORELINE IN NICER WORDS IS NOT A JOKE. "Scraped a single win" and "finished the night at the bottom" are just the facts wearing a coat. If your sentence would work as a caption under a stats table, it has failed — throw it away and reach for one of these instead:

- EXAGGERATE WILDLY. One win is not "a single win", it is dragging themselves across the line by their fingernails. Five wins is not "a good night", it was never a contest at all, it was a coronation.
- INVENT A NAME FOR THE NIGHT OR THE RUN, never for the person. "The great escape." "Three in a row now — somebody call it what it is." A nickname is for what happened, not a label stuck on somebody.
- MAKE A MOCK DEMAND OR THREAT. Call for an inquiry. Threaten the bench. Suggest a statue, or a transfer request.
- COMPARE THEM TO SOMETHING ABSURD. A landlord collecting rent. A ghost nobody could find all night. A getaway driver.
- ASK A RHETORICAL, EXASPERATED QUESTION instead of stating what happened.

Somebody whose team got hammered, or who has not won in a month, gets a proper ribbing — reach for the sharpest of these, not the safest. Somebody who took the night, or was picked player of the night, gets loud, over-the-top hype — the coronation, not the participation trophy. A genuinely ordinary night still gets one of these moves played completely deadpan — dry and flat is a joke; a shrug in a nicer font is not.

WHERE THE LINE IS. Mock the football, never the person. Their night, their drought, their luck, their shirt — all fair game. Their looks, their body, their age, their job, their family, their intelligence and their character are not, and neither is anything that would not be said to their face at the pitch. Nothing sexual, nothing about anybody's mother, no swearing. If a player had a bad night, the joke is that the night was bad — not that they are bad.

FORMAT. This is ONE request covering every player. Do not answer about one player and stop. Return ONLY a JSON object, no markdown fence, no commentary, no explanation before or after it.

The object maps each player's KEY — the short code in square brackets at the start of their line below — to one Hebrew sentence:

  {"p1": "…", "p2": "…", "p3": "…"}

Use the key, never the name, as the JSON key: the names are Hebrew and a single altered character would lose the line. Every key listed below must appear exactly once, and you must not invent a key that is not listed.

Each sentence: ONE sentence in Hebrew. One. Not two, not a sentence plus a fragment. Maximum 120 characters. No emoji. Do not write the mark itself — it is printed right beside your sentence.

THE NIGHT — ${facts.date}
Matches played: ${facts.matches}
Winner of the night: ${winners}
Player of the night: ${facts.mvp ?? 'not chosen'}

THE PLAYERS, AND WHY THEY GOT WHAT THEY GOT
${players}
${facts.derby ? `\n${derbySection(facts.derby)}` : ''}${
    facts.milestones?.length
      ? `\nWHAT PLAYERS REACHED TONIGHT\nEach of these names the player it belongs to. It belongs to nobody else.\n${list(facts.milestones, '')}\n`
      : ''
  }${
    facts.said
      ? `\nWHAT THE ORGANISER SAID ABOUT THE NIGHT
"${facts.said}"

Read it and see whether it names a player. If it names someone, it is theirs and you may go after them for it by name. If it names nobody, it is nobody's — see WHO A FACT BELONGS TO above. Do not pin it on the worst night, the newest player, or the funniest possible candidate. Say only what it says.
`
      : ''
  }
Now return the JSON object, covering all ${facts.players.length} players in one answer.`;
}

// --- The request ------------------------------------------------------------

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v) => Number.isFinite(v);
const TEAMS = ['black', 'white', 'blue'];
const TRENDS = ['hot', 'cold', 'steady'];
const KEY_RE = /^p[0-9]{1,3}$/;

/**
 * Is this the shape `gradesFacts()` produces?
 *
 * Checked for the same reason `isValidFacts` is (see recap.js): this payload
 * decides what the club's Gemini key gets spent on, and the Worker owns the
 * prompt precisely so that holding the secret word does not turn the key into a
 * general-purpose text generator. The keys are checked hardest — they are the
 * one field the *answer* is addressed by, so a duplicate would silently collapse
 * two players into one line.
 */
export function isValidGradeFacts(facts) {
  if (!facts || typeof facts !== 'object') return false;
  if (!isStr(facts.date, 20)) return false;
  if (!isNum(facts.matches)) return false;
  if (!Array.isArray(facts.winners) || facts.winners.length > 3) return false;
  if (!facts.winners.every((c) => TEAMS.includes(c))) return false;
  if (facts.mvp !== null && !isStr(facts.mvp, 80)) return false;
  if (facts.said !== null && facts.said !== undefined && !isStr(facts.said, 400)) return false;
  if (!Array.isArray(facts.milestones) || facts.milestones.length > 30) return false;
  if (!facts.milestones.every((s) => isStr(s, 300))) return false;

  if (!Array.isArray(facts.players) || facts.players.length < 1 || facts.players.length > 40) {
    return false;
  }
  const seen = new Set();
  for (const p of facts.players) {
    if (!p || typeof p !== 'object') return false;
    if (!isStr(p.key, 8) || !KEY_RE.test(p.key) || seen.has(p.key)) return false;
    seen.add(p.key);
    if (!isStr(p.id, 64) || !isStr(p.name, 80)) return false;
    if (!isNum(p.grade) || p.grade < 1 || p.grade > 10) return false;
    if (!TEAMS.includes(p.team)) return false;
    if (![p.teamWins, p.nightsBefore, p.runBefore, p.droughtBefore].every(isNum)) return false;
    if (![1, 2, 3].includes(p.place)) return false;
    if (typeof p.wonNight !== 'boolean' || typeof p.isMvp !== 'boolean') return false;
    if (p.trend !== null && !TRENDS.includes(p.trend)) return false;
  }

  return facts.derby === null || facts.derby === undefined || isValidDerby(facts.derby, seen);
}

const isValidDerby = (d, keys) => {
  if (!d || typeof d !== 'object') return false;
  // Both sides must be players the prompt actually defines, or the section
  // would point at a key that appears nowhere else in the request.
  if (!keys.has(d.aKey) || !keys.has(d.bKey) || d.aKey === d.bKey) return false;
  if (!isStr(d.aName, 80) || !isStr(d.bName, 80)) return false;
  return [d.aBefore, d.bBefore, d.faced, d.met, d.aTook, d.bTook, d.penalties].every(isNum);
};

// A sentence was asked for in 120 characters. This is the ceiling on what gets
// *stored* if the model ignores that, and it is deliberately far above the ask:
// its job is to bound a value every device in the club downloads, not to police
// the brief. A line arriving anywhere near this has already failed the brief in
// a way a truncation would only hide.
const MAX_LINE = 300;

/**
 * Pull the lines out of whatever came back, keyed by player id.
 *
 * The prompt asks for a bare JSON object and models return one wrapped in a
 * markdown fence often enough that refusing those would be throwing away good
 * answers over punctuation — so the object is located by its braces rather than
 * by trusting the reply to start with one.
 *
 * **The `p1` codes stop here.** They exist for the length of one request, and
 * what comes out is addressed by player id, so nothing stored or rendered ever
 * depends on a handle whose meaning was the order of one array.
 *
 * **Every player gets an entry, whether or not the model wrote about them**,
 * because the mark is now the published artifact rather than something each
 * device works out for itself — see the note on `grade` below.
 */
function linesFrom(raw, players) {
  const from = raw.indexOf('{');
  const to = raw.lastIndexOf('}');
  if (from === -1 || to <= from) return { error: 'the model did not return a JSON object' };

  let parsed;
  try {
    parsed = JSON.parse(raw.slice(from, to + 1));
  } catch {
    return { error: 'the model returned something that is not JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'the model did not return a JSON object' };
  }

  const lines = {};
  // Named rather than counted: a re-roll is worth it for two missing players
  // and not for one, and that judgement belongs to whoever is looking at the
  // screen. A number would not let them make it.
  const missing = [];
  let wrote = 0;
  for (const p of players) {
    const said = parsed[p.key];
    const has = typeof said === 'string' && said.trim().length > 0;
    if (!has) missing.push(p.name);
    else wrote++;
    // **The mark is published, not recomputed**, and this is the only place it
    // can be. `grades.ts` reads the organiser's private rating (§2.28, §2.39),
    // which `publicFixture` strips out of `GET /history` — so every device
    // except the organiser's would work out a *different* number from the same
    // archive. Measured on the real club: six of sixteen players came out half
    // a mark apart. Storing the figure the organiser actually saw is what makes
    // one night one set of marks for everybody, the same way `GET /values`
    // publishes a price nobody else could compute.
    //
    // `text` is absent rather than empty when the model skipped somebody: a
    // mark with no banter is an ordinary, complete state.
    lines[p.id] = has ? { text: said.trim().slice(0, MAX_LINE), grade: p.grade } : { grade: p.grade };
  }
  if (wrote === 0) {
    return { error: 'the model answered about nobody on the sheet' };
  }
  return { lines, missing };
}

/**
 * Ask Gemini for every player's line, in one request.
 *
 * Returns `{ lines, missing, model }` or `{ error }` — never throws, because a
 * grade renders perfectly well as a bare number and the sentence beside it is
 * decoration.
 *
 * One call for the whole sheet rather than one per player, which is a cost
 * decision and a quality one: fifteen separate requests would burn a day's free
 * tier on a single night, and fifteen independent completions have no way to
 * avoid handing the same joke to four different people.
 */
export async function writeGrades(env, facts) {
  const said = await callGemini(env, buildGradesPrompt(facts));
  if (said.error) return { error: said.error };

  const out = linesFrom(said.raw, facts.players);
  return out.error ? out : { ...out, model: said.model };
}
