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
    // One settled derby, or absent — see the prompt section.
    //
    // Raised from 300 when the line started naming the winner outright instead
    // of ending in a bare scoreline (§2.33.1). It reads long because every
    // number now travels beside the name that owns it, and two long Hebrew
    // names with a three-figure head-to-head measured at 348 — over the old
    // cap, and the failure there is not a truncated derby line, it is
    // `400 bad facts` and a night with no report at all.
    (facts.derby === undefined || isStr(facts.derby, 500)) &&
    // the organiser's own line. Capped here as well as in the app: this is the
    // one field in the payload that is prose rather than a counted thing, so
    // it is the one that could arrive as a wall of text.
    //
    // Raised from 400 when the note became a list of up to six events with a
    // real sentence each (`NOTE_MAX`, now 1432). This is the *receiving* end,
    // so it is the number that has to move first: a Worker still holding 400
    // does not shorten a longer note, it answers `400 bad facts` and the night
    // gets no report at all. Deliberately above the app's own cap rather than
    // equal to it, so the limit an organiser meets is always the one with a
    // counter next to it.
    (facts.said === undefined || isStr(facts.said, 1600)) &&
    // sent by one build and taken back out; accepted so an older client is not
    // refused, ignored by the prompt
    (facts.table === undefined || isStrList(facts.table, 5))
  );
}

const list = (items, empty) => (items.length ? items.map((s) => `- ${s}`).join('\n') : empty);

/**
 * The organiser's note, split into the separate events it may describe.
 *
 * **Split here rather than in the prompt, which is the whole point.** The note
 * used to arrive as one quoted blob with an instruction to work out for itself
 * where one event ended and the next began — and every ownership rule depends
 * on getting that right, because one event can name a player (which is what
 * hands the reporter permission to go after them) while the next names nobody
 * and must stay unattributed. Leaving that to a model's reading of a comma was
 * the weak link. Code splits it; the model is handed a numbered list and never
 * has to decide.
 *
 * Two separators, both of which an organiser types naturally:
 *
 * - **`@like this@`** — explicit, and the one to reach for when an event is
 *   long enough to wrap or holds punctuation a plainer split would trip on. If
 *   any `@…@` pair is present, only those are read, so a half-marked note
 *   cannot silently produce a mix of marked and unmarked events.
 * - **One per line** otherwise, with a leading bullet or number trimmed off.
 *   The default, because it needs no syntax at all.
 *
 * Prose with no separator comes back as a single event, which is the right
 * answer: "the ball went over the fence and somebody brought a dog" is
 * genuinely undecidable between one event and two, and splitting on "and"
 * would break far more notes than it fixed.
 */
export function splitEvents(said) {
  if (typeof said !== 'string') return [];
  const marked = [...said.matchAll(/@([^@]+)@/g)].map((m) => m[1].trim()).filter(Boolean);
  if (marked.length > 0) return marked;
  return said
    .split('\n')
    // a leading "-", "*", "1." or "1)" is the organiser saying "next one", not
    // part of what happened
    // repeated, so "- 3. something" loses both markers rather than one
    .map((line) => line.replace(/^\s*(?:(?:[-*•]|\d+[.)])\s*)+/, '').trim())
    .filter(Boolean);
}

/**
 * The prompt. Hebrew output, because it is read in a Hebrew WhatsApp group by
 * people whose names are in Hebrew — the app's own chrome being English is a
 * fact about the app, not about its audience.
 */
