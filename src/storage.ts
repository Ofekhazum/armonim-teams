import type { AppState, Session } from './types';
import { migratePlayer } from './types';
import { DEFAULT_PLAYERS } from './defaultRoster';

const KEY = 'armonim-teams-v1';
const STORAGE_VERSION = 3;

type PersistedState = AppState & { version?: number };

export const emptySession = (): Session => ({
  availableIds: [],
  guests: [],
  gkIds: [],
  teams: null,
  teamAlts: [],
  altIndex: 0,
});

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      // NOTE: a save from an older STORAGE_VERSION is *migrated*, never
      // discarded. This used to throw on any version mismatch, which silently
      // wiped the roster (locally-added players, edited ratings) and replaced
      // it with the bundled default — the migration below exists precisely so
      // that never has to happen. Breaking shape changes belong in
      // migratePlayer / the normalisation here, not in a version guard.
      //
      // an empty saved roster (e.g. the site was opened before the published
      // roster existed) falls through to the published default below
      if (Array.isArray(parsed.players) && parsed.players.length > 0) {
        // chemistry/avoid are mutual — repair any one-way links from older versions
        const players = parsed.players.map((p) => ({
          ...migratePlayer(p),
          chemistry: p.chemistry ?? [],
          avoid: p.avoid ?? [],
          aliases: p.aliases ?? [],
        }));
        const byId = new Map(players.map((p) => [p.id, p]));
        for (const p of players) {
          for (const other of p.chemistry) {
            const o = byId.get(other);
            if (o && !o.chemistry.includes(p.id)) o.chemistry.push(p.id);
          }
          for (const other of p.avoid!) {
            const o = byId.get(other);
            if (o && !o.avoid!.includes(p.id)) o.avoid!.push(p.id);
          }
        }
        return {
          players,
          session: { ...emptySession(), ...parsed.session },
        };
      }
    }
  } catch {
    // corrupted or stale state — start fresh
  }
  // nothing saved on this device yet — start from the published roster
  return {
    players: DEFAULT_PLAYERS.map((p) => ({
      ...p,
      chemistry: [...p.chemistry],
      avoid: [...(p.avoid ?? [])],
      aliases: [...(p.aliases ?? [])],
    })),
    session: emptySession(),
  };
}

export function saveState(state: AppState) {
  localStorage.setItem(KEY, JSON.stringify({ version: STORAGE_VERSION, ...state }));
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Like uid(), but for the live room's adminToken, which is a credential rather
// than just a label: it's the only thing proving a connection is the host, so
// it has to be unguessable. uid()'s Math.random() is neither cryptographically
// strong nor long enough for that; this is.
export const secureToken = (): string => crypto.randomUUID();

// --- Live room identity ----------------------------------------------------
// The display name people pick the first time they go live or join a room,
// remembered per device so it's only ever asked once.

const NAME_KEY = 'armonim-my-name';

export const getMyName = (): string | null => localStorage.getItem(NAME_KEY);
export const setMyName = (name: string) => localStorage.setItem(NAME_KEY, name);

// The host's {roomId, adminToken} for the fixture currently live, if any —
// kept so a page refresh doesn't demote the host to a regular guest.

const HOST_ROOM_KEY = 'armonim-host-room';

export interface HostRoom {
  roomId: string;
  adminToken: string;
}

export const getHostRoom = (): HostRoom | null => {
  try {
    const raw = localStorage.getItem(HOST_ROOM_KEY);
    return raw ? (JSON.parse(raw) as HostRoom) : null;
  } catch {
    return null;
  }
};

export const setHostRoom = (room: HostRoom | null) => {
  if (room) localStorage.setItem(HOST_ROOM_KEY, JSON.stringify(room));
  else localStorage.removeItem(HOST_ROOM_KEY);
};
