// The night reporter's voice (§2.69): a night's stored recap, read aloud by the
// voice server in voice/ (a Modal app), cached in KV, and handed to the
// organiser to share.
//
// Three parts, in the order a recap travels through them:
//
//   speakable()    the recap as written for the eye, rewritten for the ear —
//                  no emoji, no markdown, every number spelled out in Hebrew
//   provenance     only a recap Gemini wrote is ever voiced (see below)
//   RecapVoice     a Durable Object per night that runs the job on an alarm,
//                  because a cold GPU plus a three-minute recap is longer than
//                  anyone should hold a request open from a phone
//
// **Why provenance.** The voice server speaks in a real person's cloned voice,
// so what it is allowed to say is the whole safety story. `POST /recap` has
// always accepted `{ text }` — the organiser's approved draft — and the app
// only ever sends back exactly what Gemini wrote. But the route itself would
// store any 8000 characters at all, and anything stored would then be voiced.
// So the Worker now remembers a fingerprint of every draft it generates, and a
// stored recap is marked `source: 'gemini'` only if its text is one of them.
// Anything else is `'edited'`, and edited text is never sent to be spoken. The
// admin word can still write a recap by hand — it just cannot make the voice
// say it.

import { normalizePersona } from './recap.js';
import { calmExclamations, exclaimMode } from './delivery.js';
import { pronounce } from './pronunciations.js';
import { pointCount, sameLetters, vocalize } from './vocalize.js';

// Bump when speakable() or the voice server changes what a recap sounds like,
// so the cached audio for every night stops matching and is made again on
// request.
export const VOICE_VERSION = 4; // 2: the reference clip changed; 3: the engine did (VoxCPM2, §2.69.1); 4: the words go to it with niqqud (§2.71)

// How long a recording may take from the press of the button, all told. Three
// minutes of that is the voice, and the rest is waiting: Modal does not always
// have a GPU free, and a call has been seen to sit in its queue for thirteen
// minutes before it started (§2.69.2). A job that has not finished by now has
// not been slow, it has been lost.
export const JOB_TIMEOUT_MS = 30 * 60 * 1000;

// An alarm handler gets fifteen minutes of wall clock, so a job is not one
// alarm but as many as it takes: each one waits on the voice server for up to
// this long, then sets the next and goes, carrying on from the same call.
const SLICE_MS = 10 * 60 * 1000;

// Queueing a job. The endpoint itself is a small CPU container, up in seconds,
// so a few tries a little apart cover a cold start or a blip.
const START_TRIES = 3;
const START_RETRY_MS = 10 * 1000;

// Collecting it. Each poll asks the endpoint to wait up to 100 s for the result
// (Modal cuts a web request at 150), so a whole job is a handful of requests —
// well inside the free plan's 50 outbound requests per invocation, which a
// poll every few seconds for fourteen minutes would not be.
const POLL_WAIT_S = 100;
const MAX_POLLS = 12;
const POLL_RETRY_MS = 10 * 1000;

// A three-minute recap at 64 kbps is ~1.5 MB. Twenty is "something is wrong".
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

// How many draft fingerprints a night remembers, and for how long. A dozen
// drafts an hour is already the rate limit; a week is long enough for a draft
// read on Tuesday to be published on Thursday.
const MAX_DRAFTS = 20;
const DRAFT_TTL_S = 7 * 24 * 60 * 60;

export const voiceKey = (fixtureId) => `recapaudio:${fixtureId}`;
const draftsKey = (fixtureId) => `recapdrafts:${fixtureId}`;

export const voiceConfigured = (env) =>
  Boolean(env.VOICE_URL && env.MODAL_KEY && env.MODAL_SECRET);

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The fingerprint the cached audio is filed under: the words, and how they were made. */
export const voiceHash = (spoken, voice = 'default', pointed = true) =>
  sha256Hex(
    `v${VOICE_VERSION}${pointed ? '' : '-plain'}\n${voice === 'default' ? '' : `${voice}\n`}${spoken}`,
  );

/** Is the recording made with niqqud? On unless `VOICE_NIQQUD` is "off" (wrangler.toml). */
export const pointing = (env) => String(env?.VOICE_NIQQUD ?? 'on').toLowerCase() !== 'off';

