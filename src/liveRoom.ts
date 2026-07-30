import type { Player, Teams } from './types';
import { REMOTE_URL } from './remote';

// Client for the live match-day room (see worker/match-room.js for the
// server side and the wire protocol this mirrors).

export interface RoomState {
  players: Player[];
  teams: Teams;
  gkIds: string[];
}

export interface PresenceMember {
  name: string;
  isHost: boolean;
}

export interface RoomCallbacks {
  onState: (state: RoomState) => void;
  onPresence: (members: PresenceMember[]) => void;
  onActivity: (text: string) => void;
  onError: (error: string) => void;
  onClose?: () => void;
}

export interface RoomConnection {
  sendSync: (teams: Teams) => void;
  close: () => void;
}

// Rooms live on the same Worker as the shared roster — REMOTE_URL is empty
// when that isn't configured, in which case live rooms are simply disabled.
export const ROOMS_ENABLED = !!REMOTE_URL;

function socketUrl(roomId: string): string | null {
  if (!REMOTE_URL) return null;
  const u = new URL(`${REMOTE_URL}/room/${roomId}`);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

function connect(roomId: string, hello: Record<string, unknown>, cb: RoomCallbacks): RoomConnection | null {
  const url = socketUrl(roomId);
  if (!url) return null;

  const ws = new WebSocket(url);
  ws.addEventListener('open', () => ws.send(JSON.stringify(hello)));
  ws.addEventListener('message', (evt) => {
    let msg: { type: string; [key: string]: unknown };
    try {
      msg = JSON.parse(evt.data as string);
    } catch {
      return;
    }
    if (msg.type === 'state') cb.onState(msg.room as RoomState);
    else if (msg.type === 'presence') cb.onPresence(msg.members as PresenceMember[]);
    else if (msg.type === 'activity') cb.onActivity(msg.text as string);
    else if (msg.type === 'error') cb.onError(msg.error as string);
  });
  ws.addEventListener('close', () => cb.onClose?.());

  return {
    sendSync: (teams) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sync', teams }));
    },
    close: () => ws.close(),
  };
}

// Called by the host when they hit "Go live" — creates (or resyncs, if
// reconnecting with the same adminToken) the room.
export function hostRoom(
  roomId: string,
  adminToken: string,
  name: string,
  initial: RoomState,
  cb: RoomCallbacks,
): RoomConnection | null {
  return connect(roomId, { type: 'init', adminToken, name, ...initial }, cb);
}

// Called by a guest opening a shared room link (or the host opening it from
// a second device — passing their adminToken tags that connection as host too).
export function joinRoom(
  roomId: string,
  name: string,
  adminToken: string | null,
  cb: RoomCallbacks,
): RoomConnection | null {
  return connect(roomId, { type: 'join', name, adminToken: adminToken ?? undefined }, cb);
}

export function roomShareUrl(roomId: string): string {
  const u = new URL(window.location.href);
  u.search = `?room=${roomId}`;
  u.hash = '';
  return u.toString();
}