export function buildPrompt(facts) {
  // Split once, up here, because two parts of the prompt need the count: the
  // section that hands the events over, and the word budget below.
  //
  // **The budget has to grow with them, or the rule above is a trap.** Asking
  // for two sentences about each of four events inside a fixed 380 words is
  // asking for four events and five paragraphs in the space of three, and what
  // comes back is the announcing this is trying to stop — the model obeys the
  // number it can count and skimps on the one it cannot. Roughly forty words
  // per extra event buys each of them the room it was just promised.
  const events = splitEvents(facts.said);
  const extra = Math.max(0, events.length - 1) * 40;
  const words = `${280 + extra} to ${380 + extra}`;

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

NOT ONE WORD OF ANY OTHER LANGUAGE. No English, no Spanish, no Italian, no Latin, no transliteration — not even a single word for flourish, emphasis or rhythm. A report came back with the Italian "finalmente" sitting in the middle of a Hebrew sentence, which reads to this group as a glitch rather than as style. If a word feels like the right flavour and it is not Hebrew, it is the wrong word: write the Hebrew. The ONLY Latin characters permitted anywhere in the output are the letters of a player's name, and only if their name was given to you that way.

NEVER WRITE A DATE. Not the night's own date, not a date from any fact below, in any form — no 2026-08-06, no 6.8, no "באוגוסט". The facts below are counted in *nights*, and a span is said the way a person says it: "חמישה מחזורים", "מאז אמצע הקיץ". A number that looks like a calendar entry has been copied rather than written.

THE WORD FOR A CLUB NIGHT IS "מחזור". Everything below is counted in what it calls "nights" — that is the English for it, and the Hebrew is **מחזור** (plural **מחזורים**), which is what this club has always called one. Never "לילה", never "לילות", never "ערב". "ארבעה מחזורים ללא ניצחון", not "4 לילות ללא ניצחון".

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

A FACT IS RAW MATERIAL, NOT A SENTENCE. Every line in this record is written as a bare clause so that you can build something out of it. Building means giving it a consequence, an accusation, a nickname, a rivalry, a mock-investigation — a reason the group laughs. Copying it means moving it into Hebrew and putting a comma after it.

The failure to avoid, verbatim from a real report: "יועד שבר בצורת של 4 לילות ללא ניצחון, חנש ניצח את יוני, ושי חזר לשחק לראשונה מאז 2026-08-06." Three separate people's nights, flattened into one list, each given four words and no joke. Nobody reading that learns anything they could not have read off the table.

So: **never put two people's facts in the same sentence as a list.** One fact, one sentence at minimum, and the good ones get two or three. A fact you cannot think of anything to say about is a fact to DROP — leaving it out entirely is better than reciting it, and there are always more facts here than a 380-word report can carry. Three facts written properly beat eight facts announced.

The same goes for the shape of the paragraph. A paragraph that is one long chain of "X did this, Y did that, ו-Z did the other" has listed the night rather than reported it, however good each clause is on its own.

This is about *facts*, not about names. Naming the five players in a team is not a list — it is the team sheet, the reader wants it, and it belongs in the paragraph about that team. What must not be listed is one person's fact after another with nothing made of any of them.

PAIRS WORTH MENTIONING
${list(facts.duos, '- none')}
${
    facts.derby
      ? `
TONIGHT'S DERBY
- ${facts.derby}

**The whole club read this pairing before kick-off.** It is on a banner on the app's front page all week: these two are picked because neither of them can put the other away, and the group is told to watch for it. That makes it the one thing in this record the audience was already waiting on, and a report that does not mention it has left out the only question anybody had going in.

So it gets its own sentences, and it is written as a rivalry rather than as a record. Who came out on top tonight, what that does to a matchup that has been level for years, whether anything is actually settled. If their teams never met, that is the joke — the fixture the whole club turned up for, and the rota never put them on the pitch together.

Both names, no third one. This is the one place two names in a sentence is exactly right.

**THE LINE ABOVE ALREADY SAYS WHO WON. COPY THAT VERDICT — DO NOT WORK ONE OUT FROM THE NUMBERS.** There are exactly three things that can have happened tonight, and you are told which: one of them won it, the other one won it, or it finished level and neither did. **They cannot both have won.** A sentence that puts them both on top of this — "each of them came out on top", "both took the night" — is describing something that did not happen, and it is the one error in this whole report the group will spot on the first read, because they have been waiting on this result all week. If the line says it finished level, that is a real outcome with its own story — years of nothing between them, and tonight settled nothing either — not a reason to hand it to one of them anyway.
`
      : ''
  }

${
    facts.said
      ? `SOMETHING ELSE THAT HAPPENED TONIGHT
${
  events.length > 1
    ? `${events.length} separate things happened. They have already been separated for you — each numbered line below is its OWN event, with its own owner:\n\n${events
        .map((e, i) => `EVENT ${i + 1}: "${e}"`)
        .join('\n')}\n\nYour report must do something with ALL ${events.length}.`
    : `"${events[0] ?? facts.said}"`
}

${events.length > 1 ? `These are true, and they are the only ${events.length} things` : 'This is true, and it is the only thing'} in this record that ${events.length > 1 ? 'are *events*' : 'is an *event*'} rather than ${events.length > 1 ? 'numbers' : 'a number'} — everything else you have been given is a scoreline. So ${events.length > 1 ? 'they are' : 'it is'} the most valuable material in the report and ${events.length > 1 ? 'they' : 'it'} should read that way: **${events.length > 1 ? `each one of the ${events.length} gets its own two or three sentences` : 'give it two or three sentences, not one'}**, and make them the funniest in the piece. Build on ${events.length > 1 ? 'each of them' : 'it'} properly — an absurd consequence, a mock investigation, a grand conclusion drawn from it, a callback to it later in the paragraph. A single flat sentence reporting it and moving on is the one way to waste it.

**WHEN THERE IS MORE THAN ONE EVENT, THEY ARE ALREADY SEPARATED FOR YOU.** If you see EVENT 1, EVENT 2 and so on above, that split is not a suggestion and it is not yours to revisit — do not merge two of them into one story, do not treat one as background for another, and never assume the person named in one had anything to do with any of the others. They are **separate facts with separate owners**, and every ownership rule below is applied to **each event on its own**: one of them naming a player tells you nothing about who the next one belongs to.

**EVERY EVENT GETS TALKED ABOUT. NOT ONE OF THEM GETS ANNOUNCED.** This is the instruction that has been missed most often, so read it twice. If there are four events above, the report contains four separate pieces of *writing* about four things — not four things mentioned. There is no such thing here as an event that was covered in half a clause on the way to the next one.

The difference, on one invented event ("the ball went over the fence four times"):

- ANNOUNCED, and wrong: "והכדור עף מעבר לגדר ארבע פעמים." It is in the report. Nothing has been done with it.
- TALKED ABOUT, and right: the fence is a recurring opponent. Somebody is accused of aiming for it. A search party is dispatched and does not return. It is described as the most accurate finishing of the evening, which is a joke about the football that never happened. The groundsman is said to be considering legal action.

Same fact, and the second one is why anybody reads this. Do that for **each** event, separately.

Give every event at least two sentences of its own, and give the best one more. They do not have to sit together in one block — one can open the paragraph, another can land as a callback at the end of it — but each one must have something *made* of it somewhere: a consequence, an accusation, a mock investigation, a nickname, a grand conclusion, a rivalry with an inanimate object.

Do not drop an event. Do not merge two into one sentence. Do not summarise several as "ועוד כמה דברים מוזרים קרו". If the word count is tight, take the room from the milestones and the career facts — those are available in the app and this is not.

YOU SAW IT YOURSELF. You were at the pitch tonight. Never say where this came from — no "according to the organisers", no "it was reported that", no mention of anyone having handed you this. You watched it happen, and you write it that way. (This is about not citing a source for something you witnessed. The invented, obviously-ridiculous attribution described further down — "sources close to the changing room say" — is a joke and is still very welcome; it is a different thing entirely.)

WHO IT BELONGS TO. Take each event above separately, and for each one see whether it names a player. Two events can have two different answers — one may name somebody and the next may name nobody — and getting it right for one does not excuse getting it wrong for the other. Run this check once per event, not once for the note.
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

Then five paragraphs, in this order, ${words} words in total:

1. THE OPENING. What kind of night it was and who won it. Use the shape, the number of matches, the lead changes and the change index. Do not open with the date.
2. THE WINNERS. The team that took the night: their points, their longest run, and the players in that team by name.
3. THE OTHER TWO TEAMS. One or two sentences each, both of them, by name — their points, their longest run, and at least one player named from each. Neither team may be skipped, even if their night was quiet. A team that won nothing gets a line about that.

   MATCHES PLAYED IS USUALLY NOT A STORY. In this format the teams take turns, so their match counts come out close by design and a one- or two-match difference is the rota, not a fact about anybody. Do not report how many matches a team played unless it is genuinely conspicuous — and if it were, it would be sitting in MOMENTS or THE STORIES below, written out for you. If it is not written below, it was not remarkable: say nothing about it. Never tell a team they watched more football than they played on your own initiative, and never dress a normal count up as "strange efficiency" or "they spent the night on the bench". A team that played six of ten in a night that swung constantly was not benched; they were resting one match at a time like everybody else.
4. THE PEOPLE. This is the heart of the report and it should be the longest paragraph.${
    facts.said
      ? ` Everything under SOMETHING ELSE THAT HAPPENED TONIGHT belongs here, and it is the best material you have been given — nothing else in this record is an actual event. There ${events.length === 1 ? 'is 1 of them and it gets' : `are ${events.length} of them and each gets`} at least two sentences of its own, built on rather than announced. That is most of this paragraph, and it should be: it is the only part of the report the reader could not have worked out from the app.`
      : ''
  }${facts.derby ? ' The derby belongs here too, and it is the one fact the group was already waiting on — give it real sentences.' : ''} Milestones reached, the stories above, the player of the night, and anyone who won a lot or a little — but chosen, not collected: see A FACT IS RAW MATERIAL above. Pick the three or four people whose night is actually worth a sentence and give each of them a real one; the rest of the facts go unused, which is what they are there for. Somebody who played four or more and won nothing gets a sympathetic ribbing rather than a kicking. Superstition is encouraged — if somebody keeps winning in one shirt colour, that is a curse and a blessing, not a coincidence.
5. THE SIGN-OFF. One or two sentences looking forward to next week, aimed at **people, by name**, called out for **their own results tonight**: who won nothing, who won everything, who is on a run, who has not taken a night since the spring. And never aim it at an event nobody was named for — see WHO IT BELONGS TO above if there is a line up there. This is also the paragraph where the shirt rule gets broken, every time, so read it again before you write this: **next week's teams do not exist yet and nobody is in one.** A threat, a promise or a warning may only be made to a named player about themselves.

   Wrong, and the exact mistake to avoid: "נראה אם הכחולים יצליחו להגן על התואר" — the blues of next week are five different people. Also wrong: "השחורים חייבים לחזור חזק", "הלבנים ירצו נקמה", or anything at all about what a colour will do, want, defend or avenge.

   Right: "ניב לוקח מחזור שלישי ברצף, ומישהו צריך לעצור אותו לפני שזה נהיה הרגל" — a named person, their own record, and no assumption about what shirt anybody will be wearing.

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
/**
 * Latin-script words in a Hebrew report that are not somebody's name.
 *
 * **A rule in the prompt was not enough.** The instruction to write only in
 * Hebrew has been there from the start, and a report still came back with the
 * Italian "finalmente" in the middle of a sentence — a model reaching for
 * flavour, in a prompt that spends two hundred lines asking for flavour. It is
 * one word in four hundred, which is exactly the kind of thing nobody notices
 * until it is in the WhatsApp group.
 *
 * Names are the one legitimate source of Latin letters here, and the record
 * names everybody who played, so the check is: every Latin run has to be a name
 * that was handed to us. A guest called "Guy" passes; "finalmente" does not.
 *
 * Returns the offending words, so the caller can say which they were rather
 * than rejecting the report with a shrug.
 */
export function foreignWords(text, facts) {
  const allowed = new Set(
    (facts.players ?? [])
      .flatMap((p) => String(p.name ?? '').split(/\s+/))
      .map((w) => w.toLowerCase())
      .filter(Boolean),
  );
  return [...new Set(text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [])].filter(
    (w) => !allowed.has(w.toLowerCase()),
  );
}

/** An ISO date copied out of the record — see NEVER WRITE A DATE in the prompt. */
const datesIn = (text) => [...new Set(text.match(/\d{4}-\d{2}-\d{2}/g) ?? [])];

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

  // Refused rather than scrubbed. Deleting a stray word from the middle of a
  // Hebrew sentence leaves a sentence nobody wrote, and the organiser already
  // has a "write another one" button two centimetres away — so the honest move
  // is to say what was wrong and let them press it.
  const foreign = foreignWords(text, facts);
  if (foreign.length > 0) {
    return { error: `the report slipped out of Hebrew: ${foreign.slice(0, 5).join(', ')}` };
  }
  const dates = datesIn(text);
  if (dates.length > 0) {
    return { error: `the report printed a raw date: ${dates.slice(0, 3).join(', ')}` };
  }

  return { text, model: said.model };
}