/**
 * Whose voice reads this recap (§2.70.1). Always a persona key the Worker knows:
 * a recap stored before personas existed, or with one since removed, is read in
 * the default voice rather than refused.
 */
export const voiceFor = (stored) => normalizePersona(stored?.persona);

// --- Provenance -------------------------------------------------------------

// A draft is remembered as `{ hash, persona, vocalized? }`: the hash of the text
// the app shows, the persona that wrote it, and — when the report was written
// with niqqud (§2.71) — the pointed copy the voice will be sent. Lists written
// before this hold strings: a bare hash, or `hash:persona`.
const asEntry = (item) =>
  typeof item === 'object' && item !== null
    ? item
    : { hash: String(item).split(':')[0], persona: String(item).split(':')[1] };
const hashOf = (item) => asEntry(item).hash;

/** Remember that the reporter, as this persona, wrote this text for this night. */
export async function rememberDraft(env, fixtureId, text, persona = 'default', vocalized = null) {
  const hash = await sha256Hex(text);
  const known = await readDrafts(env, fixtureId);
  const entry = { hash, persona: normalizePersona(persona), ...(vocalized ? { vocalized } : {}) };
  const next = [...known.filter((h) => hashOf(h) !== hash), entry].slice(-MAX_DRAFTS);
  await env.ROSTER_KV.put(draftsKey(fixtureId), JSON.stringify(next), {
    expirationTtl: DRAFT_TTL_S,
  });
}

