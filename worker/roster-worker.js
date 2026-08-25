// Cloudflare Worker: the shared Armonim roster + results history, plus live
// match-day rooms (see match-room.js).
//
//   GET  /roster       → public read of the current roster, private fields stripped
//   POST /roster       → publish a new roster; requires the secret word
//   POST /roster/full  → read the roster *including* private fields; same word
//   GET  /history      → public read of recorded fixtures (nights + win tallies)
//   POST /history      → publish the fixture list; requires the secret word
//   GET  /live         → public read of the fixture being played right now
//   POST /live         → start/update/end it; requires the secret word
//   POST /live/clock   → start/pause the match clock; NO password, see below
//   POST /live/log     → write down a finished match; NO password, see below
//   GET  /push/key     → the VAPID public key a browser needs to subscribe
//   POST /push/subscribe   → opt this device into match-clock notifications
//   POST /push/unsubscribe → opt it out again
//   POST /push/test        → buzz now and report what the push service said
//   POST /history/full → the organiser's read, ratings included; needs the word
//   GET  /awards       → public read of every registered Team of the Month
//   POST /awards       → register or correct one; requires the secret word
//   GET  /values       → public read of every player's market value (price only)
//   GET  /recap?id=…   → public read of a night's written recap, if there is one
//   POST /recap        → write one for a night; requires the secret word
//   GET  /grades?id=…  → public read of a night's one-line player grades
//   POST /grades       → write them for a night; requires the secret word
//   POST /verify       → check the secret word (used to unlock admin mode)
//   GET  /room/:id     → WebSocket upgrade into a live team-picking room
//
// /history is a full-list replace, same as /roster — the client sends its
// whole local history and that becomes the shared copy — rather than
// per-fixture endpoints. Simpler, consistent with how /roster already works,
// and a season's worth of fixtures is a few dozen KB, well inside a KV value.
//
// Every write is gated on the secret word, and every request that can cost us
// something — the three POSTs and the room upgrade alike — passes an atomic
// per-IP counter first (see rate-limit.js).
//
// Setup lives in worker/README.md. In short: bind a KV namespace as ROSTER_KV,
// add a PUBLISH_SECRET secret, and bind the MatchRoom and RateLimiter
// Durable Objects.

export { MatchRoom } from './match-room.js';
export { RateLimiter } from './rate-limit.js';
export { ClockNotifier } from './clock-notifier.js';

import { bytesToB64u, publicKeyBytes } from './push.js';
import { isValidFacts, recapKey, writeRecap } from './recap.js';
import { gradesKey, isValidGradeFacts, writeGrades } from './grades.js';
import { announceMonth, clearMonth, isPeriod, readAwards, registerAwards } from './awards.js';
// Bundled from src/ the same way src/totm.ts is, and for the same reason: the
// formula has to exist in exactly one place, and this is the only place that
// can run it — a public device has no ratings to run it on (§2.31).
import { marketValues } from '../src/marketValue.ts';

// One object for the whole club — there is only ever one night on. It holds
// the live fixture, who wants telling about the clock, and the alarm that does
// the telling. Those used to be a KV key plus two best-effort side calls; they
// are one object now because they were always one thing, and because a clock
// stored in KV was being read stale (§2.15).
const notifier = (env) => env.CLOCK_NOTIFIER.get(env.CLOCK_NOTIFIER.idFromName('clock'));

// Deliberately open: GET /roster is meant to be readable by anyone with the
// app, and the POSTs are gated on the secret word rather than on origin — a
// CORS rule would only inconvenience browsers, never a scripted attacker, and
// would break `npm run dev` against the deployed worker. Safe specifically
// because nothing here authenticates with a cookie: there is no ambient
// authority for another origin to ride on, so CSRF does not apply.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders },
  });

// A roster is a few dozen players; anything far past that is not a roster.
const MAX_PLAYERS = 200;

// A fixture is one night; a few years of weekly football is still well under
// this. A team's roster for one night is capped much lower than MAX_PLAYERS —
// nobody fields 200 players in one match.
const MAX_FIXTURES = 1000;
const MAX_FIXTURE_PLAYERS = 60;
// Matches logged in one night. Two hours of 8-minute matches is about fifteen;
// this leaves room for a long night and a few corrections without letting an
// unbounded array into a record every device in the club downloads.
const MAX_MATCHES = 100;
const MAX_ALIASES = 20;
const MAX_NAME_CHARS = 60;
const MAX_ID_CHARS = 64;
const MAX_DATE_CHARS = 20;
// The organiser's free-text note on a fixture. Generous against the app's own
// 280, because a record filed by an older or newer build should not be the
// thing that makes an entire season's publish bounce.
const MAX_NOTE_CHARS = 400;
// One player's grade line. The prompt asks for 120 characters and `grades.js`
// truncates a generated one at 300; this is the ceiling on a *hand-edited* one,
// left roomier because a person rewriting a joke they did not like should not
// be fighting a limit set for a model that ignored its brief.
const MAX_GRADE_LINE_CHARS = 400;
const TEAM_COLORS = ['black', 'white', 'blue'];

