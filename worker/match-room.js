// Durable Object: one live "room" per match-day fixture.
//
// The Roster tab's Match Day flow (steps 1-2, guest add, GK marking) stays
// fully local — a room only exists once the host clicks "Go live" on the
// Teams page. From then on, the room holds a denormalized copy of who's
// playing and the current team split, and broadcasts drag-and-drop changes
// to everyone connected — the host and any guest who opened the share link.
//
// Wire protocol (JSON over one WebSocket per connection):
//
//   client -> server
//     { type: 'init', adminToken, name, players, teams, gkIds }
//       Sent once by the host to create (or resync) the room.
//     { type: 'join', name, adminToken? }
//       Sent by a guest (or the host reconnecting) to an existing room.
//     { type: 'sync', teams }
//       Sent by anyone after a local drag/swap/move — overwrites the
//       room's team split and is rebroadcast to everyone.
//     { type: 'close-room', adminToken }
//       Host-only: deletes the room immediately. A room that is never closed
//       expires on its own ROOM_TTL_MS after the last activity (see alarm()).
//
//   server -> client
//     { type: 'state', room: { players, teams, gkIds } }
//     { type: 'presence', members: [{ name, isHost }] }
//     { type: 'activity', text, by }
//     { type: 'closed' }
//     { type: 'error', error }

const TEAM_COLORS = ['black', 'white', 'blue'];

// Anyone who knows a room id can open a socket to it, and every 'init'/'sync'
// lands in Durable Object storage — so nothing from the wire is taken on
// trust or stored at whatever size it happens to arrive in.
const MAX_MESSAGE_CHARS = 128 * 1024; // a full 15-player room is a few KB
const MAX_PLAYERS = 60;
const MAX_NAME_CHARS = 60;
const MAX_ID_CHARS = 64;

// A room is for one football night. Idle this long and it's abandoned — the
// alarm below clears it so forgotten rooms don't pile up in storage forever.
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

