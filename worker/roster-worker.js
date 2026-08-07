// Cloudflare Worker: the shared Armonim roster + results history, plus live
// match-day rooms (see match-room.js).
//
//   GET  /roster       → public read of the current roster (everyone's app calls this)
//   POST /roster       → publish a new roster; requires the secret word
//   GET  /history       → public read of recorded fixtures (nights + win tallies)
//   POST /history       → publish the fixture list; requires the secret word
//   POST /verify        → check the secret word (used to unlock admin mode)
//   GET  /room/:id      → WebSocket upgrade into a live team-picking room
//
// /history is a full-list replace, same as /roster — the client sends its
// whole local history and that becomes the shared copy — rather than
// per-fixture endpoints. Simpler, consistent with how /roster already works,
// and a season's worth of fixtures is a few dozen KB, well inside a KV value.
//
// The three POSTs are gated on the secret word and rate-limited per IP
// (see rate-limit.js) so the word can't simply be guessed at speed.
//
// Setup lives in worker/README.md. In short: bind a KV namespace as ROSTER_KV,
// add a PUBLISH_SECRET secret, and bind the MatchRoom and RateLimiter
// Durable Objects.

export { MatchRoom } from './match-room.js';
export { RateLimiter } from './rate-limit.js';

// Deliberately open: GET /roster is meant to be readable by anyone with the
// app, and the POSTs are gated on the secret word rather than on origin — a
// CORS rule would only inconvenience browsers, never a scripted attacker, and
// would break `npm run dev` against the deployed worker.
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
const TEAM_COLORS = ['black', 'white', 'blue'];

// Loose but real shape-checking, same spirit as the roster's own check below:
// catch garbage, don't fight over exactly what a valid date string looks like.
function isValidFixtures(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length > MAX_FIXTURES) return false;
  return fixtures.every((fx) => {
    if (!fx || typeof fx !== 'object') return false;
    if (typeof fx.id !== 'string' || !fx.id || fx.id.length > 64) return false;
    if (typeof fx.date !== 'string' || !fx.date || fx.date.length > 20) return false;
    if (!fx.teams || typeof fx.teams !== 'object') return false;
    if (
      !TEAM_COLORS.every(
        (c) => Array.isArray(fx.teams[c]) && fx.teams[c].length <= MAX_FIXTURE_PLAYERS,
      )
    ) {
      return false;
    }
    if (!Array.isArray(fx.players) || fx.players.length > MAX_FIXTURE_PLAYERS) return false;
    if (!fx.players.every((p) => p?.id && p?.name && Number.isFinite(p.rating))) return false;
    if (!fx.wins || typeof fx.wins !== 'object') return false;
    if (!TEAM_COLORS.every((c) => Number.isFinite(fx.wins[c]))) return false;
    return true;
  });
}

export default {
  async fetch(request, env) {
    // browsers send a CORS preflight before the POST
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    // live match-day room — hands the WebSocket upgrade off to the room's
    // Durable Object, one instance per room id
    const roomMatch = url.pathname.match(/^\/room\/([A-Za-z0-9_-]+)$/);
    if (roomMatch) {
      const id = env.MATCH_ROOM.idFromName(roomMatch[1]);
      return env.MATCH_ROOM.get(id).fetch(request);
    }

    // public read of the current roster
    if (url.pathname === '/roster' && request.method === 'GET') {
      const raw = await env.ROSTER_KV.get('roster');
      // nothing published yet → the app keeps its built-in default roster
      return json(raw ? JSON.parse(raw) : { version: 0, players: null });
    }

    // public read of recorded fixtures
    if (url.pathname === '/history' && request.method === 'GET') {
      const raw = await env.ROSTER_KV.get('history');
      // nothing published yet → the app keeps whatever it has saved locally
      return json(raw ? JSON.parse(raw) : { version: 0, fixtures: null });
    }

    // everything below is a POST guarded by the secret word
    if (
      (url.pathname === '/roster' || url.pathname === '/history' || url.pathname === '/verify') &&
      request.method === 'POST'
    ) {
      // one counter per client IP (see rate-limit.js). Checked before we do any
      // other work, so a flood costs us as little as possible.
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(ip));
      const gate = await limiter.fetch('https://limiter/check').then((r) => r.json());
      if (gate.blocked) {
        return json({ error: 'too many attempts' }, 429, {
          'Retry-After': String(gate.retryAfter),
        });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'bad json' }, 400);
      }

      // the secret word is the password — checked here, on the server
      if (!safeEqual(body.secret, env.PUBLISH_SECRET)) {
        // only wrong guesses move the counter, so publishing often is fine
        await limiter.fetch('https://limiter/fail', { method: 'POST' });
        return json({ error: 'wrong word' }, 401);
      }

      // word-only check, used to unlock admin mode in the app
      if (url.pathname === '/verify') {
        return json({ ok: true });
      }

      if (url.pathname === '/history') {
        if (!isValidFixtures(body.fixtures)) {
          return json({ error: 'bad history' }, 400);
        }
        // version is a timestamp so each device knows when it has newer history
        const payload = { version: Date.now(), fixtures: body.fixtures };
        await env.ROSTER_KV.put('history', JSON.stringify(payload));
        return json({ ok: true, version: payload.version });
      }

      if (
        !Array.isArray(body.players) ||
        body.players.length > MAX_PLAYERS ||
        body.players.some((p) => !p?.id || !p?.name)
      ) {
        return json({ error: 'bad roster' }, 400);
      }

      // version is a timestamp so each device knows when it has a newer roster
      const payload = { version: Date.now(), players: body.players };
      await env.ROSTER_KV.put('roster', JSON.stringify(payload));
      return json({ ok: true, version: payload.version });
    }

    return json({ error: 'not found' }, 404);
  },
};

// compare without leaking character-by-character timing info
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