// Whatever a publish stores here is served back to every device in the club,
// so the ceiling on one is the ceiling on all of them. A full season of
// fixtures is a few dozen KB; half a megabyte is generous and still bounded.
const MAX_BODY_BYTES = 512 * 1024;

// Wrong-word budget per IP. Correct words are refunded, so an admin
// publishing all evening never approaches it.
const PUBLISH_LIMIT = 10;
const PUBLISH_WINDOW_MS = 10 * 60 * 1000;

// Drafts per IP, and the one budget in this file that a *correct* word cannot
// get back.
//
// Every other guarded write costs us a KV put, which is ours, cheap, and
// idempotent — so refunding a right answer is exactly right there. Writing a
// report is not that: it is up to three calls on the club's Gemini key against
// a free tier with a daily cap, so a word that leaked would be an unlimited
// supply of somebody else's tokens, and the first anyone would know of it is
// the reporter being dead for everyone.
//
// A dozen an hour is set by what the act actually looks like: one report a
// week, rerolled two or three times when the first one comes back flat. Nobody
// writing a report for a real night gets near this, which is the whole test of
// a limit — it has to be invisible to the person it is not aimed at.
const RECAP_LIMIT = 12;
const RECAP_WINDOW_MS = 60 * 60 * 1000;

// The same budget, on its own counter, for the grades (§2.39).
//
// Its own rather than shared with the recap: they are two different acts on the
// same night, an organiser will reasonably do both, and one counter would mean
// re-rolling a report until it reads well silently spending the grades that
// have not been written yet. Same size because the shape of the act is the same
// — one a week, rerolled a few times when the banter lands flat.
const GRADES_LIMIT = 12;
const GRADES_WINDOW_MS = 60 * 60 * 1000;

// Room upgrades are unauthenticated by design — the share link is the
// invitation — so the only thing standing between a script and an unbounded
// number of Durable Objects is this. Set well above what a real match night
// needs (fifteen people, plus reconnects, often behind one NAT).
const ROOM_LIMIT = 120;
const ROOM_WINDOW_MS = 10 * 60 * 1000;

// Clock presses, which anyone at the pitch can make (see /live/clock). A match
// is start, maybe a pause, then next-match — call it a handful each, times
// however many people are prodding it, on one pitch behind one NAT.
const CLOCK_LIMIT = 200;
const CLOCK_WINDOW_MS = 10 * 60 * 1000;

// How long the copy displaced by a publish is kept around. Long enough that a
// bad write discovered weeks later is still recoverable.
const SNAPSHOT_TTL_S = 90 * 24 * 60 * 60;

const ROOM_PATH = /^\/room\/([A-Za-z0-9_-]{1,64})$/;

// --- The privacy line ------------------------------------------------------
// These five never leave the organiser's device through the *public* read.
// `avoid` is the keep-apart list — who won't play with whom — which the app
// already treats as admin-only everywhere it is rendered (Roster's per-player
// note, TeamsBoard's `showPrivateNotes`) and which match-room.js goes out of
// its way to strip before a room reaches a guest's phone. Serving it from an
// unauthenticated GET undid all of that. `chemistry` is the same kind of
// statement about people, and `aliases` are nicknames that only ever fed the
// admin-side import matcher.
//
// `rating` and `attack` were the two that stayed behind, and they should not
// have. The whole design rule (§2.9) is that a rating is the organiser's
// private opinion of somebody and never leaves the app — the fixture page
// hides team averages from a non-admin, `LivePlayer` was typed down to a name
// and a shirt precisely so ratings never travelled to the group, and
// `recapFacts` has a test asserting no rating reaches Gemini. All of that was
// true of every screen, and none of it was true of `GET /roster`, which is
// unauthenticated and whose URL ships in the public bundle. One `curl` read
// every player's 1–5 out of a feature everyone was careful about everywhere
// else.
//
// They are still *stored*, so an organiser setting up a new device gets them
// back — via POST /roster/full, which costs the secret word.
const PRIVATE_PLAYER_FIELDS = ['avoid', 'chemistry', 'aliases', 'rating', 'attack'];

export function publicPlayer(p) {
  const clean = { ...p };
  for (const field of PRIVATE_PLAYER_FIELDS) delete clean[field];
  return clean;
}

/**
 * The same line, drawn across a filed night.
 *
 * A `FixturePlayer` is a snapshot — id, name and *the rating they had that
 * evening* — which made the whole archive a second, staler copy of exactly the
 * thing the roster read had just stopped handing out. Every night anybody has
 * ever played, with a number against their name, on an endpoint with no
 * password.
 *
 * Only the *read* is stripped. The ratings stay in KV, because they are a
 * record of what the teams were built from and an organiser rebuilding a
 * device needs them back — which is what POST /history/full is for, and why
 * that endpoint had to exist before this one could be safe. A device that
 * adopted the stripped copy and then filed a night would publish the whole
 * list back with the ratings gone for good.
 */
export const publicFixture = (fx) => ({
  ...fx,
  players: fx.players.map(({ rating, ...rest }) => rest),
});

export const publicHistory = (value) =>
  value && Array.isArray(value.fixtures)
    ? { ...value, fixtures: value.fixtures.map(publicFixture) }
    : value;