async function readDrafts(env, fixtureId) {
  try {
    const list = JSON.parse((await env.ROSTER_KV.get(draftsKey(fixtureId))) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Where this text came from: `{ source: 'gemini', persona, vocalized? }` if the
 * reporter wrote exactly this for this night, otherwise `{ source: 'edited' }`.
 *
 * The persona and the pointed copy come from the Worker's own record of the
 * draft, never from the client, so the voice a recap is read in, and the words
 * it is read from, can only be the ones its writer wrote.
 */
export async function provenanceOf(env, fixtureId, text) {
  const hash = await sha256Hex(text);
  const found = (await readDrafts(env, fixtureId)).find((item) => hashOf(item) === hash);
  if (found === undefined) return { source: 'edited' };
  const { persona, vocalized } = asEntry(found);
  return { source: 'gemini', persona: normalizePersona(persona), ...(vocalized ? { vocalized } : {}) };
}

/**
 * May this stored recap be voiced?
 *
 * A record with no `source` at all predates this file, and could only have
 * been written by the Worker as it was then — every write since carries one.
 * Those are the recaps already published to the group, so they stay voiceable
 * rather than every past night needing a re-roll first.
 */
export const canVoice = (stored) =>
  Boolean(stored?.text) && (stored.source === undefined || stored.source === 'gemini');

/**
 * The words a recording is made from, ready for the ear.
 *
 * The pointed copy the report was written with, if it has one and it is still
 * this recap's own words — checked, not assumed — and niqqud is on; otherwise
 * the plain text (which the voice job points itself, §2.71). Then the words the
 * voice mispronounces are respelled (`pronunciations.js`, §2.71.2) — in this
 * text only, never in the report. Last, a long sentence's "!" is softened to a
 * full stop (`delivery.js`, §2.73): the voice delivers the whole sentence as
 * excited as its ending.
 */
export function spokenFor(env, recap) {
  const pointed = pointing(env) && recap.vocalized && sameLetters(recap.text, recap.vocalized);
  return calmExclamations(
    pronounce(speakable(pointed ? recap.vocalized : recap.text)),
    exclaimMode(env),
  );
}

// --- speakable() ----------------------------------------------------------
//
// The recap is written to be read: a 📻 masthead, digits, "ב-10" and
// "ו-אריאל" with a hyphen gluing a prefix letter on. A TTS model reads all of
// that literally, or not at all — Chatterbox has no idea a digit has a gender
// in Hebrew, and phonikud adds vowels to letters, not to "13". So the numbers
// are spelled out here, with the gender taken from the noun after them.

const UNITS_F = ['אפס', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'];
const UNITS_M = ['אפס', 'אחד', 'שניים', 'שלושה', 'ארבעה', 'חמישה', 'שישה', 'שבעה', 'שמונה', 'תשעה'];
const TEENS_F = ['עשר', 'אחת עשרה', 'שתים עשרה', 'שלוש עשרה', 'ארבע עשרה', 'חמש עשרה', 'שש עשרה', 'שבע עשרה', 'שמונה עשרה', 'תשע עשרה'];
const TEENS_M = ['עשרה', 'אחד עשר', 'שנים עשר', 'שלושה עשר', 'ארבעה עשר', 'חמישה עשר', 'שישה עשר', 'שבעה עשר', 'שמונה עשר', 'תשעה עשר'];
const TENS = ['', '', 'עשרים', 'שלושים', 'ארבעים', 'חמישים', 'שישים', 'שבעים', 'שמונים', 'תשעים'];
const HUNDREDS = ['', 'מאה', 'מאתיים', 'שלוש מאות', 'ארבע מאות', 'חמש מאות', 'שש מאות', 'שבע מאות', 'שמונה מאות', 'תשע מאות'];
const THOUSANDS = ['', 'אלף', 'אלפיים', 'שלושת אלפים', 'ארבעת אלפים', 'חמשת אלפים', 'ששת אלפים', 'שבעת אלפים', 'שמונת אלפים', 'תשעת אלפים'];
// "the four nights" — ארבעת המחזורים, not ארבעה המחזורים
const DEFINITE_M = ['', '', 'שני', 'שלושת', 'ארבעת', 'חמשת', 'ששת', 'שבעת', 'שמונת', 'תשעת', 'עשרת'];
const DEFINITE_F = ['', '', 'שתי', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע', 'עשר'];
// "the 10th night" — המחזור העשירי. Past ten Hebrew uses the cardinal.
const ORDINALS = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי', 'עשירי'];

// The nouns a match report counts. Plural endings decide the rest (ים is
// masculine, ות feminine), which is why ניצחונות and שבועות — masculine
// despite the ending — have to be listed.
const MASCULINE = new Set([
  'ניצחון', 'ניצחונות', 'נצחון', 'נצחונות', 'משחק', 'משחקים', 'מחזור', 'מחזורים',
  'שער', 'שערים', 'גול', 'גולים', 'שחקן', 'שחקנים', 'שבוע', 'שבועות', 'יום', 'ימים',
  'הפסד', 'הפסדים', 'חודש', 'חודשים', 'פנדל', 'פנדלים', 'קול', 'קולות', 'אחוז',
  'אחוזים', 'רצף', 'רצפים', 'ערב', 'ערבים', 'מפגש', 'מפגשים', 'אורח', 'אורחים',
]);
const FEMININE = new Set([
  'נקודה', 'נקודות', 'פעם', 'פעמים', 'דקה', 'דקות', 'שעה', 'שעות', 'קבוצה', 'קבוצות',
  'שנה', 'שנים', 'הופעה', 'הופעות', 'בחירה', 'בחירות', 'עונה', 'עונות', 'שנייה',
  'שניות', 'הצבעה', 'הצבעות', 'הכרעה', 'הכרעות', 'תבוסה', 'תבוסות',
]);

const listed = (w) => (MASCULINE.has(w) ? true : FEMININE.has(w) ? false : null);

/** true for a masculine noun, false for feminine, null when it is not a noun we can read. */
function genderOf(word) {
  if (!word) return null;
  const known = listed(word) ?? (word.startsWith('ה') ? listed(word.slice(1)) : null);
  if (known !== null) return known;
  if (/[א-ת]ים$/.test(word)) return true;
  if (/[א-ת]ות$/.test(word)) return false;
  return null;
}

// "המחזורים" is "the nights"; "הפסדים" is just "losses". Only a listed noun
// behind the ה counts as definite — guessing would turn "3 הפסדים" into
// "שלושת הפסדים".
const isDefinite = (word) =>
  word.startsWith('ה') && listed(word) === null && listed(word.slice(1)) !== null;

// The letters Hebrew glues onto the front of a word — ו, ה, ב, כ, ל, מ, ש and
// their usual stacks. Checked as a whole, because the same letters also spell
// short words that a hyphen joins to the next one: כל-כך is not כ+ל+כך, and
// של-50 is "of fifty", not a prefix.
const PREFIX = /^(?:[ובכלמשה]|ו[הבכלמש]|ש[הבכמ]|כש|וכש|וש[הבכמ])$/;

// One Hebrew letter's vowel points and cantillation, as a pattern for the rules below.
const POINT = '[\\u0591-\\u05BD\\u05BF\\u05C1\\u05C2\\u05C4\\u05C5\\u05C7]';
const POINTS = `${POINT}*`;

const needsVav = (n) => n < 20 || (n < 100 && n % 10 === 0) || n % 100 === 0;

function below100(n, masc) {
  if (n < 10) return (masc ? UNITS_M : UNITS_F)[n];
  if (n < 20) return (masc ? TEENS_M : TEENS_F)[n - 10];
  const unit = n % 10;
  const tens = TENS[Math.floor(n / 10)];
  return unit ? `${tens} ו${(masc ? UNITS_M : UNITS_F)[unit]}` : tens;
}

function below1000(n, masc) {
  if (n < 100) return below100(n, masc);
  const rest = n % 100;
  const hundreds = HUNDREDS[Math.floor(n / 100)];
  if (!rest) return hundreds;
  return `${hundreds} ${needsVav(rest) ? 'ו' : ''}${below100(rest, masc)}`;
}

/**
 * A whole number as Hebrew words, 0–9999; null past that (left as digits).
 *
 * `masc` is the gender of whatever is being counted. With nothing being
 * counted — a score, "לעומת 0" — Hebrew counts in the feminine, so that is the
 * default.
 */
export function hebrewNumber(n, masc = false) {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return null;
  if (n < 1000) return below1000(n, masc);
  const rest = n % 1000;
  const thousands = THOUSANDS[Math.floor(n / 1000)];
  if (!rest) return thousands;
  return `${thousands} ${needsVav(rest) ? 'ו' : ''}${below1000(rest, masc)}`;
}

// A number, the prefix letters glued to it (ב-10, מ־4, ה10), an optional
// decimal or percent, and the word after it — which is what decides the gender.
const NUMBER = /(^|[^\p{L}\p{N}])((?:[ובכלמשה]{1,3})?[-־]?)(\d+)(?:\.(\d+))?(\s*%)?(?=(\s+([^\s]+))?)/gu;

function spellNumber(prefix, digits, decimals, percent, nextWord) {
  const n = Number(digits);
  const typed = prefix.replace(/[-־]/g, '');
  // a short word rather than a prefix stays a word of its own: "של חמישים"
  const letters = !typed || PREFIX.test(typed) ? typed : `${typed} `;
  const next = nextWord?.replace(/[^\p{L}]/gu, '') ?? '';
  const nounGender = percent ? true : genderOf(next);
  const masc = nounGender ?? false;

  const whole = hebrewNumber(n, masc);
  if (whole === null) return `${prefix}${digits}${decimals ? `.${decimals}` : ''}${percent ?? ''}`;

  // ה-10 with no noun after it: "the tenth", as in המחזור ה-10. Masculine,
  // because the nouns a recap numbers this way — מחזור, ניצחון, משחק — are.
  if (typed.endsWith('ה') && nounGender === null && !decimals && n >= 1 && n <= 10) {
    return `${letters}${ORDINALS[n]}`;
  }

  let words = whole;
  if (decimals === '5') words = `${whole} וחצי`;
  else if (decimals) words = `${whole} נקודה ${hebrewNumber(Number(decimals)) ?? decimals}`;
  else if (!percent && nounGender !== null && n >= 2 && n <= 10 && isDefinite(next))
    words = (nounGender ? DEFINITE_M : DEFINITE_F)[n];
  else if (!percent && nounGender !== null && n === 2) words = nounGender ? 'שני' : 'שתי';

  return `${letters}${words}${percent ? ' אחוז' : ''}`;
}

// Pictographs, flags, skin tones, keycaps and the joiners between them.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu;

/**
 * A recap rewritten for the ear.
 *
 * Paragraphs stay on their own lines — the voice server pauses longer between
 * paragraphs than between sentences — and every line ends in punctuation, so
 * the masthead ("ארבל זעזוע מדווח מהמגרש") is a sentence of its own rather
 * than run into the first line of the report.
 */
export function speakable(text) {
  let out = String(text ?? '')
    .normalize('NFC')
    .replace(EMOJI, '')
    // direction marks: invisible on screen, and nothing a voice can say
    .replace(/[‎‏‪-‮⁦-⁩]/g, '');

  // Markdown the model may have reached for despite being asked not to.
  out = out
    .replace(/\*\*|__|[*`]/g, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-•–]\s+/gm, '')
    .replace(/_/g, ' ');

  // Pointed text (§2.71): a prefix letter glued on with a hyphen carries its own
  // points ("וְ-אריאל"), which would stop the rules below seeing it as a prefix.
  // Its vowel is the same as without the hyphen, so the points come off.
  out = out.replace(
    new RegExp(`(^|[^\\p{L}\\p{M}])((?:[ובכלמשה]${POINTS}){1,3})(?=[-־])`, 'gu'),
    (_, lead, letters) => `${lead}${letters.replace(new RegExp(POINT, 'gu'), '')}`,
  );

  // 1,000 → 1000, before anything reads the comma as a pause.
  out = out.replace(/(\d)[,٬](?=\d{3}\b)/g, '$1');

  // A score or a range: 4-0, 3:1. Read as two counts, as a commentator would.
  out = out.replace(/(\d+)\s*[-–—:]\s*(\d+)/g, (_, a, b) => {
    const x = hebrewNumber(Number(a));
    const y = hebrewNumber(Number(b));
    return x && y ? `${x} ${y}` : `${a} ${b}`;
  });

  out = out.replace(NUMBER, (_, lead, prefix, digits, decimals, percent, _ws, nextWord) =>
    `${lead}${spellNumber(prefix, digits, decimals, percent, nextWord)}`,
  );

  // ו-אריאל → ואריאל: the hyphen only kept a name's first letter visible.
  // כל-כך is two words that happen to start with prefix letters; it falls
  // through to the next rule and becomes "כל כך".
  out = out.replace(/(^|[^\p{L}\p{M}])([ובכלמשה]{1,3})[-־](?=\p{L})/gu, (all, lead, letters) =>
    PREFIX.test(letters) ? `${lead}${letters}` : all,
  );
  // דו-קרב, מורט־עצבים — two words, said as two words.
  out = out.replace(/(\p{L}\p{M}*)[-־](?=\p{L})/gu, '$1 ');

  out = out
    .replace(/[()[\]{}]/g, ', ')
    .replace(/[“”„«»]/g, '')
    .replace(/\s+"|"\s+|^"|"$/gm, ' ') // a quotation mark, not the gershayim in פיפ"א
    .replace(/\//g, ' ')
    .replace(/&/g, ' ו')
    .replace(/([!?])\1+/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.!?])/g, '$1')
    .replace(/,(\s*,)+/g, ',');

  return out
    .split('\n')
    .map((line) => line.trim().replace(/^[,.\s]+/, ''))
    .filter((line) => /\p{L}/u.test(line))
    .map((line) => (/[.!?]$/.test(line) ? line : `${line.replace(/,$/, '')}.`))
    .join('\n');
}

// --- The voice server -------------------------------------------------------
//
// Two calls, which is Modal's own pattern for a long job: POST queues it and
// answers at once with an id; GET on that id answers with the MP3 once it
// exists, waiting up to `wait` seconds first, or 202 if it is still running.
// Every request carries a Modal proxy-auth token. Without one Modal's edge
// answers 401 before any container starts, so the endpoint is not something a
// stranger can call, or spend the GPU credits through.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const voiceUrl = (env, path) => `${String(env.VOICE_URL).replace(/\/+$/, '')}${path}`;
const auth = (env) => ({ 'Modal-Key': env.MODAL_KEY, 'Modal-Secret': env.MODAL_SECRET });

const refusedToken = (res) => res?.status === 401 || res?.status === 403;

/** Queue the words, to be read in `voice`; the job's id. A refused token or refused text is final. */
export async function startJob(env, text, { wait = sleep, voice = 'default' } = {}) {
  for (let tries = 1; ; tries++) {
    let res = null;
    try {
      res = await fetch(voiceUrl(env, '/jobs'), {
        method: 'POST',
        headers: { ...auth(env), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      });
    } catch {
      // a dropped connection is worth another try
    }
    if (refusedToken(res)) throw new Error(`voice server refused the token (${res.status})`);
    if (res?.status === 400) throw new Error('voice server refused the text');
    if (res?.ok) {
      const body = await res.json().catch(() => null);
      if (typeof body?.call_id === 'string') return body.call_id;
    }
    if (tries >= START_TRIES) {
      throw new Error(`voice server unreachable${res ? ` (${res.status})` : ''}`);
    }
    await wait(START_RETRY_MS);
  }
}

/** The job is still going: not a failure, just not finished by the time this one stopped waiting. */
export class StillWorking extends Error {}

/**
 * Wait for the job and return its MP3, or throw `StillWorking` when `deadline`
 * comes first. `onPhase` hears "queued" while the call is waiting for a GPU and
 * "running" once it has one.
 */
export async function collectJob(
  env,
  callId,
  { deadline, wait = sleep, now = Date.now, onPhase } = {},
) {
  for (let polls = 1; ; polls++) {
    const left = Math.floor((deadline - now()) / 1000);
    if (left <= 5 || polls > MAX_POLLS) throw new StillWorking('voice job did not finish in time');
    const waitS = Math.min(POLL_WAIT_S, left - 5);

    let res = null;
    try {
      res = await fetch(voiceUrl(env, `/jobs/${encodeURIComponent(callId)}?wait=${waitS}`), {
        headers: auth(env),
        signal: AbortSignal.timeout((waitS + 30) * 1000),
      });
    } catch {
      // a dropped poll loses nothing — the job runs on regardless
    }
    if (refusedToken(res)) throw new Error(`voice server refused the token (${res.status})`);
    if (res?.status === 202) {
      const still = await res.json().catch(() => null);
      if (typeof still?.phase === 'string') await onPhase?.(still.phase);
      continue;
    }
    if (res?.ok) {
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) {
        throw new Error(`voice server sent ${bytes.byteLength} bytes`);
      }
      return bytes;
    }
    if (res) {
      const said = await res.json().catch(() => ({}));
      throw new Error(`voice job failed: ${said.error ?? res.status}`);
    }
    await wait(POLL_RETRY_MS);
  }
}

// --- The job --------------------------------------------------------------

const view = (job) =>
  job
    ? {
        status: job.status,
        hash: job.hash,
        startedAt: job.startedAt,
        ...(job.pointed === undefined ? {} : { pointed: job.pointed }),
        ...(job.pointNote ? { pointNote: job.pointNote } : {}),
        // while it runs: is it waiting for a GPU, or on one?
        ...(job.status === 'working' && job.phase ? { phase: job.phase } : {}),
        ...(job.error ? { error: job.error } : {}),
      }
    : null;

/**
 * Durable Object: one night's voice job. `idFromName(fixtureId)`.
 *
 *   POST /start  { fixtureId, text, hash, voice }   begin, unless one is running
 *   GET  /status                             { status, hash, startedAt, error? }
 *   GET  /sent                               { sent, hash } — what the voice server was sent (TEMPORARY, §2.71)
 *
 * The work happens in `alarm()`, set for "now" by /start. That is what lets
 * the request that asked for it return in milliseconds: the phone polls the
 * public status route while this runs, and a phone that locks its screen
 * half-way through loses nothing. A running job is never doubled — a second
 * /start while one is in flight is answered with the one in flight.
 */
export class RecapVoice {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async job() {
    return (await this.state.storage.get('job')) ?? null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/status') return Response.json(view(await this.job()));

    // TEMPORARY (§2.71): the exact text the voice server was last sent, so the
    // organiser can see whether it was pointed. Remove with the `sent` route in
    // roster-worker.js and RecapVoice's "text sent" button once pointing is trusted.
    if (url.pathname === '/sent') {
      return Response.json({
        sent: (await this.state.storage.get('sent')) ?? null,
        // what the model answered, kept only when it was not (all) used
        raw: (await this.state.storage.get('sentRaw')) ?? null,
        hash: (await this.job())?.hash ?? null,
      });
    }

    if (url.pathname === '/start' && request.method === 'POST') {
      const { fixtureId, text, hash, voice } = await request.json();
      const current = await this.job();
      if (current?.status === 'working' && Date.now() - current.startedAt < JOB_TIMEOUT_MS) {
        return Response.json(view(current));
      }
      const job = { status: 'working', fixtureId, hash, startedAt: Date.now() };
      await this.state.storage.put('job', job);
      await this.state.storage.put('text', text);
      await this.state.storage.put('voice', normalizePersona(voice));
      await this.state.storage.delete('callId');
      await this.state.storage.setAlarm(Date.now());
      return Response.json(view(job));
    }

    return new Response('not found', { status: 404 });
  }

  /** Save `change` onto the job record, unless a newer job has taken its place. */
  async update(startedAt, change) {
    const current = await this.job();
    if (current?.startedAt !== startedAt) return null;
    const next = { ...current, ...change };
    await this.state.storage.put('job', next);
    return next;
  }

  // Never throws. A throwing alarm is retried by the runtime, and a retry here
  // would be another few minutes of somebody's daily GPU allowance spent on a
  // job that already failed once — the organiser can press the button again.
  //
  // A job takes as many alarms as it needs. The first points the text, starts
  // the call on the voice server and keeps its id; each one waits on that call
  // for up to SLICE_MS and, if it is not done, sets the next alarm and ends
  // without finishing the job — so the wait is not bounded by one alarm's fifteen
  // minutes, and a call stuck in Modal's queue is waited for, not abandoned.
  async alarm() {
    const job = await this.job();
    if (!job || job.status !== 'working') return;
    const store = this.state.storage;
    const deadline = job.startedAt + JOB_TIMEOUT_MS;

    try {
      let callId = await store.get('callId');
      if (!callId) {
        const text = await store.get('text');
        if (!text) return;
        const voice = (await store.get('voice')) ?? 'default';

        // Vowel points are for the voice's benefit only (§2.71). If they can't be
        // added, or come back with different letters, the recording is made from
        // the text as it stands — worse at names, never wrong in what it says.
        const vocal =
          pointCount(text) > 0
            ? { text, pointed: true, ok: 1, of: 1 } // written pointed, so there is nothing to ask
            : pointing(this.env)
              ? await vocalize(this.env, text)
              : { text, pointed: false, reason: 'switched off' };
        if (!vocal.pointed) {
          console.log(JSON.stringify({ voice: 'unpointed', fixtureId: job.fixtureId, reason: vocal.reason }));
        }
        // kept as soon as it is decided, so even a job that then fails or times out
        // can be asked what it was given (TEMPORARY, see /sent)
        await store.put('sent', vocal.text);
        if (vocal.raw && (!vocal.pointed || vocal.ok < vocal.of)) {
          await store.put('sentRaw', vocal.raw);
        } else {
          await store.delete('sentRaw');
        }

        callId = await startJob(this.env, vocal.text, { voice });
        await store.put('callId', callId);
        // Why a recording is not (fully) pointed, kept where the status can show it:
        // the Worker's log is gone by the time anybody asks.
        const pointNote = !vocal.pointed
          ? vocal.reason
          : vocal.ok < vocal.of
            ? `${vocal.ok} of ${vocal.of} lines`
            : undefined;
        await this.update(job.startedAt, { pointed: vocal.pointed, pointNote, phase: 'queued' });
      }

      const audio = await collectJob(this.env, callId, {
        deadline: Math.min(deadline, Date.now() + SLICE_MS),
        onPhase: async (phase) => {
          if ((await this.job())?.phase !== phase) await this.update(job.startedAt, { phase });
        },
      });
      await this.env.ROSTER_KV.put(voiceKey(job.fixtureId), audio, {
        metadata: { hash: job.hash, at: Date.now() },
      });
      await this.update(job.startedAt, { status: 'ready', finishedAt: Date.now() });
    } catch (err) {
      // not a failure: the call is still going and there is time left to wait for it
      if (err instanceof StillWorking && Date.now() < deadline - 10_000) {
        await store.setAlarm(Date.now() + 1000);
        return;
      }
      const minutes = Math.round((Date.now() - job.startedAt) / 60000);
      const phase = (await this.job())?.phase;
      const why =
        err instanceof StillWorking
          ? `no recording after ${minutes} minutes (${phase === 'running' ? 'still recording' : 'never got a GPU'})`
          : String(err?.message ?? err).slice(0, 300);
      await this.update(job.startedAt, { status: 'failed', finishedAt: Date.now(), error: why });
      console.log(JSON.stringify({ voice: 'failed', fixtureId: job.fixtureId, error: why }));
    }

    // done with it, one way or the other: the text and the call are of no more use
    if ((await this.job())?.status !== 'working') {
      await store.delete('text');
      await store.delete('voice');
      await store.delete('callId');
    }
  }
}
