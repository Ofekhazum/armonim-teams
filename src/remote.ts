import type { FixtureRecord, Player } from './types';

// URL of the Cloudflare Worker that stores the shared roster (see worker/).
// Paste your deployed worker URL here, e.g.
//   https://armonim-roster.<your-subdomain>.workers.dev
// Leave it as '' to disable the shared roster (the app then works purely
// offline, seeded from the built-in default roster as before).
export const REMOTE_URL = 'https://armonim-roster.ofekh.workers.dev';

const VERSION_KEY = 'armonim-roster-version';

export interface RemoteRoster {
  version: number;
  players: Player[];
}

// Which shared-roster version this device has already applied. Lets us skip
// re-applying (and re-clobbering local session state) unless a newer one exists.
export const localRosterVersion = (): number =>
  Number(localStorage.getItem(VERSION_KEY) ?? 0);

export const setLocalRosterVersion = (v: number): void =>
  localStorage.setItem(VERSION_KEY, String(v));

// Fetch the shared roster. Returns null on any failure (offline, not set up
// yet, nothing published) so the caller silently keeps whatever it has.
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
export type PublishResult =
  | 'ok'
  | 'wrong-word'
  | 'rate-limited'
  | 'error'
  | 'not-configured';

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
      body: JSON.stringify({ secret, players }),
    });
    if (res.status === 401) return { result: 'wrong-word' };
    if (res.status === 429) return { result: 'rate-limited' };
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

// Push the given fixture list to the shared store. Sends the *whole* list —
// same last-write-wins model as the roster, which is fine at this scale (one
// organiser recording results right after a match, not concurrent editors).
export async function publishRemoteHistory(
  fixtures: FixtureRecord[],
  secret: string,
): Promise<{ result: PublishResult; version?: number }> {
  if (!REMOTE_URL) return { result: 'not-configured' };
  try {
    const res = await fetch(`${REMOTE_URL}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, fixtures }),
    });
    if (res.status === 401) return { result: 'wrong-word' };
    if (res.status === 429) return { result: 'rate-limited' };
    if (!res.ok) return { result: 'error' };
    const data = (await res.json()) as { version: number };
    return { result: 'ok', version: data.version };
  } catch {
    return { result: 'error' };
  }
}
