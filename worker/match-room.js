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
//       Host-only: deletes the room. There's otherwise no expiry — a room
//       lives in storage until explicitly closed.
//
//   server -> client
//     { type: 'state', room: { players, teams, gkIds } }
//     { type: 'presence', members: [{ name, isHost }] }
//     { type: 'activity', text }
//     { type: 'closed' }
//     { type: 'error', error }

const TEAM_COLORS = ['black', 'white', 'blue'];

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
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
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
      this.room = {
        adminToken: msg.adminToken,
        players: msg.players ?? [],
        teams: msg.teams,
        gkIds: msg.gkIds ?? [],
      };
      await this.state.storage.put('room', this.room);
      this.sessions.set(ws, { name: msg.name || 'Host', isHost: true });
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
      this.sessions.set(ws, { name: msg.name || 'Guest', isHost });
      this.send(ws, { type: 'state', room: this.publicRoom() });
      this.broadcastPresence();
      return;
    }

    if (msg.type === 'sync') {
      if (!this.room || !this.sessions.has(ws)) return;
      if (!isValidTeams(msg.teams)) return;
      const prev = this.room.teams;
      this.room = { ...this.room, teams: msg.teams };
      await this.state.storage.put('room', this.room);
      const who = this.sessions.get(ws).name;
      this.broadcast({ type: 'state', room: this.publicRoom() });
      const text = describeChange(who, prev, msg.teams, this.room.players);
      if (text) this.broadcast({ type: 'activity', text });
      return;
    }

    if (msg.type === 'close-room') {
      if (!this.room || this.room.adminToken !== msg.adminToken) return;
      this.room = null;
      await this.state.storage.delete('room');
      this.broadcast({ type: 'closed' });
      this.sessions.clear();
      return;
    }
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

function isValidTeams(teams) {
  if (!teams || typeof teams !== 'object') return false;
  return TEAM_COLORS.every((c) => Array.isArray(teams[c]));
}

// Small, best-effort human summary of what a sync changed, for the activity
// toast — not authoritative, just a nicety.
function describeChange(who, prev, next, players) {
  const teamOf = (teams, id) => TEAM_COLORS.find((c) => teams[c].includes(id));
  const ids = new Set([...TEAM_COLORS.flatMap((c) => prev[c]), ...TEAM_COLORS.flatMap((c) => next[c])]);
  const moved = [...ids].filter((id) => teamOf(prev, id) !== teamOf(next, id));
  if (moved.length === 0) return null;
  const name = (id) => players.find((p) => p.id === id)?.name ?? '?';
  if (moved.length === 1) {
    return `${who} moved ${name(moved[0])} to ${teamOf(next, moved[0])}`;
  }
  if (moved.length === 2 && teamOf(next, moved[0]) === teamOf(prev, moved[1])) {
    return `${who} swapped ${name(moved[0])} and ${name(moved[1])}`;
  }
  return `${who} reshuffled the teams`;
}
