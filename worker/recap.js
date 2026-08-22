// The night reporter: facts in, a Hebrew match report out (§2.24).
//
// Lives in the Worker for one reason that is not negotiable — the API key.
// Vite compiles env values into the client bundle, so a key in the app is a
// key in everybody's DevTools. It is a wrangler secret here, and the browser
// never talks to Google.
//
// **The Worker builds the prompt, the client only sends counts.** The client
// could send finished prompt text and save this file a job, and then anyone
// holding the admin word could make our key write anything at all. Facts in a
// validated shape can only ever produce a match report.
//
// **Nothing invented.** The data has no goals, no scorers, no assists, no
// saves — it has who beat whom, in what order. A sports-writer prompt with no
// guard rails will supply all four from imagination, so the rules below say
// what the data is, what it is not, and that nothing outside it may appear.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// Free tier, and far more than a weekly recap needs. Overridable without a
// deploy, since model names move faster than this project does.
const DEFAULT_MODEL = 'gemini-2.5-flash';

// Long enough for three paragraphs of Hebrew, short enough that a runaway
// generation cannot cost us the day's quota.
const MAX_TOKENS = 900;
// A recap is banter, not a legal document — but the numbers in it are load
// bearing, so this sits below the playful end.
const TEMPERATURE = 0.9;

// What a stored recap looks like in KV under `recap:<fixtureId>`.
export const recapKey = (fixtureId) => `recap:${fixtureId}`;

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v) => Number.isFinite(v);
const isStrList = (v, max) => Array.isArray(v) && v.length <= max && v.every((s) => isStr(s, 300));

/**
 * Is this the shape `recapFacts()` produces?
 *
 * Not paranoia about our own client: this is the payload that decides what our
 * key is spent on, so it is checked the way `/live` checks a fixture. Anything
 * unexpected is refused rather than forwarded.
 */
export function isValidFacts(facts) {
  if (!facts || typeof facts !== 'object') return false;
  if (!isStr(facts.date, 20)) return false;
  if (![facts.matches, facts.penalties, facts.leadChanges, facts.chaos].every(isNum)) return false;
  if (!isStr(facts.flavour, 40)) return false;
  if (!isStrList(facts.winners, 3)) return false;
  if (facts.mvp !== null && !isStr(facts.mvp, 80)) return false;
  if (!Array.isArray(facts.teams) || facts.teams.length !== 3) return false;
  for (const t of facts.teams) {
    if (!t || !isStr(t.team, 20)) return false;
    if (![t.points, t.played, t.longestRun].every(isNum)) return false;
    if (!isStrList(t.players, 12)) return false;
  }
  if (!Array.isArray(facts.players) || facts.players.length > 40) return false;
  for (const p of facts.players) {
    if (!p || !isStr(p.name, 80) || !isStr(p.team, 20)) return false;
    if (![p.played, p.won].every(isNum)) return false;
  }
  return (
    isStrList(facts.moments, 12) && isStrList(facts.milestones, 20) && isStrList(facts.duos, 6)
  );
}

const list = (items, empty) => (items.length ? items.map((s) => `- ${s}`).join('\n') : empty);

/**
 * The prompt. Hebrew output, because it is read in a Hebrew WhatsApp group by
 * people whose names are in Hebrew — the app's own chrome being English is a
 * fact about the app, not about its audience.
 */
export function buildPrompt(facts) {
  const teams = facts.teams
    .map(
      (t) =>
        `${t.team}: ${t.points} points from ${t.played} matches, longest run ${t.longestRun}. Squad: ${t.players.join(', ')}`,
    )
    .join('\n');

  const players = facts.players
    .map((p) => `${p.name} (${p.team}): played ${p.played}, won ${p.won}`)
    .join('\n');

  return `You are writing the match report for a weekly amateur 5-a-side football night in Israel.

WRITE IN HEBREW. Every word of the output must be Hebrew, except player names, which are already Hebrew, and which you must copy exactly as given — never translate, transliterate or shorten a name.

Call the teams by these Hebrew names:
Black = השחורים
White = הלבנים
Blue = הכחולים

HOW THE NIGHT WORKS. Three teams of five share one pitch. Two play, one rests. The winner stays on and the resting team comes on, so a team on a winning run never leaves the pitch and a team that loses sits out exactly one match. A match is 8 minutes or ends early at a two-goal lead; level at the end means two minutes of golden goal, and still level means penalties, which count as half a win.

WHAT YOU KNOW AND WHAT YOU DO NOT. Everything below is the complete record of the night. There are NO goal counts, NO scorers, NO assists, NO saves, NO substitutions and NO minute-by-minute events, because nobody records them. You must not invent any of them. Do not describe a goal, name a scorer, credit an assist, praise a save, or say what any single moment looked like. Write only about what is here: who beat whom, in what order, and what it added up to. Every number you use must appear below, unchanged.

THE NIGHT — ${facts.date}
Matches played: ${facts.matches}
Decided on penalties: ${facts.penalties}
The lead changed hands: ${facts.leadChanges} times
Change index: ${facts.chaos} out of 100 (how often the winner differed from the previous match)
Shape of the night: ${facts.flavour}
Winner of the night: ${facts.winners.length ? facts.winners.join(' and ') : 'nobody — no result recorded'}
Player of the night: ${facts.mvp ?? 'not chosen'}

THE TEAMS
${teams}

WHAT EACH PLAYER PLAYED
${players}

MOMENTS IN THE SEQUENCE
${list(facts.moments, '- nothing out of the ordinary happened')}

WHAT PLAYERS REACHED THIS NIGHT
${list(facts.milestones, '- nothing was reached')}

PAIRS WORTH MENTIONING
${list(facts.duos, '- none')}

HOW TO WRITE IT.
- Three short paragraphs, 120 to 180 words in total.
- The voice of an over-excited sports broadcaster who takes an amateur football night far too seriously. Funny, warm, a bit dramatic. Emojis are welcome, a few, not a wall of them.
- Name real people. Tease them about results, never about their ability, their body or anything that is not in the record above. Nobody should read this and feel got at — these fifteen people play together every week.
- Lead with whatever is genuinely the most interesting thing above, not with the date.
- If a player reached a milestone, that is worth a line.
- No headline, no title, no bullet points, no markdown. Just the paragraphs, ready to be read as-is.`;
}

/**
 * Ask Gemini. Returns { text } or { error } — never throws, because a recap is
 * decoration and a night page must render exactly the same without one.
 */
export async function writeRecap(env, facts) {
  const key = env.GEMINI_KEY;
  if (!key) return { error: 'not-configured' };
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;

  let res;
  try {
    res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(facts) }] }],
        generationConfig: { temperature: TEMPERATURE, maxOutputTokens: MAX_TOKENS },
      }),
    });
  } catch {
    return { error: 'unreachable' };
  }

  if (res.status === 429) return { error: 'quota' };
  if (!res.ok) return { error: `upstream ${res.status}` };

  let data;
  try {
    data = await res.json();
  } catch {
    return { error: 'bad response' };
  }

  // A blocked generation comes back 200 with no candidate and a reason, which
  // is worth reporting as itself rather than as a generic failure.
  const blocked = data?.promptFeedback?.blockReason;
  if (blocked) return { error: `blocked: ${blocked}` };

  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p?.text ?? '')
    .join('')
    .trim();
  if (!text) return { error: 'empty' };
  return { text };
}
