// The night reporter: facts in, a Hebrew match report out (§2.24).
//
// Lives in the Worker for one reason that is not negotiable — the API key.
// Vite compiles env values into the client bundle, so a key in the app is a
// key in everybody's DevTools. It is a wrangler secret here, and the browser
// never talks to Google.
//
// **The Worker builds the prompt, the client only sends counts.** The client
// could send finished prompt text and save this file a job, and then anyone
// holding the admin word could make our key write anything at all.
//
// Note what that does and does not buy. `isValidFacts` checks the *shape* —
// the rules, the format and the line nobody crosses are written here and
// cannot be sent from outside — but the names and the story lines are free
// text pasted into the prompt, so somebody with the word can still steer what
// comes back. That is not the hole it sounds like: the same word already
// stores 8000 characters of anything at all via `{ text }`. What this stops is
// the *key* becoming a general-purpose text generator for whoever holds the
// word, which is Google's problem with us rather than ours with the club.
//
// **Nothing invented.** The data has no goals, no scorers, no assists, no
// saves — it has who beat whom, in what order. A sports-writer prompt with no
// guard rails will supply all four from imagination, so the rules below say
// what the data is, what it is not, and that nothing outside it may appear.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// Free tier, and far more than a weekly recap needs.
//
// Overridable with a `GEMINI_MODEL` secret, and that escape hatch is not
// theoretical: this was `gemini-2.5-flash` until Google answered a call with
// "no longer available to new users, use models/gemini-3.6-flash". A model name
// is the one thing in this file guaranteed to go stale, so it is one secret
// away from being fixed without a deploy — and the error that says so now
// arrives verbatim, which is how that took a minute to diagnose instead of an
// evening.
const DEFAULT_MODEL = 'gemini-3.6-flash';

// Deliberately far more than the report needs.
//
// This number has been wrong twice, in both directions of the same trap:
// thinking is on by default and is *paid for out of this budget*, so a cap
// sized for the answer is spent before the answer starts. At 900 the reply came
// back empty (`finishReason: MAX_TOKENS`, no content). At 1600 — with the
// thinking switch dropped by the 400 retry — it came back as half a sentence
// ending mid-word, which is worse, because a truncated report looks like a
// broken feature rather than a failed call.
//
// So: budget for the thinking *and* the writing, with room to spare. Output
// tokens are the cheap part of a weekly report, and the free tier's limit is a
// million a minute.
const MAX_TOKENS = 10000;
// A report is banter, not a legal document. The numbers in it are load bearing
// and the prompt is what keeps those straight; this is only deciding how far
// the writing is willing to go, and a cautious setting reads as a cautious
// report.
const TEMPERATURE = 1;

// How to ask a model to stop thinking, in the order worth trying.
//
// There is no single answer: 3.x wants a `thinkingLevel`, 2.5 wants a
// `thinkingBudget`, some models refuse to have it turned off at all, and a
// model that dislikes the field answers `400 Request contains an invalid
// argument` without naming it. So each is tried in turn and a 400 moves to the
// next — worst case three calls, and only ever when the one before failed.
const THINKING = [{ thinkingLevel: 'low' }, { thinkingBudget: 0 }, null];

// The report comes back wrapped in this, and only what is inside it is kept.
// Asking a model for "five paragraphs and here are the rules" invites it to
// check its work in the open — the first real attempt came back with
// "Let's check every single rule again: 1. Paragraphs: Yes, exactly 5" in the
// middle of the Hebrew, which is exactly what would have gone to WhatsApp.
// A delimiter costs nothing and makes the answer machine-findable rather than
// a matter of trusting the model to have kept quiet.
const OPEN = '<report>';
const CLOSE = '</report>';

const between = (text) => {
  const from = text.indexOf(OPEN);
  const to = text.lastIndexOf(CLOSE);
  if (from === -1) return null;
  return text.slice(from + OPEN.length, to === -1 ? undefined : to).trim() || null;
};

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
    isStrList(facts.moments, 12) &&
    isStrList(facts.milestones, 20) &&
    isStrList(facts.duos, 6) &&
    // absent on a client that predates these; an empty list, not a fault
    (facts.notes === undefined || isStrList(facts.notes, 10)) &&
    // the organiser's own line. Capped here as well as in the app: this is the
    // one field in the payload that is prose rather than a counted thing, so
    // it is the one that could arrive as a wall of text.
    (facts.said === undefined || isStr(facts.said, 400)) &&
    // sent by one build and taken back out; accepted so an older client is not
    // refused, ignored by the prompt
    (facts.table === undefined || isStrList(facts.table, 5))
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

