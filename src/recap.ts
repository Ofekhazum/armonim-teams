// Talking to the reporter (§2.24).
//
// Three calls, and deliberately no state: a recap belongs to a night rather
// than to a session, so the page that shows one asks for it when it opens and
// forgets it when it closes.
//
// The generate/save split is the human in the loop, and it is a *choice* rather
// than a constraint — `draftRecap` writes without storing, `saveRecap` stores
// what the organiser approved. The Worker will do both in one call when asked
// (`save: true`), which is the whole of what automating this later requires:
// call it from wherever a night gets filed and stop showing anyone the draft.

import type { RecapFacts } from './recapFacts';
import { REMOTE_URL } from './remote';

export interface StoredRecap {
  text: string;
  at: number; // epoch ms, when it was written
}

export type RecapError =
  | 'not-configured' // no worker, or no GEMINI_KEY set on it
  | 'wrong-word'
  | 'rate-limited' // too many wrong words from this address
  | 'too-many-recaps' // the right word, but a dozen drafts in an hour
  | 'unavailable' // Gemini said no: quota, safety filter, or simply down
  | 'error';

// What the worker said when it turned the request down. Carried through and
// shown, because the first real failure of this feature was a missing key, a
// wrong model name and an empty generation all wearing the same sentence —
// "Gemini turned it down" — which told nobody anything. The worker already
// knows which of the three it was.
export type RecapResult = { text: string } | { error: RecapError; detail?: string };

/** Whatever has been written for this night, or null. Public — anybody reads. */
export async function fetchRecap(fixtureId: string): Promise<StoredRecap | null> {
  if (!REMOTE_URL) return null;
  try {
    const res = await fetch(`${REMOTE_URL}/recap?id=${encodeURIComponent(fixtureId)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<StoredRecap>;
    return typeof data.text === 'string' ? { text: data.text, at: data.at ?? 0 } : null;
  } catch {
    return null;
  }
}

const post = async (body: unknown): Promise<RecapResult> => {
  if (!REMOTE_URL) return { error: 'not-configured' };
  try {
    const res = await fetch(`${REMOTE_URL}/recap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) return { error: 'wrong-word' };
    // Two different 429s wearing one status. One means the word is being
    // guessed at from this address; the other means the word was right and the
    // reporter has written a dozen of these in an hour. They ask for very
    // different things — wait ten minutes, versus you have had enough — so the
    // worker names which, the same way it names a 502.
    if (res.status === 429) {
      const said = await res.json().catch(() => ({}) as { error?: string });
      return { error: said.error === 'too many recaps' ? 'too-many-recaps' : 'rate-limited' };
    }
    // 502 is the worker reporting what Gemini told it — quota, a safety
    // refusal, an outage, or no key configured at all. All of them mean "no
    // recap right now" and none of them mean the app is broken, but they need
    // very different things done about them, so the reason travels.
    if (res.status === 502) {
      const said = await res.json().catch(() => ({}) as { error?: string });
      const detail = typeof said.error === 'string' ? said.error : undefined;
      if (detail === 'not-configured') return { error: 'not-configured' };
      return { error: 'unavailable', detail };
    }
    if (!res.ok) return { error: 'error' };
    const data = (await res.json()) as { text?: string };
    return typeof data.text === 'string' ? { text: data.text } : { error: 'error' };
  } catch {
    return { error: 'error' };
  }
};

/** Write one and hand it back without storing it — the draft the organiser reads. */
export const draftRecap = (
  fixtureId: string,
  facts: RecapFacts,
  secret: string,
): Promise<RecapResult> => post({ secret, fixtureId, facts });

/** Store the approved text, so everyone else gets this one rather than their own. */
export const saveRecap = (
  fixtureId: string,
  text: string,
  secret: string,
): Promise<RecapResult> => post({ secret, fixtureId, text });

/** Forget it. The night page goes back to having no recap. */
export const clearRecap = (fixtureId: string, secret: string): Promise<RecapResult> =>
  post({ secret, fixtureId, text: null });

/**
 * Write and store in one call, with nobody reading it in between.
 *
 * Unused today and deliberately kept: this is the automatic version, and it
 * exists so that turning it on later is a call site rather than a redesign.
 */
export const autoRecap = (
  fixtureId: string,
  facts: RecapFacts,
  secret: string,
): Promise<RecapResult> => post({ secret, fixtureId, facts, save: true });
