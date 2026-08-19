import type { FixtureRecord, Player } from './types';

// URL of the Cloudflare Worker that stores the shared roster (see worker/).
// Paste your deployed worker URL here, e.g.
//   https://armonim-roster.<your-subdomain>.workers.dev
// Leave it as '' to disable the shared roster (the app then works purely
// offline, seeded from the built-in default roster as before).
const DEPLOYED_URL = 'https://armonim-roster.ofekh.workers.dev';

// VITE_REMOTE_URL points a dev run somewhere else — in practice at a local
// `npx wrangler dev` (see worker/README.md). Worth having as a real switch
// rather than a comment-out-and-remember-to-restore: the default here is the
// *live* club's data, so anything exercising the app against it — a manual
// poke at the save button, an automated check — is editing production. That
// has already cost this project a season of results once.
//
//   echo 'VITE_REMOTE_URL=http://localhost:8787' > .env.local && npm run dev
//
// Set it to an empty string to run fully offline against the bundled roster.
export const REMOTE_URL: string = import.meta.env?.VITE_REMOTE_URL ?? DEPLOYED_URL;

const VERSION_KEY = 'armonim-roster-version';

// What the *public* roster read carries. The worker strips the three fields
// that are statements about people rather than about football — `avoid` (who
// won't play with whom), `chemistry`, and `aliases` — because GET /roster is
// unauthenticated and the worker URL ships in the public bundle, so anything
// it returns is readable by anyone, not just the club. The app already treated
// `avoid` as admin-only in every place it rendered it; this makes the wire
// agree with the UI. Devices keep their own copy of these locally, and an
// organiser setting up a new device pulls them back with fetchFullRoster().
export type PublicPlayer = Omit<Player, 'chemistry' | 'avoid' | 'aliases'>;

export interface RemoteRoster {
  version: number;
  players: PublicPlayer[];
}

export interface FullRoster {
  version: number;
  players: Player[];
}

// Which shared-roster version this device has already applied. Lets us skip
// re-applying (and re-clobbering local session state) unless a newer one exists.
export const localRosterVersion = (): number =>
  Number(localStorage.getItem(VERSION_KEY) ?? 0);

export const setLocalRosterVersion = (v: number): void =>
  localStorage.setItem(VERSION_KEY, String(v));

// Fetch the shared roster, minus the private fields (see PublicPlayer above).
// Returns null on any failure (offline, not set up yet, nothing published) so
// the caller silently keeps whatever it has.
export async function fetchRemoteRoster(): Promise<RemoteRoster | null> {
  if (!REMOTE_URL) return null;
  try {
    const res = await fetch(`${REMOTE_URL}/roster`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as RemoteRoster;
    if (!Array.isArray(data.players) || data.players.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

// 'rate-limited' comes from the worker after too many wrong words from this IP
// (see worker/rate-limit.js) — worth telling apart from a generic failure, so
// the app can say "wait" rather than "check your connection".
//
// 'stale' means the shared copy moved on since this device last read it, so
// publishing would overwrite something this device never saw. Also worth
// telling apart: the fix is "reload", not "retry".
export type PublishResult =
  | 'ok'
  | 'wrong-word'
  | 'rate-limited'
  | 'stale'
  | 'error'
  | 'not-configured';

// The organiser's read of the roster *including* the private fields the public
// GET strips — used to rehydrate a freshly set-up admin device, which would
// otherwise be missing every keep-apart list the balancer relies on.
export async function fetchFullRoster(secret: string): Promise<FullRoster | null> {
  if (!REMOTE_URL) return null;
  try {
    const res = await fetch(`${REMOTE_URL}/roster/full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as FullRoster;
    if (!Array.isArray(data.players)) return null;
    return data;
  } catch {
    return null;
  }
}

// Check the secret word without changing anything — used to unlock admin mode.
export async function verifyWord(secret: string): Promise<PublishResult> {
  if (!REMOTE_URL) return 'not-configured';
  try {
    const res = await fetch(`${REMOTE_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    });
    if (res.status === 401) return 'wrong-word';
    if (res.status === 429) return 'rate-limited';
    if (!res.ok) return 'error';
    return 'ok';
  } catch {
    return 'error';
  }
}

// Push the given roster to the shared store. The secret word is verified by the
// worker (server-side) — a wrong word comes back as 'wrong-word'.
export async function publishRemoteRoster(
  players: Player[],
  secret: string,
): Promise<{ result: PublishResult; version?: number }> {
  if (!REMOTE_URL) return { result: 'not-configured' };
  try {
    const res = await fetch(`${REMOTE_URL}/roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // the version this device believes it is replacing — the worker refuses
      // the write if the shared copy has moved on since (see §6)
      body: JSON.stringify({ secret, players, baseVersion: localRosterVersion() }),
    });
    if (res.status === 401) return { result: 'wrong-word' };
    if (res.status === 429) return { result: 'rate-limited' };
    if (res.status === 409) return { result: 'stale' };
    if (!res.ok) return { result: 'error' };
    const data = (await res.json()) as { version: number };
    return { result: 'ok', version: data.version };
  } catch {
    return { result: 'error' };
  }
}

// --- Shared results history -------------------------------------------------
// Same shape and behaviour as the roster above — a full-list replace, gated on
// the same admin word, versioned the same way — so results recorded on one
// device (or by one organiser) show up for everyone else, the same as the
// roster and unlike the local-only history this replaced.

const HISTORY_VERSION_KEY = 'armonim-history-version';

export interface RemoteHistory {
  version: number;
  fixtures: FixtureRecord[];
}

export const localHistoryVersion = (): number =>
  Number(localStorage.getItem(HISTORY_VERSION_KEY) ?? 0);

export const setLocalHistoryVersion = (v: number): void =>
  localStorage.setItem(HISTORY_VERSION_KEY, String(v));

export async function fetchRemoteHistory(): Promise<RemoteHistory | null> {
  if (!REMOTE_URL) return null;
  try {
    const res = await fetch(`${REMOTE_URL}/history`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as RemoteHistory;
    if (!Array.isArray(data.fixtures)) return null;
    return data;
  } catch {
    return null;
  }
}

// Push the given fixture list to the shared store. Sends the *whole* list, so
// it is also a whole-list *delete* if the list is wrong — which is why it now
// carries the version it means to replace. Concurrent editors were never the
// worry at this scale; a device publishing from a copy it pulled long ago (or
// never pulled at all) was, and that is what 'stale' catches.
export async function publishRemoteHistory(
  fixtures: FixtureRecord[],
  secret: string,
): Promise<{ result: PublishResult; version?: number }> {
  if (!REMOTE_URL) return { result: 'not-configured' };
  try {
    const res = await fetch(`${REMOTE_URL}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, fixtures, baseVersion: localHistoryVersion() }),
    });
    if (res.status === 401) return { result: 'wrong-word' };
    if (res.status === 429) return { result: 'rate-limited' };
    if (res.status === 409) return { result: 'stale' };
    if (!res.ok) return { result: 'error' };
    const data = (await res.json()) as { version: number };
    return { result: 'ok', version: data.version };
  } catch {
    return { result: 'error' };
  }
}
