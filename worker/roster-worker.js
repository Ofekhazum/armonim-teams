// Cloudflare Worker: the shared Armonim roster + results history, plus live
// match-day rooms (see match-room.js).
//
//   GET  /roster       → public read of the current roster, private fields stripped
//   POST /roster       → publish a new roster; requires the secret word
//   POST /roster/full  → read the roster *including* private fields; same word
//   GET  /history      → public read of recorded fixtures (nights + win tallies)
//   POST /history      → publish the fixture list; requires the secret word
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
const MAX_ALIASES = 20;
const MAX_NAME_CHARS = 60;
const MAX_ID_CHARS = 64;
const MAX_DATE_CHARS = 20;
const TEAM_COLORS = ['black', 'white', 'blue'];

// Whatever a publish stores here is served back to every device in the club,
// so the ceiling on one is the ceiling on all of them. A full season of
// fixtures is a few dozen KB; half a megabyte is generous and still bounded.
const MAX_BODY_BYTES = 512 * 1024;

// Wrong-word budget per IP. Correct words are refunded, so an admin
// publishing all evening never approaches it.
const PUBLISH_LIMIT = 10;
const PUBLISH_WINDOW_MS = 10 * 60 * 1000;

// Room upgrades are unauthenticated by design — the share link is the
// invitation — so the only thing standing between a script and an unbounded
// number of Durable Objects is this. Set well above what a real match night
// needs (fifteen people, plus reconnects, often behind one NAT).
const ROOM_LIMIT = 120;
const ROOM_WINDOW_MS = 10 * 60 * 1000;

// How long the copy displaced by a publish is kept around. Long enough that a
// bad write discovered weeks later is still recoverable.
const SNAPSHOT_TTL_S = 90 * 24 * 60 * 60;

const ROOM_PATH = /^\/room\/([A-Za-z0-9_-]{1,64})$/;

// --- The privacy line ------------------------------------------------------
// These three never leave the organiser's device through the *public* read.
// `avoid` is the keep-apart list — who won't play with whom — which the app
// already treats as admin-only everywhere it is rendered (Roster's per-player
// note, TeamsBoard's `showPrivateNotes`) and which match-room.js goes out of
// its way to strip before a room reaches a guest's phone. Serving it from an
// unauthenticated GET undid all of that. `chemistry` is the same kind of
// statement about people, and `aliases` are nicknames that only ever fed the
// admin-side import matcher.
//
// They are still *stored*, so an organiser setting up a new device gets them
// back — via POST /roster/full, which costs the secret word.
const PRIVATE_PLAYER_FIELDS = ['avoid', 'chemistry', 'aliases'];

export function publicPlayer(p) {
  const clean = { ...p };
  for (const field of PRIVATE_PLAYER_FIELDS) delete clean[field];
  return clean;
}

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
          Number.isFinite(p.rating),
      )
    ) {
      return false;
    }
    if (!fx.wins || typeof fx.wins !== 'object') return false;
    if (!TEAM_COLORS.every((c) => Number.isFinite(fx.wins[c]))) return false;
    if (fx.mvpId !== undefined && !isStr(fx.mvpId, MAX_ID_CHARS)) return false;
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

    // public read of recorded fixtures
    if (url.pathname === '/history' && request.method === 'GET') {
      const current = await readRecord(env, 'history');
      // nothing published yet → the app keeps whatever it has saved locally
      return json(current ? current.value : { version: 0, fixtures: null });
    }

    // everything below is a POST guarded by the secret word
    const guarded = ['/roster', '/roster/full', '/history', '/verify'];
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

      // the organiser's own read: the roster as stored, private fields and
      // all. Lets a new admin device recover keep-apart lists that the public
      // read no longer carries.
      if (url.pathname === '/roster/full') {
        const current = await readRecord(env, 'roster');
        return json(current ? current.value : { version: 0, players: null });
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