THE SHIRTS ARE DRAWN FRESH EVERY WEEK. A colour is a team for one evening and nothing else. The people in tonight's השחורים will be spread across all three teams next week, so השחורים of next week are different people wearing the same shirts. Write about the colours as much as you like *within tonight* — they won it, they held the pitch, they collapsed — but never as something that continues. A colour has no future, no history of its own, and nothing to prove next week. Only the players do.

WHAT YOU KNOW AND WHAT YOU DO NOT. Everything below is the complete record of the night. There are NO goal counts, NO scorers, NO assists, NO saves, NO substitutions and NO minute-by-minute events, because nobody records them. You must not invent any of them. Do not describe a goal, name a scorer, credit an assist, praise a save, or say what any single moment looked like. Write only about what is here: who beat whom, in what order, and what it added up to. Every number you use must appear below, unchanged.

THE NIGHT — ${facts.date}
Matches played: ${facts.matches}
Decided on penalties: ${facts.penalties}
The lead changed hands: ${facts.leadChanges} times
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

${
    facts.said
      ? `WHAT THE ORGANISER SAID HAPPENED
"${facts.said}"

This is the one line here that was not counted — somebody who was there typed it as they filed the night, and it is true. It is also the only thing in this report that the scoreboard could never have told you, so use it: work it into the report properly, give it a sentence of its own or more, and be as funny about it as it deserves. Do not invent detail around it — say what it says and no more than what it says — and do not treat it as permission to describe goals, saves or moments in the matches. Whoever is named in it is fair game on exactly the terms below: the ribbing rules apply to this line like everything else.

`
      : ''
  }THE STORIES IN THIS NIGHT
These are the good material. They are written as bare facts on purpose; your job is to turn the ones you use into the funniest true sentences in the report. Use as many as you can fit naturally, and give the strangest one room to breathe.
${list(facts.notes ?? [], '- none this week; find the story in the results instead')}

HOW TO WRITE IT.

Open with a byline on its own line, in this shape:

📻 <name of the reporter> מדווח מהמגרש

Invent the reporter. A different one every time, and an absurd one: an over-serious Hebrew sports-broadcaster name, or a ridiculous pun on one, the kind of byline that would never appear in a real newspaper. Never use a real journalist's name, and never use the name of anyone playing tonight.

Then five paragraphs, in this order, 280 to 380 words in total:

1. THE OPENING. What kind of night it was and who won it. Use the shape, the number of matches, the lead changes and the change index. Do not open with the date.
2. THE WINNERS. The team that took the night: their points, how many matches they played, their longest run, and the players in that team by name.
3. THE OTHER TWO TEAMS. One or two sentences each, both of them, by name — points, matches played, longest run, and at least one player named from each. Neither team may be skipped, even if their night was quiet. A team that won nothing gets a line about that.
4. THE PEOPLE. This is the heart of the report and it should be the longest paragraph.${
    facts.said
      ? ' The line under WHAT THE ORGANISER SAID HAPPENED belongs here, and it is the best thing you have been given — nothing else in this record is an actual event.'
      : ''
  } Milestones reached, the stories above, the player of the night, and anyone who won a lot or a little. Somebody who played four or more and won nothing gets a sympathetic ribbing rather than a kicking. Superstition is encouraged — if somebody keeps winning in one shirt colour, that is a curse and a blessing, not a coincidence.
5. THE SIGN-OFF. One or two sentences looking forward to next week. Make somebody a promise or a threat about it — and it must be **people, by name**. Never aim it at a shirt colour: the teams are redrawn, so "if השחורים don't start winning next week" is a threat against five people who will not be in that team. Name the players you are coming for.

Rules:
- Every paragraph must be a complete thought that finishes. Never stop mid-sentence.
- The voice of an over-excited sports broadcaster who takes an amateur football night far too seriously. Funny, dramatic, and personal.

WHO IS READING THIS. A WhatsApp group of friends who have played together for years and take the mickey out of each other constantly. They asked for this and they want it sharp. A polite report is a failed report — if nobody would send it a laughing emoji, it was not worth writing.

