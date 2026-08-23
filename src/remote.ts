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

// Which shared copy a stored version number refers to. The version *is* a
// Date.now() taken by whichever server wrote it, so two servers' versions are
// two clocks, not two points on one timeline — and "is the remote newer than
// what I have?" quietly becomes "was that server's clock ahead of this one's?".
//
// A device that has spoken to a local `wrangler dev` therefore carries a
// timestamp from the moment it was seeded, which is almost certainly later than
// whenever the deployed roster was last published. Point it back at the
// deployed Worker and it concludes it already has something newer, and keeps
// showing the throwaway data forever. That is exactly what happened, on a real
// person's phone, from my own testing.
//
// Scoping the key by host means switching REMOTE_URL starts the comparison
// fresh instead of racing two servers' clocks. Existing devices see a key they
// have never written, read 0, and re-adopt the shared copy on next load —
// which is the correct answer and also repairs anyone already stuck.
const versionKey = (name: string): string => {
  let host = 'none';
  try {
    if (REMOTE_URL) host = new URL(REMOTE_URL).host;
  } catch {
    // malformed REMOTE_URL — 'none' is as good a bucket as any
  }
  return `armonim-${name}-version@${host}`;
};

const VERSION_KEY = versionKey('roster');

// The pre-scoping keys, left behind on every device that has ever run this app.
// Dead weight rather than a hazard — nothing reads them any more — but they are
// the record of a bug, and leaving them in people's browsers invites someone to
// wonder later whether they still matter.
for (const legacy of ['armonim-roster-version', 'armonim-history-version']) {
  try {
    localStorage.removeItem(legacy);
  } catch {
    // storage disabled (private mode, blocked cookies) — nothing to clean
  }
}

// What the *public* roster read carries. The worker strips the five fields that
// are the organiser's opinion of somebody rather than a fact about football —
// `avoid` (who won't play with whom), `chemistry`, `aliases`, and the two that
// matter most, `rating` and `attack`. GET /roster is unauthenticated and the
// worker URL ships in the public bundle, so anything it returns is readable by
// anyone with the address, not just by the club.
//
// The app already treated all five as admin-only everywhere it rendered them
// (§2.9); this makes the wire agree with the UI. Devices keep their own copy
// locally, and an organiser setting up a new device pulls them back with
// fetchFullRoster().
export type PublicPlayer = Omit<
  Player,
  'chemistry' | 'avoid' | 'aliases' | 'rating' | 'attack'
> & { rating?: number; attack?: number };

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

const HISTORY_VERSION_KEY = versionKey('history');

export interface RemoteHistory {
  version: number;
  fixtures: FixtureRecord[];
}

export const localHistoryVersion = (): number =>
  Number(localStorage.getItem(HISTORY_VERSION_KEY) ?? 0);

export const setLocalHistoryVersion = (v: number): void =>
  localStorage.setItem(HISTORY_VERSION_KEY, String(v));

/**
 * The shared archive as anyone may read it — **without** what each player was
 * rated on the night. A `FixturePlayer` carried a rating snapshot, which made
 * the archive a second copy of the thing the roster read had just stopped
 * handing out (see PublicPlayer above).
 */
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

/**
 * The organiser's read of the archive, ratings included.
 *
 * Not a nicety — it is what stops the strip above destroying data. An admin
 * device adopts the shared history and then republishes the whole list every
 * time a night is filed, so a device holding the stripped copy would hand it
 * straight back and the ratings would be gone from the store for good. An
 * admin pulls this instead, and a worker too old to serve it returns null,
 * which the caller treats as "keep what you have" rather than as an answer.
 */
export async function fetchFullHistory(secret: string): Promise<RemoteHistory | null> {
  if (!REMOTE_URL) return null;
  try {
    const res = await fetch(`${REMOTE_URL}/history/full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    });
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
