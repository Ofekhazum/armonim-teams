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

export interface ActivityEvent {
  text: string;
  by?: string;
  ids?: string[]; // players the change moved — lets the UI highlight their rows
}

export interface RoomCallbacks {
  onState: (state: RoomState) => void;
  onPresence: (members: PresenceMember[]) => void;
  onActivity: (event: ActivityEvent) => void;
  onError: (error: string) => void;
  onClose?: () => void;
  // the host ended the room (as opposed to onClose, which also fires on a
  // plain dropped connection — e.g. wifi hiccup, tab backgrounded)
  onClosed?: () => void;
}

export interface RoomConnection {
  sendSync: (teams: Teams) => void;
  // only meaningful for the host's own connection — a guest calling this
  // has no adminToken, so the server just ignores it
  closeRoom: () => void;
  close: () => void;
}

// Rooms live on the same Worker as the shared roster — REMOTE_URL is empty
// when that isn't configured, in which case live rooms are simply disabled.
export const ROOMS_ENABLED = !!REMOTE_URL;

// A room id arrives from a query param, so it is whatever someone put in the
// address bar — and it gets interpolated into a URL path. The worker's own
// route only matches this same shape, so a hostile id was never going to reach
// a room; the point of checking here is that `?room=../history` should fail as
// a bad link rather than as a mystery socket error. Kept in sync with
// ROOM_PATH in worker/roster-worker.js.
const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const isValidRoomId = (id: string): boolean => ROOM_ID_RE.test(id);

function socketUrl(roomId: string): string | null {
  if (!REMOTE_URL || !isValidRoomId(roomId)) return null;
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
    else if (msg.type === 'activity')
      cb.onActivity({
        text: msg.text as string,
        by: msg.by as string | undefined,
        ids: msg.ids as string[] | undefined,
      });
    else if (msg.type === 'closed') cb.onClosed?.();
    else if (msg.type === 'error') cb.onError(msg.error as string);
  });
  ws.addEventListener('close', () => cb.onClose?.());

  const send = (data: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };

  return {
    sendSync: (teams) => send({ type: 'sync', teams }),
    closeRoom: () => send({ type: 'close-room', adminToken: hello.adminToken }),
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