- Go at people by name and be merciless about their results. Hand out nicknames and grand titles and take them away again. Declare feuds, curses, dynasties and conspiracies that do not exist. Demand explanations. Call for somebody to be dropped, sold, investigated, or given a statue. Be mock-outraged, mock-heartbroken, or openly biased about who you think should have won.
- Absurd attribution is welcome — "sources close to the changing room", "witnesses say", "he is understood to be furious" — as long as it is plainly ridiculous rather than a plausible quote somebody might think was real. Never write a realistic quotation and attribute it to a player.
- A player who lost all night should be roasted for it properly, not sympathetically. A player who won everything should be accused of something.
- Emojis: a few, placed where a broadcaster would raise their voice. Not one per sentence.
- The personal stories are stories, not statistics. If somebody usually loses to an opponent and beat them tonight, that is a rivalry and a headline — write it as one, do not print it as a record.
THE ONE LINE YOU DO NOT CROSS. Everything you mock is a *result*: matches won and lost, shirts worn, streaks, turning up, who beat whom. Never a person's body, weight, looks, age, health, money, job, family, politics, religion, or anything else about who they are rather than how their night went. Never state as fact that somebody is bad at football — say the scoreboard laughed at them instead. These fifteen people play together every week and all of them read this: it has to be the kind of ribbing that gets sent to the group by the person it is about.
- Every number must come from the record above, unchanged. If something is not written above, it did not happen and must not be mentioned.
- Nothing about a shirt colour may point outside tonight. No colour is owed revenge, due a comeback, on a decline, or expected to do anything next week — next week's teams do not exist yet.
- A player's own record in a colour is fair game, because that is about the player: somebody who keeps winning whenever they happen to wear white is cursed or blessed, and that follows them into whatever shirt they get handed next.
- The shape of the night is a description rather than a statistic: say what it means in ordinary words — a night that swung constantly, a night one team ran away with — the way a commentator would, and never as a figure or under a name of its own.
- Do not describe any single match as an event. You do not know how any of them looked.
- No headline, no title, no bullet points, no markdown, no closing sign-off line with your name. Just the five paragraphs, ready to be pasted into a group chat as they are.

OUTPUT FORMAT. Put the finished report, and nothing else, between ${OPEN} and ${CLOSE}. Do not check your work inside those tags, do not restate these rules inside them, do not explain your choices inside them. Anything outside the tags is discarded, so the tags must contain the whole report and none of your working.

${OPEN}
(the five paragraphs, in Hebrew)
${CLOSE}`;
}

/**
 * Ask Gemini. Returns { text } or { error } — never throws, because a recap is
 * decoration and a night page must render exactly the same without one.
 */
export async function writeRecap(env, facts) {
  const key = env.GEMINI_KEY;
  if (!key) return { error: 'not-configured' };
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;

  const ask = (thinking) =>
    fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(facts) }] }],
        generationConfig: {
          temperature: TEMPERATURE,
          maxOutputTokens: MAX_TOKENS,
          // see THINKING: on by default, and paid for out of the same budget
          // as the reply
          ...(thinking ? { thinkingConfig: thinking } : {}),
        },
      }),
    });

  let res;
  try {
    res = await ask(THINKING[0]);
    for (let i = 1; i < THINKING.length && res.status === 400; i++) {
      res = await ask(THINKING[i]);
    }
  } catch {
    return { error: 'unreachable' };
  }

  if (res.status === 429) return { error: 'quota' };
  if (!res.ok) {
    // Google says *why* in the body — a wrong model name, a key with the API
    // disabled, a referrer restriction — and every one of those reads as a
    // generic outage without it. Worth the twenty characters.
    let why = '';
    try {
      const body = await res.json();
      const parts = [];
      if (body?.error?.message) parts.push(String(body.error.message));
      // "Request contains an invalid argument" says nothing on its own; which
      // argument is in the details, and that is the whole diagnosis.
      for (const d of body?.error?.details ?? []) {
        for (const v of d?.fieldViolations ?? []) {
          parts.push(`${v.field ?? '?'}: ${v.description ?? ''}`.trim());
        }
      }
      why = parts.length ? `: ${parts.join(' | ').slice(0, 400)}` : '';
    } catch {
      why = '';
    }
    return { error: `upstream ${res.status}${why}` };
  }

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

  const candidate = data?.candidates?.[0];
  // A part marked `thought` is the model reasoning out loud, not the report.
  // Never asked for, but a part that arrives is a part that would otherwise be
  // pasted into WhatsApp as though somebody had written it.
  const raw = (candidate?.content?.parts ?? [])
    .filter((p) => !p?.thought)
    .map((p) => p?.text ?? '')
    .join('')
    .trim();
  // An empty answer always has a reason attached, and the reason is the whole
  // difference between "it refused" and "it never got started".
  if (!raw) return { error: `empty (${candidate?.finishReason ?? 'no candidate'})` };

  // Only what is inside the tags. Deliberation that arrives as ordinary text —
  // unflagged, indistinguishable from the report by any other means — falls
  // outside them and is dropped. No tags at all means the model did not follow
  // the one instruction that makes its answer usable, and a report nobody can
  // trust the boundaries of is worse than none.
  const text = between(raw);
  if (!text) return { error: 'the model wrote its working out instead of a report' };
  return { text };
}
