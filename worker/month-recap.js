// The month's show: a finished month in, a Hebrew radio script out (§2.74).
//
// The night reporter's twin, and deliberately thin beside it. Everything that
// is not about *a month* is borrowed from `recap.js` rather than restated: the
// personas, the guardrails every persona is followed by, the tags the answer
// comes back in, and the checks that refuse a report that slipped out of Hebrew
// or printed a date. What is here is the facts, read from KV, and the running
// order of the show.
//
// **The request carries a month and nothing else.** A night's facts come from
// the client; these are read by the Worker out of the stored archive, roster,
// marks and registered team. So no caller can put a word in this prompt — the
// organiser's notes are the only prose in it, and they come out of the archive
// the organiser already published.
//
// **It is written to be heard.** A night's report is read on a page and voiced
// afterwards; this one exists to be voiced. So the prompt asks for speech —
// short sentences, nothing a voice cannot say — rather than leaving
// `speakable()` to rescue a page of text.

import { callGemini } from './gemini.js';
import { CLOSE, OPEN, PERSONAS, TONE_GUARDRAILS, between, refusalOf } from './recap.js';
import { readAwards, readMonthArchive } from './awards.js';
import { readAllMarks } from './grades.js';
import { remapPlayerKeys } from '../src/guests';
import { monthFacts } from '../src/monthFacts';

/**
 * The id a month's show is stored and voiced under: `month:2026-09`.
 *
 * Stored as a recap under this id, so the voice job, the draft fingerprints
 * and the persona memory of §2.69–§2.70.1 serve a month unchanged. A fixture
 * id is base36 and never holds a colon, so the two can never meet; `/recap`
 * refuses this prefix so that a month can only be written through its own
 * route.
 */
export const monthRecapId = (period) => `month:${period}`;
export const isMonthRecapId = (id) => typeof id === 'string' && id.startsWith('month:');

/**
 * The month's facts, read out of KV, or null when the month is not ready: no
 * night recorded, or no team registered yet (the current month, always).
 */
export async function readMonthFacts(env, period) {
  const [{ history, players, canonical }, awards, marks] = await Promise.all([
    readMonthArchive(env),
    readAwards(env),
    readAllMarks(env),
  ]);
  // Marks are stored under whatever id a night was filed with; read them the
  // way `/grades/all` serves them, so a promoted guest's marks are theirs.
  const canonicalMarks = {};
  for (const [fixtureId, rows] of Object.entries(marks)) {
    canonicalMarks[fixtureId] = remapPlayerKeys(rows, canonical);
  }
  const facts = monthFacts(history, period, players, canonicalMarks, awards[period] ?? null);
  if (!facts) return null;
  // Everybody who played that month: the only names whose Latin letters the
  // Hebrew check may pass. Kept beside the facts, never put in the prompt.
  const names = new Set();
  for (const fx of history) {
    if (fx.date.startsWith(`${period}-`)) for (const p of fx.players ?? []) names.add(p.name);
  }
  return { ...facts, names: [...names] };
}

// Straight after the persona's `role`, which every persona writes about one
// night. This is what turns any of them into the month's host without a month
// copy of each persona to keep in step.
export const MONTH_FRAME =
  'This time it is not one night. This is the END-OF-MONTH SPECIAL: a short radio show covering every מחזור of the month, read aloud and sent to the club as an audio file, and it ends with the Team of the Month. Stay exactly who you are, and host the month.';

const list = (items, empty) => (items.length ? items.map((s) => `- ${s}`).join('\n') : empty);

const ORDINAL_HE = ['הראשון', 'השני', 'השלישי', 'הרביעי', 'החמישי', 'השישי', 'השביעי', 'השמיני'];

