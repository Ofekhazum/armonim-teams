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

import { callGemini } from './gemini.js';

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
      ? `SOMETHING ELSE THAT HAPPENED TONIGHT
"${facts.said}"

This is true, and it is the only thing in this record that is an *event* rather than a number — everything else you have been given is a scoreline. So it is the most valuable material in the report and it should read that way: give it **two or three sentences, not one**, and make them the funniest in the piece. Build on it properly — an absurd consequence, a mock investigation, a grand conclusion drawn from it, a callback to it later in the paragraph. A single flat sentence reporting it and moving on is the one way to waste it.

**IT MAY DESCRIBE MORE THAN ONE THING.** Read it as a whole before you use any of it. It can hold two separate events, or three or more, and they arrive in either of two shapes:

- **One per line**, sometimes with a dash or a number in front. Every line is its own event. This is the clearest case and you must treat each line separately.
- **Run together in one sentence**, joined by a comma or an "and". Split it yourself. Be careful here: "X and Y" is sometimes one event described in two halves and sometimes two unrelated events, and the test is whether either half stands up on its own as a thing that happened.

However they arrive, they are **separate facts with separate owners** — work through them one at a time, do not merge them into a single story, and never assume the person named in one had anything to do with another. Use as many as you can carry; the funniest gets the most room and a small one can be a throwaway aside. Every ownership rule below applies to **each event on its own**.

YOU SAW IT YOURSELF. You were at the pitch tonight. Never say where this came from — no "according to the organisers", no "it was reported that", no mention of anyone having handed you this. You watched it happen, and you write it that way. (This is about not citing a source for something you witnessed. The invented, obviously-ridiculous attribution described further down — "sources close to the changing room say" — is a joke and is still very welcome; it is a different thing entirely.)

WHO IT BELONGS TO. Take each event in the line above separately, and for each one see whether it names a player. Two events in one line can have two different answers — one may name somebody and the next may name nobody, and getting that right for one does not excuse getting it wrong for the other.
- If it names someone, it is theirs. Go after them for it by name, as hard as the rest of the report goes after anybody.
- If it names nobody, it belongs to nobody, and NO PLAYER'S NAME MAY APPEAR ANYWHERE NEAR IT. Report it as a thing that happened tonight, with no author. Do not guess who did it. Do not pin it on a player or a team. Do not tell anybody to do better at it, aim straighter, or stop doing it next week. Naming a culprit the line does not name is inventing something, and it is the same offence as inventing a goal.

This holds in EVERY paragraph, and the last one is where it gets broken. The sign-off asks you to name players — name them for their RESULTS, for the matches they lost and the nights they went home empty. A report that ends by telling six players to keep the ball on the pitch next week has just blamed six people for something nobody was said to have done. If the line names nobody, next week is not about it.

Say what it says and no more than what it says. Do not invent surrounding detail, and do not treat it as permission to describe goals, saves or moments inside the matches. Match your tone to what it actually is: most of these are absurd and deserve to be treated as such, but if it is not a funny thing, report it straight rather than forcing a joke onto it.

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
      ? ' Everything under SOMETHING ELSE THAT HAPPENED TONIGHT belongs here, and it is the best material you have been given — nothing else in this record is an actual event. Give it real room (two or three sentences, and more if it holds more than one event) rather than a passing mention.'
      : ''
  } Milestones reached, the stories above, the player of the night, and anyone who won a lot or a little. Somebody who played four or more and won nothing gets a sympathetic ribbing rather than a kicking. Superstition is encouraged — if somebody keeps winning in one shirt colour, that is a curse and a blessing, not a coincidence.
5. THE SIGN-OFF. One or two sentences looking forward to next week, aimed at **people, by name**, called out for **their own results tonight**: who won nothing, who won everything, who is on a run, who has not taken a night since the spring. And never aim it at an event nobody was named for — see WHO IT BELONGS TO above if there is a line up there. This is also the paragraph where the shirt rule gets broken, every time, so read it again before you write this: **next week's teams do not exist yet and nobody is in one.** A threat, a promise or a warning may only be made to a named player about themselves.

   Wrong, and the exact mistake to avoid: "נראה אם הכחולים יצליחו להגן על התואר" — the blues of next week are five different people. Also wrong: "השחורים חייבים לחזור חזק", "הלבנים ירצו נקמה", or anything at all about what a colour will do, want, defend or avenge.

   Right: "ניב לוקח ערב שלישי ברצף, ומישהו צריך לעצור אותו לפני שזה נהיה הרגל" — a named person, their own record, and no assumption about what shirt anybody will be wearing.

Rules:
- Every paragraph must be a complete thought that finishes. Never stop mid-sentence.
- The voice of an over-excited sports broadcaster who takes an amateur football night far too seriously. Funny, dramatic, and personal.

WHO IS READING THIS. A WhatsApp group of friends who have played together for years and take the mickey out of each other constantly. They asked for this and they want it sharp. A polite report is a failed report — if nobody would send it a laughing emoji, it was not worth writing.

- Go at people by name and be merciless about their results. Hand out nicknames and grand titles and take them away again. Declare feuds, curses, dynasties and conspiracies that do not exist. Demand explanations. Call for somebody to be dropped, sold, investigated, or given a statue. Be mock-outraged, mock-heartbroken, or openly biased about who you think should have won.
- Absurd attribution is welcome — "sources close to the changing room", "witnesses say", "he is understood to be furious" — as long as it is plainly ridiculous rather than a plausible quote somebody might think was real. Never write a realistic quotation and attribute it to a player. **Once, maybe twice in the whole report.** It is a punchline, and a report where every second sentence has an anonymous source has turned its best joke into a verbal tic.
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
 * Ask Gemini for the report.
 *
 * Returns `{ text, model }` or `{ error }` — never throws, because a recap is
 * decoration and a night page must render exactly the same without one. The
 * waterfall, the retries and the error wording all live in `gemini.js`; what is
 * left here is the one thing that is about reports, which is refusing an answer
 * that did not arrive between the tags.
 */
export async function writeRecap(env, facts) {
  const said = await callGemini(env, buildPrompt(facts));
  if (said.error) return { error: said.error };

  // Only what is inside the tags. Deliberation that arrives as ordinary text —
  // unflagged, indistinguishable from the report by any other means — falls
  // outside them and is dropped. No tags at all means the model did not follow
  // the one instruction that makes its answer usable, and a report nobody can
  // trust the boundaries of is worse than none.
  const text = between(said.raw);
  if (!text) return { error: 'the model wrote its working out instead of a report' };
  return { text, model: said.model };
}