export class MatchRoom {
  constructor(state) {
    this.state = state;
    this.sessions = new Map(); // WebSocket -> { name, isHost }
    this.room = null; // { adminToken, players, teams, gkIds }
    this.state.blockConcurrencyWhile(async () => {
      this.room = (await this.state.storage.get('room')) ?? null;
    });
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.attach(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  attach(ws) {
    ws.addEventListener('message', (evt) => {
      // drop anything oversized before parsing it, let alone storing it
      if (typeof evt.data !== 'string' || evt.data.length > MAX_MESSAGE_CHARS) return;
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      this.onMessage(ws, msg).catch(() => {});
    });
    const leave = () => {
      this.sessions.delete(ws);
      this.broadcastPresence();
    };
    ws.addEventListener('close', leave);
    ws.addEventListener('error', leave);
  }

  async onMessage(ws, msg) {
    if (msg.type === 'init') {
      // creates the room, or resyncs it — only trusted because the admin
      // token is a random secret minted client-side, not derivable from the
      // (shareable) room id
      if (this.room && this.room.adminToken !== msg.adminToken) return;
      if (!isValidId(msg.adminToken)) return;
      const players = sanitizePlayers(msg.players);
      if (!players || !isValidTeams(msg.teams)) {
        this.send(ws, { type: 'error', error: 'bad-room-payload' });
        return;
      }
      this.room = {
        adminToken: msg.adminToken,
        players,
        teams: msg.teams,
        gkIds: sanitizeIds(msg.gkIds),
      };
      await this.save();
      this.sessions.set(ws, { name: cleanName(msg.name, 'Host'), isHost: true });
      this.send(ws, { type: 'state', room: this.publicRoom() });
      this.broadcastPresence();
      return;
    }

    if (msg.type === 'join') {
      if (!this.room) {
        this.send(ws, { type: 'error', error: 'room-not-found' });
        return;
      }
      const isHost = !!msg.adminToken && msg.adminToken === this.room.adminToken;
      this.sessions.set(ws, { name: cleanName(msg.name, 'Guest'), isHost });
      this.send(ws, { type: 'state', room: this.publicRoom() });
      this.broadcastPresence();
      return;
    }

    if (msg.type === 'sync') {
      if (!this.room || !this.sessions.has(ws)) return;
      if (!isValidTeams(msg.teams)) return;
      const prev = this.room.teams;
      this.room = { ...this.room, teams: msg.teams };
      await this.save();
      const who = this.sessions.get(ws).name;
      this.broadcast({ type: 'state', room: this.publicRoom() });
      const change = describeChange(who, prev, msg.teams, this.room.players);
      if (change) this.broadcast({ type: 'activity', text: change.text, by: who, ids: change.ids });
      return;
    }

    if (msg.type === 'close-room') {
      if (!this.room || this.room.adminToken !== msg.adminToken) return;
      this.room = null;
      // deleteAll rather than delete('room') so the pending expiry alarm goes
      // with it — the host reuses one room id across fixtures, and a leftover
      // alarm would be pointing at a room that no longer exists
      await this.state.storage.deleteAll();
      await this.state.storage.deleteAlarm();
      this.broadcast({ type: 'closed' });
      this.sessions.clear();
      return;
    }
  }

  // every write pushes the idle-expiry deadline out, so a room stays alive as
  // long as people are actually using it
  async save() {
    await this.state.storage.put('room', this.room);
    await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  // ROOM_TTL_MS with no activity — treat the room as abandoned. Same visible
  // outcome as the host closing it, so a straggler sees a real message rather
  // than a socket that goes quiet.
  async alarm() {
    this.room = null;
    await this.state.storage.deleteAll();
    this.broadcast({ type: 'closed' });
    this.sessions.clear();
  }

  // never send the admin token to clients
  publicRoom() {
    const { players, teams, gkIds } = this.room;
    return { players, teams, gkIds };
  }

  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // connection is gone; the close/error listener will clean it up
    }
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.sessions.keys()) {
      try {
        ws.send(data);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }

  broadcastPresence() {
    const members = [...this.sessions.values()].map((s) => ({
      name: s.name,
      isHost: s.isHost,
    }));
    this.broadcast({ type: 'presence', members });
  }
}

const isValidId = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_CHARS;

// Display names are echoed to everyone in the room, so they get clamped rather
// than rejected — a long name is clumsy, not hostile.
const cleanName = (v, fallback) =>
  (typeof v === 'string' ? v.trim().slice(0, MAX_NAME_CHARS) : '') || fallback;

const sanitizeIds = (v) =>
  Array.isArray(v) ? v.filter(isValidId).slice(0, MAX_PLAYERS) : [];

function isValidTeams(teams) {
  if (!teams || typeof teams !== 'object') return false;
  return TEAM_COLORS.every(
    (c) =>
      Array.isArray(teams[c]) && teams[c].length <= MAX_PLAYERS && teams[c].every(isValidId),
  );
}

// Rebuilt field by field rather than passed through. Two reasons: it bounds
// what an 'init' can park in Durable Object storage, and it keeps `avoid` —
// the private keep-apart preference — off guest devices entirely, instead of
// shipping it and trusting the board not to draw it (TeamsBoard only reads it
// under `showPrivateNotes`, which a guest never gets). `chemistry` goes the
// same way: it only ever fed the balancer, which has already run by now.
function sanitizePlayers(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_PLAYERS) return null;
  const out = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object' || !isValidId(p.id)) return null;
    const clean = { id: p.id, name: cleanName(p.name, '?') };
    if (Number.isFinite(p.rating)) clean.rating = p.rating;
    if (Number.isFinite(p.attack)) clean.attack = p.attack;
    if (p.ratingUnknown === true) clean.ratingUnknown = true;
    if (p.isGk === true) clean.isGk = true;
    if (p.isGuest === true) clean.isGuest = true;
    if (isValidId(p.invitedBy)) clean.invitedBy = p.invitedBy;
    out.push(clean);
  }
  return out;
}

// Small, best-effort human summary of what a sync changed, for the activity
// toast — not authoritative, just a nicety. Returns the moved player ids too,
// so the client can highlight the actual rows that changed.
function describeChange(who, prev, next, players) {
  const teamOf = (teams, id) => TEAM_COLORS.find((c) => teams[c].includes(id));
  const ids = new Set([...TEAM_COLORS.flatMap((c) => prev[c]), ...TEAM_COLORS.flatMap((c) => next[c])]);
  const moved = [...ids].filter((id) => teamOf(prev, id) !== teamOf(next, id));
  if (moved.length === 0) return null;
  const name = (id) => players.find((p) => p.id === id)?.name ?? '?';
  if (moved.length === 1) {
    return { text: `${who} moved ${name(moved[0])} to ${teamOf(next, moved[0])}`, ids: moved };
  }
  if (moved.length === 2 && teamOf(next, moved[0]) === teamOf(prev, moved[1])) {
    return { text: `${who} swapped ${name(moved[0])} and ${name(moved[1])}`, ids: moved };
  }
  return { text: `${who} reshuffled the teams`, ids: moved };
}
