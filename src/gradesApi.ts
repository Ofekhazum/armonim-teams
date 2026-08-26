// Talking to the dressing-room joker (§2.39).
//
// The same four calls `recap.ts` makes and deliberately the same shape, because
// it is the same act: generate, read it, keep it or throw it away. What differs
// is what comes back — a map of one-liners rather than one report — and the one
// rule that map carries, which is `publishedMarks` at the bottom.

import { REMOTE_URL } from './remote';
import type { GradesFacts } from './gradesFacts';

/**
 * One player's published mark, and the banter beside it if the model wrote any.
 *
 * `text` is optional and `grade` is not, which is the right way round: a mark
 * with no sentence is an ordinary complete state (the model skipped somebody),
 * where a sentence with no mark would be banter about a number nobody can see.
 */
export interface GradeLine {
  text?: string;
  grade: number;
}

/** Keyed by player id. The `p1` codes never leave the Worker. */
export type GradeLines = Record<string, GradeLine>;

export interface StoredGrades {
  lines: GradeLines;
  at: number; // epoch ms, when they were written
}

export type GradesError =
  | 'not-configured' // no worker, or no GEMINI_KEY set on it
  | 'wrong-word'
  | 'rate-limited' // too many wrong words from this address
  | 'too-many-grades' // the right word, but a dozen sets in an hour
  | 'unavailable' // Gemini said no: quota, safety filter, or simply down
  | 'error';

export type GradesResult =
  | { lines: GradeLines; missing?: string[] }
  | { error: GradesError; detail?: string };

/** Whatever has been written for this night, or null. Public — anybody reads. */
export async function fetchGrades(fixtureId: string): Promise<StoredGrades | null> {
  if (!REMOTE_URL) return null;
  try {
    const res = await fetch(`${REMOTE_URL}/grades?id=${encodeURIComponent(fixtureId)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<StoredGrades>;
    return data.lines && typeof data.lines === 'object'
      ? { lines: data.lines, at: data.at ?? 0 }
      : null;
  } catch {
    return null;
  }
}

const post = async (body: unknown): Promise<GradesResult> => {
  if (!REMOTE_URL) return { error: 'not-configured' };
  try {
    const res = await fetch(`${REMOTE_URL}/grades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) return { error: 'wrong-word' };
    // Two different 429s wearing one status, exactly as in recap.ts: the word
    // being guessed at, versus the word being right and a dozen sets written in
    // an hour. Wait ten minutes and you have had enough are different answers.
    if (res.status === 429) {
      const said = await res.json().catch(() => ({}) as { error?: string });
      return { error: said.error === 'too many grades' ? 'too-many-grades' : 'rate-limited' };
    }
    if (res.status === 502) {
      const said = await res.json().catch(() => ({}) as { error?: string });
      const detail = typeof said.error === 'string' ? said.error : undefined;
      if (detail === 'not-configured') return { error: 'not-configured' };
      return { error: 'unavailable', detail };
    }
    if (!res.ok) return { error: 'error' };
    const data = (await res.json()) as { lines?: GradeLines; missing?: string[] };
    return data.lines && typeof data.lines === 'object'
      ? { lines: data.lines, missing: data.missing }
      : { error: 'error' };
  } catch {
    return { error: 'error' };
  }
};

/** Write them and hand them back without storing — the draft the organiser reads. */
export const draftGrades = (
  fixtureId: string,
  facts: GradesFacts,
  secret: string,
): Promise<GradesResult> => post({ secret, fixtureId, facts });

/** Store the approved set, so everyone else reads these rather than their own. */
export const saveGrades = (
  fixtureId: string,
  lines: GradeLines,
  secret: string,
): Promise<GradesResult> => post({ secret, fixtureId, lines });

/** Forget them. The night goes back to bare marks, which is a complete state. */
export const clearGrades = (fixtureId: string, secret: string): Promise<GradesResult> =>
  post({ secret, fixtureId, lines: null });

/**
 * Write and store in one call, with nobody reading them in between.
 *
 * Unused today and deliberately kept, the same way `autoRecap` is: this is the
 * automatic version, and it exists so turning it on later is a call site rather
 * than a redesign.
 */
export const autoGrades = (
  fixtureId: string,
  facts: GradesFacts,
  secret: string,
): Promise<GradesResult> => post({ secret, fixtureId, facts, save: true });

/**
 * What to actually put on screen for each player: the published mark, and the
 * banter if there is any.
 *
 * **The published record wins over anything computed locally**, and that is a
 * correctness requirement rather than a preference. `grades.ts` reads the
 * organiser's private rating (§2.28), which `publicFixture` strips out of
 * `GET /history` — so on every device except the organiser's, a locally
 * computed mark is simply *wrong*. Measured against the real club, six of
 * sixteen players came out half a mark apart between an admin device and a
 * public one. The organiser computes the marks where the ratings live and
 * publishes them, exactly as `GET /values` publishes a price no public device
 * could work out (§2.31).
 *
 * An earlier version compared the stored mark against a locally recomputed one
 * and dropped the line when they disagreed, to catch banter left stale by a
 * night corrected later. That test stopped being valid the moment the rating
 * entered the formula: on a viewer's device it fires for a large share of the
 * club every time, silently hiding the banter from exactly the people it was
 * written for while the organiser sees it fine. Staleness after a correction is
 * handled the way the recap already handles it — the organiser re-rolls.
 *
 * `players` is the fallback order and the fallback marks, used only for a
 * player absent from the record entirely.
 */
export function publishedMarks(
  lines: GradeLines | null,
  players: { id: string; grade: number }[],
): GradeLines {
  const out: GradeLines = {};
  for (const p of players) {
    const stored = lines?.[p.id];
    out[p.id] = stored ? stored : { grade: p.grade };
  }
  return out;
}