// --- Validation ------------------------------------------------------------
// Everything below is republished verbatim to every device in the club, which
// makes shape-checking a durability concern as much as a security one: a
// client drops the fetched result straight into React state, so one malformed
// publish is a white screen for everyone until someone republishes. The old
// checks tested `p?.id && p?.name` — truthiness, which an object or a
// megabyte-long string passes just as happily as a name.

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

const isIdList = (v, max) =>
  Array.isArray(v) && v.length <= max && v.every((id) => isStr(id, MAX_ID_CHARS));

const isOptNum = (v) => v === undefined || Number.isFinite(v);

export function isValidPlayers(players) {
  if (!Array.isArray(players) || players.length > MAX_PLAYERS) return false;
  return players.every((p) => {
    if (!p || typeof p !== 'object') return false;
    if (!isStr(p.id, MAX_ID_CHARS) || !isStr(p.name, MAX_NAME_CHARS)) return false;
    if (!isOptNum(p.rating) || !isOptNum(p.attack) || !isOptNum(p.number)) return false;
    if (p.invitedBy !== undefined && !isStr(p.invitedBy, MAX_ID_CHARS)) return false;
    if (p.chemistry !== undefined && !isIdList(p.chemistry, MAX_PLAYERS)) return false;
    if (p.avoid !== undefined && !isIdList(p.avoid, MAX_PLAYERS)) return false;
    if (p.aliases !== undefined) {
      if (!Array.isArray(p.aliases) || p.aliases.length > MAX_ALIASES) return false;
      if (!p.aliases.every((a) => isStr(a, MAX_NAME_CHARS))) return false;
    }
    return true;
  });
}

// The fixture currently being played (§2.14). Unlike the roster and the
// history this is *transient* — one key, overwritten while a night is on and
// deleted when it ends — so there's no version guard and no snapshot: there is
// nothing here worth recovering an hour later. It does carry a TTL, because
// the failure mode is an organiser closing the tab mid-night and leaving a
// fixture that looks live forever.
// A PushSubscription as the browser hands it over. The endpoint is a URL we
// will POST to, so it is checked to be one — and to be https, since a push
// service that isn't is not a push service.
export function isValidSubscription(sub) {
  if (!sub || typeof sub !== 'object') return false;
  if (!isStr(sub.endpoint, 1024)) return false;
  try {
    if (new URL(sub.endpoint).protocol !== 'https:') return false;
  } catch {
    return false;
  }
  if (!sub.keys || typeof sub.keys !== 'object') return false;
  // p256dh is a 65-byte point and auth is 16 bytes, both base64url
  if (!isStr(sub.keys.p256dh, 128) || !isStr(sub.keys.auth, 64)) return false;
  return true;
}

export function isValidClock(clock) {
  if (!clock || typeof clock !== 'object') return false;
  if (clock.period !== 'regulation' && clock.period !== 'added') return false;
  if (clock.endsAt !== null && !Number.isFinite(clock.endsAt)) return false;
  if (!Number.isFinite(clock.remaining)) return false;
  if (typeof clock.ended !== 'boolean') return false;
  return true;
}

export function isValidLive(live) {
  if (live === null) return true; // clearing it
  if (!live || typeof live !== 'object') return false;
  if (!isStr(live.id, MAX_ID_CHARS)) return false;
  if (!Number.isFinite(live.startedAt)) return false;
  if (!Array.isArray(live.players) || live.players.length > MAX_FIXTURE_PLAYERS) return false;
  if (
    !live.players.every(
      (p) => p && typeof p === 'object' && isStr(p.id, MAX_ID_CHARS) && isStr(p.name, MAX_NAME_CHARS),
    )
  ) {
    return false;
  }
  if (!live.teams || typeof live.teams !== 'object') return false;
  if (!TEAM_COLORS.every((c) => isIdList(live.teams[c], MAX_FIXTURE_PLAYERS))) return false;
  if (!isIdList(live.gkIds, MAX_FIXTURE_PLAYERS)) return false;
  if (!isValidClock(live.clock)) return false;
  if (live.matchLog !== undefined && !isValidMatchLog(live.matchLog)) return false;
  return true;
}

// A night's match log, when it has one. Validated rather than waved through
// because this is the field statistics are going to be computed from — a
// head-to-head between two shirts is only as trustworthy as the rows it counts,
// and a row naming a winner who wasn't playing would poison it silently rather
// than fail loudly. The client can't produce one (recordMatch refuses), so
// anything that fails here didn't come from the app.
export function isValidMatchLog(log) {
  if (!Array.isArray(log) || log.length > MAX_MATCHES) return false;
  return log.every((m) => {
    if (!m || typeof m !== 'object') return false;
    if (!TEAM_COLORS.includes(m.a) || !TEAM_COLORS.includes(m.b)) return false;
    if (m.a === m.b) return false; // a team cannot play itself
    if (m.winner !== m.a && m.winner !== m.b) return false;
    if (typeof m.viaPenalties !== 'boolean') return false;
    return true;
  });
}

