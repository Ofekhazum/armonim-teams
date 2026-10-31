// Talking to the month's show (§2.74).
//
// The month's twin of `recap.ts`, and smaller, because the Worker reads the
// month itself: every call is a month, the word and at most one more field.
// There are no facts to send, so there is nothing here a caller could use to
// put words in the prompt.
//
// The voice needs nothing of its own. A published show is the recap
// `month:<period>`, and `RecapVoice` records it given that id.

import type { Persona, RecapError, StoredRecap } from './recap';
import { REMOTE_URL } from './remote';

/** The id a month's show is recorded under — `month:2026-09`. */
export const monthShowId = (period: string) => `month:${period}`;

// `not-ready` is the one failure a night does not have: the Worker has no
// recorded night for that month (the app's copy is ahead of the published one).
export type MonthShowError = RecapError | 'not-ready';

export type MonthShowResult =
  | { text: string | null; at?: number }
  | { error: MonthShowError; detail?: string };

const post = async (body: Record<string, unknown>): Promise<MonthShowResult> => {
  if (!REMOTE_URL) return { error: 'not-configured' };
  try {
    const res = await fetch(`${REMOTE_URL}/month-recap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) return { error: 'wrong-word' };
    if (res.status === 409) return { error: 'not-ready' };
    // The same two 429s as a night, told apart the same way (see recap.ts).
    if (res.status === 429) {
      const said = await res.json().catch(() => ({}) as { error?: string });
      return { error: said.error === 'too many recaps' ? 'too-many-recaps' : 'rate-limited' };
    }
    if (res.status === 502) {
      const said = await res.json().catch(() => ({}) as { error?: string });
      const detail = typeof said.error === 'string' ? said.error : undefined;
      if (detail === 'not-configured') return { error: 'not-configured' };
      return { error: 'unavailable', detail };
    }
    if (!res.ok) return { error: 'error' };
    const data = (await res.json()) as { text?: unknown; at?: unknown };
    return {
      text: typeof data.text === 'string' ? data.text : null,
      ...(typeof data.at === 'number' ? { at: data.at } : {}),
    };
  } catch {
    return { error: 'error' };
  }
};

/** The published show, if there is one. Behind the word: the text is the organiser's. */
export async function readMonthShow(period: string, secret: string): Promise<StoredRecap | null> {
  const out = await post({ secret, period, read: true });
  return 'text' in out && out.text ? { text: out.text, at: out.at ?? 0 } : null;
}

/** Write one and hand it back without storing it — the draft the organiser reads. */
export const draftMonthShow = (period: string, secret: string, persona: Persona) =>
  post({ secret, period, persona });

/** Publish the approved text. The persona it is read in is the one that wrote it. */
export const saveMonthShow = (period: string, text: string, secret: string) =>
  post({ secret, period, text });

/** Forget it, and its recording with it. */
export const clearMonthShow = (period: string, secret: string) =>
  post({ secret, period, text: null });
