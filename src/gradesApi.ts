// Talking to the dressing-room joker (§2.39).
//
// The same four calls `recap.ts` makes and deliberately the same shape, because
// it is the same act: generate, read it, keep it or throw it away. What differs
// is what comes back — a map of one-liners rather than one report — and the one
// rule that map carries, which is `usableLines` at the bottom.

import { REMOTE_URL } from './remote';
import type { GradesFacts } from './gradesFacts';
import type { Grade } from './grades';

/** One player's line, and the mark it was written against. */
export interface GradeLine {
  text: string;
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
 * The stored lines that still describe the marks in front of us.
 *
 * **The marks are recomputed, the sentences are not**, and that gap is the one
 * thing this feature can get quietly wrong. `nightGrades` reads the archive, so
 * a night corrected months later — a win tally fixed, an MVP added — moves the
 * marks underneath banter that was written about the old ones. A line hyping
 * somebody who now shows a 4 is worse than no line at all, because it reads as
 * the app not knowing what it thinks.
 *
 * So the mark travels with the sentence and is checked against the live one
 * here. A drifted line is dropped rather than shown, which leaves that player a
 * bare mark — already a complete state, and the honest one. Re-rolling the
 * night brings the banter back.
 */
export function usableLines(lines: GradeLines | null, grades: Grade[]): GradeLines {
  if (!lines) return {};
  const out: GradeLines = {};
  for (const g of grades) {
    const line = lines[g.id];
    if (line && line.grade === g.grade) out[g.id] = line;
  }
  return out;
}