// A set of grade lines being stored rather than generated — an organiser saving
// what they just read, or an edit of one line that landed badly (§2.39).
//
// Shape-checked as hard as anything else that gets written back to the whole
// club, and note what is *not* checked: the text. This route is the manual
// escape hatch and its whole purpose is putting a human's own words next to a
// mark, so the only rules are that it is a string, that it is bounded, and that
// it is filed against a player id.
export function isValidLines(lines) {
  if (!lines || typeof lines !== 'object' || Array.isArray(lines)) return false;
  const ids = Object.keys(lines);
  if (ids.length === 0 || ids.length > MAX_FIXTURE_PLAYERS) return false;
  return ids.every((id) => {
    if (!isStr(id, MAX_ID_CHARS)) return false;
    const line = lines[id];
    if (!line || typeof line !== 'object') return false;
    if (!isStr(line.text, MAX_GRADE_LINE_CHARS)) return false;
    // The mark the sentence was written against; see linesFrom in grades.js.
    return Number.isFinite(line.grade) && line.grade >= 1 && line.grade <= 10;
  });
}

export function isValidFixtures(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length > MAX_FIXTURES) return false;
  return fixtures.every((fx) => {
    if (!fx || typeof fx !== 'object') return false;
    if (!isStr(fx.id, MAX_ID_CHARS)) return false;
    if (!isStr(fx.date, MAX_DATE_CHARS)) return false;
    if (!fx.teams || typeof fx.teams !== 'object') return false;
    if (!TEAM_COLORS.every((c) => isIdList(fx.teams[c], MAX_FIXTURE_PLAYERS))) return false;
    if (!Array.isArray(fx.players) || fx.players.length > MAX_FIXTURE_PLAYERS) return false;
    if (
      !fx.players.every(
        (p) =>
          p &&
          typeof p === 'object' &&
          isStr(p.id, MAX_ID_CHARS) &&
          isStr(p.name, MAX_NAME_CHARS) &&
          // optional since the public read stops carrying it — a device that
          // only ever saw the stripped copy must still be able to publish
          (p.rating === undefined || Number.isFinite(p.rating)),
      )
    ) {
      return false;
    }
    if (!fx.wins || typeof fx.wins !== 'object') return false;
    if (!TEAM_COLORS.every((c) => Number.isFinite(fx.wins[c]))) return false;
    if (fx.mvpId !== undefined && !isStr(fx.mvpId, MAX_ID_CHARS)) return false;
    // The organiser's note (§2.27). Never rendered anywhere — it exists to be
    // handed to the reporter — but it rides in the fixture record, so it has
    // to be allowed through here or publishing a night that has one would fail
    // the whole list. Length-capped like everything else that is prose.
    if (fx.note !== undefined && !isStr(fx.note, MAX_NOTE_CHARS)) return false;
    // absent on every night recorded before the log existed, which is fine —
    // those nights are a tally and always will be
    if (fx.matchLog !== undefined && !isValidMatchLog(fx.matchLog)) return false;
    return true;
  });
}

// --- Stored records --------------------------------------------------------

async function readRecord(env, key) {
  const raw = await env.ROSTER_KV.get(key);
  if (!raw) return null;
  try {
    return { raw, value: JSON.parse(raw) };
  } catch {
    return null;
  }
}

// Both endpoints are a whole-list replace, which means one bad POST is the
// entire season gone with nothing to fall back on — a failure this project has
// actually had. Keep the displaced copy under its own version key before
// overwriting, so recovery is a KV read rather than an archaeology exercise.
async function replaceRecord(env, key, current, payload) {
  if (current) {
    await env.ROSTER_KV.put(`${key}:snapshot:${current.value?.version ?? 0}`, current.raw, {
      expirationTtl: SNAPSHOT_TTL_S,
    });
  }
  await env.ROSTER_KV.put(key, JSON.stringify(payload));
}

// A publish carries the version it believes it is replacing. If that isn't
// what's actually stored, this device is working from data it never saw —
// which is precisely how a stale copy silently overwrites a newer one — so it
// gets turned away and told to reload rather than quietly winning.
// Omitted (an older client) still means last-write-wins, as before.
export function staleVersion(body, current) {
  if (!Number.isFinite(body.baseVersion)) return null;
  const currentVersion = current?.value?.version ?? 0;
  return body.baseVersion === currentVersion ? null : currentVersion;
}

// --- Rate limiting ---------------------------------------------------------
// One counter per IP per purpose, so a busy match night joining rooms can
// never spend the budget that protects the secret word.

function limiterFor(env, key) {
  return env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(key));
}

async function countAttempt(limiter, limit, windowMs) {
  const res = await limiter.fetch(
    `https://limiter/attempt?limit=${limit}&window=${windowMs}`,
    { method: 'POST' },
  );
  return res.json();
}

const refundAttempt = (limiter) =>
  limiter.fetch('https://limiter/refund', { method: 'POST' });

async function readBody(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { tooBig: true };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { tooBig: true };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { bad: true };
  }
}