export function buildMonthPrompt(facts, persona = 'default') {
  const p = PERSONAS[persona] ?? PERSONAS.default;
  const bylineNote = p.byline.includes('<')
    ? 'Invent the host. A different one every time, and an absurd one: an over-serious Hebrew sports-broadcaster name, or a ridiculous pun on one. Never a real journalist’s name, and never the name of anyone in the club.'
    : 'Use this byline exactly as written, on its own line, unchanged.';

  const nights = facts.nightsInOrder
    .map((n) => {
      const label = `NIGHT ${n.night} — say it as "המחזור ${ORDINAL_HE[n.night - 1] ?? n.night}"`;
      const winners = n.winners.length ? n.winners.map((w) => `  won it — ${w}`).join('\n') : '  nobody took it outright';
      const events = n.events.length
        ? n.events.map((e, i) => `  EVENT ${n.night}.${i + 1}: "${e}"`).join('\n')
        : '  no events written down';
      return `${label}\n${winners}\n${events}`;
    })
    .join('\n\n');

  // Best first, as registered. Numbered here so the countdown cannot be got
  // the wrong way round: the model is told the place, not left to infer it.
  const team = facts.team.map((line, i) => `PLACE ${i + 1}: ${line}`).join('\n');
  const countdown = [...facts.team.keys()].map((i) => facts.team.length - i).join(', ');

  return `${p.role}

${MONTH_FRAME}

WRITE IN HEBREW. Every word must be Hebrew, except player names, which are already Hebrew and must be copied exactly as given — never translated, transliterated or shortened. Not one word of any other language, not even for flavour: this script goes straight to a Hebrew voice, and a foreign word in it comes out as noise.

NEVER WRITE A DATE. No day, no year, no date in any form. The month may be named by its name alone — "חודש ${facts.month}" — and a night is named by its place in the month: "המחזור השני", never by when it was.

THE WORD FOR A CLUB NIGHT IS "מחזור" (plural "מחזורים"). Never "לילה", "לילות" or "ערב".

Call the teams by these Hebrew names: Black = השחורים, White = הלבנים, Blue = הכחולים.

HOW A NIGHT WORKS. Three teams of five share one pitch; the winner stays on. Penalties count as half a win, which is why some counts below end in .5 — say those as "וחצי".

THE SHIRTS ARE DRAWN FRESH EVERY WEEK. A colour is a team for one evening and nothing else, so no colour has a month, a form or a future. Only players carry anything from one night to the next.

WHAT YOU KNOW AND WHAT YOU DO NOT. Below is the complete record of the month. There are NO goals, NO scorers, NO assists and NO saves, because nobody records them. Invent none of them. Every number you use must appear below, unchanged.

THE MONTH — ${facts.month}
Nights played: ${facts.nights}
Match wins banked across the month: ${facts.matchWins}

NIGHT BY NIGHT
${nights}

THE MONTH'S LEADERS
${list(facts.leaders, '- none')}

THE MONTH'S AWARDS
${list(facts.awards, '- none')}

WHAT PLAYERS REACHED THIS MONTH
${list(facts.milestones, '- nothing was reached')}

TEAM OF THE MONTH — already chosen and already announced to the club on a gold shirt. Copy these five exactly, in exactly these places. Do not reorder them, do not swap anyone in or out, and do not work out a different team from the numbers.
${team}

THE EVENTS. Every EVENT line above is something that really happened, written down by the organiser on the night. They are the only part of this record the club cannot read off the app, so they are the best material you have. Pick the three or four best of them across the whole month and give each its own two or three sentences — build on it: a consequence, an accusation, a mock investigation, a callback later in the show. Say which night it was by its place in the month. Each event is separate, with its own owner: if an event names a player, it is theirs and you may go after them for it; if it names nobody, it belongs to nobody, and no player's name may be attached to it anywhere in the show. You saw it all yourself — never say anyone told you.

THE RUNNING ORDER. A byline, then these parts, about 350 to 420 words in all. Each part is its own paragraph, and the countdown is one paragraph per place.

Open with the byline on its own line:

${p.byline}

${bylineNote}

1. THE OPENING — about 50 words. What kind of month it was and who ran it.
2. THE EVENTS — about 110 words. Three or four, as above.
3. THE AWARDS CEREMONY — about 90 words. Hand out the best few awards from THE MONTH'S AWARDS and THE MONTH'S LEADERS as trophies, with mock gravity. Choose the ones with a story and leave the rest; a list of every award is a failed ceremony. An average mark is a result like any other: a low one is a month the scoreboard was unkind, never a verdict on the player.
4. TEAM OF THE MONTH, AS A COUNTDOWN — about 130 words. Places in this order: ${countdown}. One or two sentences for each, made from their own line above, and real build-up before place 1, who is announced last.
5. THE SIGN-OFF — one or two sentences, to named players about their own month. Next month's teams do not exist yet.

YOUR VOICE
${p.tone}

${TONE_GUARDRAILS}

FOR THIS SHOW. Wherever the rules above say "tonight", read "this month". Where they speak of five paragraphs, the running order above replaces it.

WRITTEN TO BE HEARD. This is read aloud by a voice and sent as an audio file, so write speech, not text: short sentences, no emoji, no parentheses, no slashes, no abbreviations, no lists. Nothing that only makes sense to the eye.

OUTPUT FORMAT. Put the finished script, and nothing else, between ${OPEN} and ${CLOSE}. Do not check your work inside those tags, and do not explain your choices. Anything outside the tags is discarded.

${OPEN}
(the byline and the show, in Hebrew)
${CLOSE}`;
}

/**
 * Ask Gemini for the month's show. `{ text, model }` or `{ error }` — never
 * throws, the same contract as `writeRecap`, and through the same refusals:
 * no tags, a foreign word or script, or a printed date, and it is not kept.
 */
export async function writeMonthRecap(env, facts, persona = 'default') {
  const said = await callGemini(env, buildMonthPrompt(facts, persona));
  if (said.error) return { error: said.error };
  const text = between(said.raw)?.normalize('NFC');
  if (!text) return { error: 'the model wrote its working out instead of a report' };
  const refused = refusalOf(text, { players: (facts.names ?? []).map((name) => ({ name })) });
  if (refused) return { error: refused };
  return { text, model: said.model };
}
