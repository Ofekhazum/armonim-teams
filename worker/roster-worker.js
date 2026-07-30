// Cloudflare Worker: the shared Armonim roster store, plus live match-day
// rooms (see match-room.js).
//
//   GET  /roster       → public read of the current roster (everyone's app calls this)
//   POST /roster       → publish a new roster; requires the secret word
//   POST /verify       → check the secret word (used to unlock admin mode)
//   GET  /room/:id     → WebSocket upgrade into a live team-picking room
//
// Setup lives in worker/README.md. In short: bind a KV namespace as ROSTER_KV,
// add a PUBLISH_SECRET secret, and bind the MatchRoom Durable Object.

export { MatchRoom } from './match-room.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

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

    // everything below is a POST guarded by the secret word
    if ((url.pathname === '/roster' || url.pathname === '/verify') && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'bad json' }, 400);
      }

      // the secret word is the password — checked here, on the server
      if (!safeEqual(body.secret, env.PUBLISH_SECRET)) {
        return json({ error: 'wrong word' }, 401);
      }

      // word-only check, used to unlock admin mode in the app
      if (url.pathname === '/verify') {
        return json({ ok: true });
      }

      if (!Array.isArray(body.players) || body.players.some((p) => !p?.id || !p?.name)) {
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