export default {
  /**
   * The 1st of the month, 05:00 UTC — 08:00 in Israel through the summer, an
   * hour earlier in winter, since Cloudflare's crons are UTC only and pinning
   * an exact local hour year-round would mean two schedules and a DST guess
   * for a job nobody is watching.
   *
   * All it does is register any finished month that has no team yet, which
   * makes running it twice, or a month late, or for the first time on a
   * three-year archive, all the same thing.
   */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(registerAwards(env));
  },

  async fetch(request, env) {
    // browsers send a CORS preflight before the POST
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

    // live match-day room — hands the WebSocket upgrade off to the room's
    // Durable Object, one instance per room id. Rate-limited like everything
    // else: this route needs no secret, and every distinct id it is handed
    // spins up another Durable Object on our account.
    const roomMatch = url.pathname.match(ROOM_PATH);
    if (roomMatch) {
      const gate = await countAttempt(
        limiterFor(env, `room:${ip}`),
        ROOM_LIMIT,
        ROOM_WINDOW_MS,
      );
      if (gate.blocked) {
        return json({ error: 'too many attempts' }, 429, {
          'Retry-After': String(gate.retryAfter),
        });
      }
      const id = env.MATCH_ROOM.idFromName(roomMatch[1]);
      return env.MATCH_ROOM.get(id).fetch(request);
    }

    // public read of the current roster — private fields stripped, see
    // PRIVATE_PLAYER_FIELDS above
    if (url.pathname === '/roster' && request.method === 'GET') {
      const current = await readRecord(env, 'roster');
      // nothing published yet → the app keeps its built-in default roster
      if (!current) return json({ version: 0, players: null });
      const { version, players } = current.value;
      return json({
        version,
        players: Array.isArray(players) ? players.map(publicPlayer) : players,
      });
    }

    // public read of recorded fixtures, minus what each player was rated at
    // the time — see publicFixture
    if (url.pathname === '/history' && request.method === 'GET') {
      const current = await readRecord(env, 'history');
      // nothing published yet → the app keeps whatever it has saved locally
      return json(current ? publicHistory(current.value) : { version: 0, fixtures: null });
    }

    // public read of a night's recap. Anybody may read one; only the organiser
    // may write one, which is what /recap below is for.
    if (url.pathname === '/recap' && request.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!isStr(id, 200)) return json({ error: 'bad id' }, 400);
      const raw = await env.ROSTER_KV.get(recapKey(id));
      if (!raw) return json({ text: null });
      try {
        return json(JSON.parse(raw));
      } catch {
        return json({ text: null });
      }
    }

    // public read of a night's grade lines. The marks themselves are not here
    // and never will be: `src/grades.ts` computes them from the archive every
    // device already has, so storing them would be a second copy of an answer
    // that is already agreed. Only the sentences, which nothing can recompute.
    if (url.pathname === '/grades' && request.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!isStr(id, 200)) return json({ error: 'bad id' }, 400);
      const raw = await env.ROSTER_KV.get(gradesKey(id));
      if (!raw) return json({ lines: null });
      try {
        return json(JSON.parse(raw));
      } catch {
        return json({ lines: null });
      }
    }

    // public read of every Team of the Month registered so far (§2.25). One
    // document rather than one key per month, because a player page wants all
    // of them at once — where a recap is read one night at a time.
    if (url.pathname === '/awards' && request.method === 'GET') {
      return json({ awards: await readAwards(env) });
    }

    // Public read of every player's market value (§2.31).
    //
    // **This is the one endpoint that reads ratings and answers anyway**, and
    // it is deliberately its own route rather than a field on `/roster`. Two
    // reasons. It needs the archive as well as the roster, and `/roster` is on
    // the path every device takes on every open — a second KV read there would
    // be paid by everybody, forever, for a decoration. And keeping it separate
    // means `publicPlayer` keeps its shape, so the thing standing between a
    // rating and the wire is still one list of five field names with a test
    // around it, not a list of five names plus a formula.
    //
    // Nothing but the price leaves. `marketValues` returns `{id, value,
    // previous}` and no term of the blend — five multipliers are five
    // equations, and five equations are the rating back again.
    if (url.pathname === '/values' && request.method === 'GET') {
      const [roster, history, awards] = await Promise.all([
        readRecord(env, 'roster'),
        readRecord(env, 'history'),
        readAwards(env),
      ]);
      const players = roster?.value?.players;
      const fixtures = history?.value?.fixtures;
      if (!Array.isArray(players) || !Array.isArray(fixtures)) return json({ values: {} });

      // Months in the registered five, counted per player from the awards
      // document — the same read the player page already makes for its shirts.
      const months = new Map();
      for (const period of Object.keys(awards)) {
        for (const id of awards[period]?.ids ?? []) months.set(id, (months.get(id) ?? 0) + 1);
      }

      const values = {};
      for (const v of marketValues(fixtures, players, (id) => months.get(id) ?? 0).values()) {
        values[v.id] = { value: v.value, previous: v.previous };
      }
      return json({ values });
    }

    // public read of the fixture being played right now, if any — this is the
    // one everyone in the group polls on a match night
    // Straight through to the Durable Object rather than KV: this is polled
    // every couple of seconds by everyone at the pitch, and KV's edge cache
    // was serving them a clock that had been paused a minute ago (§2.15).
    if (url.pathname === '/live' && request.method === 'GET') {
      const res = await notifier(env).fetch('https://notifier/live');
      return json(await res.json());
    }

    // --- The one write in this Worker with no password on it ----------------
    // Anyone at the pitch can start and pause the match clock, because at
    // 8 minutes a match whoever is nearest the phone has to be able to, and
    // routing that through the organiser makes the clock useless.
    //
    // Kept safe by being *narrow* rather than by being authenticated. It can
    // only replace the `clock` field of a fixture that is already live: it
    // cannot create one, cannot end one, and cannot touch teams, players,
    // ratings, the roster or the history. The worst a stranger who read the
    // Worker URL out of the public bundle can do is show a wrong number for a
    // few minutes, which the next press of Reset undoes. Rate-limited per IP
    // like the room upgrades, and shape-checked as strictly as everything else
    // — a non-numeric endsAt would render as NaN on fifteen phones at once.
    if (url.pathname === '/live/clock' && request.method === 'POST') {
      const gate = await countAttempt(limiterFor(env, `clock:${ip}`), CLOCK_LIMIT, CLOCK_WINDOW_MS);
      if (gate.blocked) {
        return json({ error: 'too many attempts' }, 429, {
          'Retry-After': String(gate.retryAfter),
        });
      }
      const parsed = await readBody(request);
      if (parsed.tooBig) return json({ error: 'too large' }, 413);
      if (parsed.bad || !parsed.body || typeof parsed.body !== 'object') {
        return json({ error: 'bad json' }, 400);
      }
      if (!isValidClock(parsed.body.clock)) return json({ error: 'bad clock' }, 400);

      // Storing the clock and rescheduling its announcements are now one trip
      // into one object, so they cannot half-happen. No fixture on → nothing to
      // run a clock for, which is what stops this being a way to conjure one.
      const res = await notifier(env).fetch('https://notifier/live/clock', {
        method: 'POST',
        body: JSON.stringify({ clock: parsed.body.clock }),
      });
      if (res.status === 404) return json({ error: 'no live fixture' }, 404);
      return json(await res.json());
    }

    // --- The second one, and for the same reason -----------------------------
    // Writing down who won is the other thing that happens at the moment a
    // match ends, done by whoever is nearest the phone. Routing it through the
    // organiser makes it as useless as routing the clock through them would.
    //
    // Narrow in the same way: it can only replace the `matchLog` of a fixture
    // that is already live, and only by one step at a time (see isLogStep), so
    // it cannot create a fixture, end one, touch teams or ratings, or wipe a
    // night's record wholesale. A rejected write costs the sender a poll.
    if (url.pathname === '/live/log' && request.method === 'POST') {
      const gate = await countAttempt(limiterFor(env, `clock:${ip}`), CLOCK_LIMIT, CLOCK_WINDOW_MS);
      if (gate.blocked) {
        return json({ error: 'too many attempts' }, 429, {
          'Retry-After': String(gate.retryAfter),
        });
      }
      const parsed = await readBody(request);
      if (parsed.tooBig) return json({ error: 'too large' }, 413);
      if (parsed.bad || !parsed.body || typeof parsed.body !== 'object') {
        return json({ error: 'bad json' }, 400);
      }
      if (!isValidMatchLog(parsed.body.matchLog)) return json({ error: 'bad match log' }, 400);

      // The step check lives inside the object, not here: it is a read
      // followed by a write that depends on what was read, and only the
      // Durable Object can do that without a race in the middle.
      const res = await notifier(env).fetch('https://notifier/live/log', {
        method: 'POST',
        body: JSON.stringify({ matchLog: parsed.body.matchLog }),
      });
      return json(await res.json(), res.status);
    }

    // --- Match-clock notifications ------------------------------------------
    // Opting in needs no password, for the same reason running the clock
    // doesn't: it is a thing any of the fifteen people at the pitch might do.
    // All a subscription can ever receive is the four fixed announcements in
    // clock-notifier.js, which name a moment in a match and nothing else — so
    // there is nothing here to leak by subscribing, only a phone to buzz.
    if (url.pathname === '/push/key' && request.method === 'GET') {
      if (!env.VAPID_JWK) return json({ key: null });
      return json({ key: bytesToB64u(publicKeyBytes(JSON.parse(env.VAPID_JWK))) });
    }

    if (
      (url.pathname === '/push/subscribe' || url.pathname === '/push/unsubscribe') &&
      request.method === 'POST'
    ) {
      const gate = await countAttempt(limiterFor(env, `push:${ip}`), CLOCK_LIMIT, CLOCK_WINDOW_MS);
      if (gate.blocked) {
        return json({ error: 'too many attempts' }, 429, {
          'Retry-After': String(gate.retryAfter),
        });
      }
      const parsed = await readBody(request);
      if (parsed.tooBig) return json({ error: 'too large' }, 413);
      if (parsed.bad || !parsed.body || typeof parsed.body !== 'object') {
        return json({ error: 'bad json' }, 400);
      }
      if (url.pathname === '/push/subscribe') {
        if (!isValidSubscription(parsed.body.subscription)) {
          return json({ error: 'bad subscription' }, 400);
        }
        await notifier(env).fetch('https://notifier/subscribe', {
          method: 'POST',
          body: JSON.stringify({ subscription: parsed.body.subscription }),
        });
      } else {
        await notifier(env).fetch('https://notifier/unsubscribe', {
          method: 'POST',
          body: JSON.stringify({ endpoint: parsed.body.endpoint }),
        });
      }
      return json({ ok: true });
    }

    // everything below is a POST guarded by the secret word
    const guarded = [
      '/roster',
      '/roster/full',
      '/history/full',
      '/history',
      '/live',
      '/recap',
      '/grades',
      '/awards',
      '/verify',
      '/push/test',
    ];
    if (guarded.includes(url.pathname) && request.method === 'POST') {
      // checked before we do any other work, so a flood costs us as little as
      // possible. Counts the attempt in the same call that decides on it —
      // see rate-limit.js for why that has to be one round trip.
      const limiter = limiterFor(env, `publish:${ip}`);
      const gate = await countAttempt(limiter, PUBLISH_LIMIT, PUBLISH_WINDOW_MS);
      if (gate.blocked) {
        return json({ error: 'too many attempts' }, 429, {
          'Retry-After': String(gate.retryAfter),
        });
      }

      const parsed = await readBody(request);
      if (parsed.tooBig) return json({ error: 'too large' }, 413);
      if (parsed.bad || !parsed.body || typeof parsed.body !== 'object') {
        return json({ error: 'bad json' }, 400);
      }
      const body = parsed.body;

      // the secret word is the password — checked here, on the server
      if (!safeEqual(body.secret, env.PUBLISH_SECRET)) {
        return json({ error: 'wrong word' }, 401);
      }
      // right word — give the attempt back, so only wrong guesses accumulate
      await refundAttempt(limiter);

      // word-only check, used to unlock admin mode in the app
      if (url.pathname === '/verify') {
        return json({ ok: true });
      }

      // Buzz a phone now and say what every link in the chain answered. Behind
      // the word not because the report is sensitive — it names no player and
      // no endpoint — but because sending a push is making other people's
      // pockets vibrate, and that is an organiser's to do.
      if (url.pathname === '/push/test') {
        const res = await notifier(env).fetch('https://notifier/test', {
          method: 'POST',
          body: JSON.stringify({ endpoint: isStr(body.endpoint, 1024) ? body.endpoint : null }),
        });
        return json(await res.json());
      }

      // the organiser's own read: the roster as stored, private fields and
      // all. Lets a new admin device recover keep-apart lists that the public
      // read no longer carries.
      if (url.pathname === '/roster/full') {
        const current = await readRecord(env, 'roster');
        return json(current ? current.value : { version: 0, players: null });
      }

      // The organiser's own read of the archive: every night as stored,
      // ratings and all. The counterpart of /roster/full, and the reason the
      // public read can afford to strip anything — without it, an admin device
      // would adopt the stripped copy and hand it straight back on the next
      // save, quietly erasing the ratings for everyone.
      if (url.pathname === '/history/full') {
        const current = await readRecord(env, 'history');
        return json(current ? current.value : { version: 0, fixtures: null });
      }

      // start / update / end the fixture everyone is watching. Last write
      // wins by design — there is exactly one organiser running one night,
      // and a stale-version rejection mid-match would be the wrong answer.
      if (url.pathname === '/live') {
        const fixture = body.fixture ?? null;
        if (!isValidLive(fixture)) {
          return json({ error: 'bad live fixture' }, 400);
        }
        // One trip: stores it (or clears it), reschedules the announcements,
        // and drops the subscriptions if this is a different night from the
        // last. Passing null is what ends the night.
        const res = await notifier(env).fetch('https://notifier/live/put', {
          method: 'POST',
          body: JSON.stringify({ fixture }),
        });
        return json(await res.json());
      }

      // Register a Team of the Month by hand.
      //
      //   { period: '2026-08' }        → score it now and store it
      //   { period: '2026-08', clear } → forget it, so the cron may redo it
      //   { run: true }                → do the cron's pass right now
      //
      // The cron below is the usual registrar; this is the seeding path (the
      // archive should not have to wait a month for its first entry) and the
      // correction path. Since the cron never overwrites, a month set here
      // stays as set.
      if (url.pathname === '/awards') {
        if (body.run === true) return json(await registerAwards(env));
        if (!isPeriod(body.period)) return json({ error: 'bad period' }, 400);
        if (body.clear === true) {
          return json({ awards: await clearMonth(env, body.period) });
        }
        const registered = await announceMonth(env, body.period);
        if (!registered) return json({ error: 'nothing played that month' }, 400);
        return json({ period: body.period, ...registered });
      }

      // Write a night's recap.
      //
      // Three things in one route, because they are one act with a human
      // optionally standing in the middle of it:
      //
      //   { facts }             → generate and hand it back, store nothing
      //   { facts, save: true } → generate and store it in the same call
      //   { text }              → store this text, generated or edited
      //   { text: null }        → forget the recap for this night
      //
      // The first two are the whole difference between today's flow — the
      // organiser reads it before anyone else does — and the automatic one
      // this is built for: the same call with `save`, made the moment a night
      // is filed, with nobody in the loop. Nothing else has to change.
      if (url.pathname === '/recap') {
        if (!isStr(body.fixtureId, 200)) return json({ error: 'bad id' }, 400);
        const key = recapKey(body.fixtureId);

        if (body.text === null) {
          await env.ROSTER_KV.delete(key);
          return json({ ok: true, text: null });
        }

        if (isStr(body.text, 8000)) {
          const stored = { text: body.text, at: Date.now() };
          await env.ROSTER_KV.put(key, JSON.stringify(stored));
          return json({ ok: true, ...stored });
        }

        if (!isValidFacts(body.facts)) return json({ error: 'bad facts' }, 400);

        // Only generation is rated, and only once the payload is known to be
        // worth a call — a malformed flood costs nothing upstream, so it must
        // not eat the budget of somebody with a real night to write about.
        //
        // Storing an approved draft and deleting a recap stay free on purpose.
        // They spend nothing but a KV write, and being made to wait before you
        // can save the report already on your screen would be a penalty for
        // the wrong act entirely.
        const gen = await countAttempt(
          limiterFor(env, `recap:${ip}`),
          RECAP_LIMIT,
          RECAP_WINDOW_MS,
        );
        if (gen.blocked) {
          return json({ error: 'too many recaps' }, 429, {
            'Retry-After': String(gen.retryAfter),
          });
        }

        const written = await writeRecap(env, body.facts);
        if (written.error) return json({ error: written.error }, 502);
        if (body.save === true) {
          const stored = { text: written.text, at: Date.now() };
          await env.ROSTER_KV.put(key, JSON.stringify(stored));
          return json({ ok: true, ...stored });
        }
        return json({ ok: true, text: written.text });
      }

      // Write a night's grade lines (§2.39). The same four shapes as /recap,
      // for the same reason — the organiser reads them before the group does,
      // and `save: true` is the automatic version already built:
      //
      //   { facts }             → write them and hand them back, store nothing
      //   { facts, save: true } → write and store in one call
      //   { lines }             → store these, generated or edited by hand
      //   { lines: null }       → forget them for this night
      if (url.pathname === '/grades') {
        if (!isStr(body.fixtureId, 200)) return json({ error: 'bad id' }, 400);
        const key = gradesKey(body.fixtureId);

        if (body.lines === null) {
          await env.ROSTER_KV.delete(key);
          return json({ ok: true, lines: null });
        }

        if (body.lines !== undefined) {
          if (!isValidLines(body.lines)) return json({ error: 'bad lines' }, 400);
          const stored = { lines: body.lines, at: Date.now() };
          await env.ROSTER_KV.put(key, JSON.stringify(stored));
          return json({ ok: true, ...stored });
        }

        if (!isValidGradeFacts(body.facts)) return json({ error: 'bad facts' }, 400);

        // Rated only once the payload is known to be worth a call, and only for
        // generation — see the identical reasoning above /recap. Storing an
        // approved set and clearing one stay free.
        const gen = await countAttempt(
          limiterFor(env, `grades:${ip}`),
          GRADES_LIMIT,
          GRADES_WINDOW_MS,
        );
        if (gen.blocked) {
          return json({ error: 'too many grades' }, 429, {
            'Retry-After': String(gen.retryAfter),
          });
        }

        const written = await writeGrades(env, body.facts);
        if (written.error) return json({ error: written.error }, 502);
        // `missing` travels either way. A set of lines with two players absent
        // is usable and worth showing; whether it is worth a re-roll is a
        // judgement for whoever is reading it, and they cannot make it if the
        // gaps arrive silently.
        if (body.save === true) {
          const stored = { lines: written.lines, at: Date.now() };
          await env.ROSTER_KV.put(key, JSON.stringify(stored));
          return json({ ok: true, ...stored, missing: written.missing });
        }
        return json({ ok: true, lines: written.lines, missing: written.missing });
      }

      if (url.pathname === '/history') {
        if (!isValidFixtures(body.fixtures)) {
          return json({ error: 'bad history' }, 400);
        }
        const current = await readRecord(env, 'history');
        const stale = staleVersion(body, current);
        if (stale !== null) {
          return json({ error: 'stale', currentVersion: stale }, 409);
        }
        // version is a timestamp so each device knows when it has newer history
        const payload = { version: Date.now(), fixtures: body.fixtures };
        await replaceRecord(env, 'history', current, payload);
        return json({ ok: true, version: payload.version });
      }

      if (!isValidPlayers(body.players)) {
        return json({ error: 'bad roster' }, 400);
      }
      const current = await readRecord(env, 'roster');
      const stale = staleVersion(body, current);
      if (stale !== null) {
        return json({ error: 'stale', currentVersion: stale }, 409);
      }
      // version is a timestamp so each device knows when it has a newer roster
      const payload = { version: Date.now(), players: body.players };
      await replaceRecord(env, 'roster', current, payload);
      return json({ ok: true, version: payload.version });
    }

    return json({ error: 'not found' }, 404);
  },
};

// compare without leaking character-by-character timing info
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
