import type { AppState, Session } from './types';
import { initialClock, migratePlayer } from './types';
import { DEFAULT_PLAYERS } from './defaultRoster';
import { isTestMode } from './testMode';
import { buildTestClub } from './testData';

// Two keys, and which one this tab uses is decided once at module load (§2.32).
// The live key is never opened in test mode and the test key is never opened
// outside it — not by a check at each call site, but because `KEY` is a
// constant that was resolved before the first render. There is no moment at
// which the app could be reading one club and writing to the other.
const LIVE_KEY = 'armonim-teams-v1';
const TEST_KEY = 'armonim-teams-test-v1';
const KEY = isTestMode() ? TEST_KEY : LIVE_KEY;
const STORAGE_VERSION = 4;

type PersistedState = AppState & { version?: number };

export const emptySession = (): Session => ({
  availableIds: [],
  guests: [],
  gkIds: [],
  teams: null,
  teamAlts: [],
  altIndex: 0,
  fixtureStarted: false,
  wins: { black: null, white: null, blue: null },
  matchLog: [],
  savedFixtureId: null,
  clock: initialClock(),
  liveStartedAt: null,
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
          // absent on saves from before results existed — an empty history is
          // the correct starting point, not a reason to discard the save
          history: Array.isArray(parsed.history) ? parsed.history : [],
        };
      }
    }
  } catch {
    // corrupted or stale state — start fresh
  }
  // First open of the sandbox: seed it with the invented club rather than with
  // the real default roster. Everything after this is ordinary app state saved
  // under the test key, so the sandbox is editable and survives a reload the
  // same way the real one does.
  if (isTestMode()) return { ...buildTestClub(), session: emptySession() };
  // nothing saved on this device yet — start from the published roster
  return {
    players: DEFAULT_PLAYERS.map((p) => ({
      ...p,
      chemistry: [...p.chemistry],
      avoid: [...(p.avoid ?? [])],
      aliases: [...(p.aliases ?? [])],
    })),
    session: emptySession(),
    history: [],
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

// --- Club tab: is the past-nights shelf open? -------------------------------
// Remembered per device rather than held in component state, because the tabs
// unmount — so without this, hiding the shelf would last until the next time
// anyone looked at anything else, which is not what hiding something means.
// Open is the default: the shelf is still the first thing on the tab.

const NIGHTS_SHELF_KEY = 'armonim-nights-shelf';

export const getNightsShelfOpen = (): boolean =>
  localStorage.getItem(NIGHTS_SHELF_KEY) !== 'hidden';

export const setNightsShelfOpen = (open: boolean) =>
  localStorage.setItem(NIGHTS_SHELF_KEY, open ? 'open' : 'hidden');

// --- Club tab: which of the other sections are folded away? -----------------
//
// **`localStorage`, and deliberately not the fixture page's answer.** The
// match-night folds (§2.34) are keyed by fixture in `sessionStorage`, because
// a fold there is a decision about *tonight* and should not outlive it. This
// tab has no such event to expire against: a reader who does not care about
// the podiums does not care about them next week either, and re-folding four
// sections on every visit is exactly the annoyance folding removes. Same
// reasoning as the shelf key above, which is why it sits beside it.
//
// One key holding the whole map, rather than a key per section: sections will
// be added (comparison, the scatter plot) and a growing family of near-
// identical keys is how one of them ends up misspelled.
//
// **What is stored is what somebody actually chose, not what is currently
// shut.** An earlier version kept a list of hidden ids, which cannot express
// "closed unless you say otherwise" — Team of the Month is admin tooling that
// opens to ten rows of buttons, so it starts folded, and under a hidden-list
// scheme its default would have been indistinguishable from a fold the reader
// had chosen. Recording the choice and falling back to each section's own
// default keeps the two apart, and means changing a default later does not
// have to fight state already on somebody's device.

const SECTIONS_KEY = 'armonim-club-sections';

const readSections = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    // Arrays and nulls are both `object`. Anything that is not a plain map is
    // treated as no preference at all rather than trusted — which also quietly
    // absorbs the older hidden-list format described above.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
};

/** `fallback` is the section's own default, used until somebody chooses. */
export const getSectionOpen = (id: string, fallback = true): boolean => {
  const stored = readSections()[id];
  return typeof stored === 'boolean' ? stored : fallback;
};

export const setSectionOpen = (id: string, open: boolean) => {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...readSections(), [id]: open }));
  } catch {
    /* unwritable storage — the fold still works, it just will not be remembered */
  }
};

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
