// Talking to the dressing-room joker (§2.39).
//
// The same four calls `recap.ts` makes and deliberately the same shape, because
// it is the same act: generate, read it, keep it or throw it away. What differs
// is what comes back — a map of one-liners rather than one report — and the one
// rule that map carries, which is `publishedMarks` at the bottom.

import { REMOTE_URL } from './remote';
import { isTestMode } from './testMode';
// Statically, unlike `values.ts`'s lazy pull of `marketValue.ts`: that one
// keeps a ridge solver out of everybody's bundle, where `grades.ts` is already
// in it via `gradesFacts` → `NightGrades` → the night page. A dynamic import
// here would buy no chunk and only warn at build time that it had not.
import { nightGrades } from './grades';
import { testGradeLines } from './testGrades';
import type { FixtureRecord } from './types';

const dateOf = (history: FixtureRecord[], fixtureId: string) =>
  history.find((f) => f.id === fixtureId)?.date;
import type { GradesFacts } from './gradesFacts';
import type { AllMarks } from './gradeHistory';

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

/**
 * Every published mark in the club, without the banter — `{ fixtureId: {
 * playerId: grade } }`. `{}` on any failure, because a graph is decoration and
 * a profile must render exactly the same without one.
 *
 * One request for the whole club rather than one per night: see `readAllMarks`
 * in the Worker for why the per-night keys stay and the fan-out happens there.
 */
export async function fetchAllMarks(history: FixtureRecord[] = []): Promise<AllMarks> {
  // The sandbox has no Worker to ask and nothing published in it, so it works
  // its own marks out — the same move `fetchValues` makes, and for the same
  // reason: the invented club (§2.32) exists to review features against a
  // season of football, and a graph that is always empty there cannot be
  // reviewed at all. Live devices never take this path; they read what the
  // organiser published, which is the whole point of `publishedMarks`.
  if (isTestMode()) {
    const out: AllMarks = {};
    for (const fx of history) {
      const graded = nightGrades(history, fx.id);
      if (!graded) continue;
      const marks: Record<string, number> = {};
      for (const g of graded) marks[g.id] = g.grade;
      out[fx.id] = marks;
    }
    return out;
  }
  if (!REMOTE_URL) return {};
  try {
    const res = await fetch(`${REMOTE_URL}/grades/all`, { cache: 'no-store' });
    if (!res.ok) return {};
    const data = (await res.json()) as { grades?: AllMarks };
    return data.grades && typeof data.grades === 'object' ? data.grades : {};
  } catch {
    return {};
  }
}

/**
 * Whatever has been written for this night, or null. Public — anybody reads.
 *
 * `history` is used only by the sandbox, which has nothing published and no
 * Worker to ask, and derives the night's marks instead (see `testGrades.ts`).
 * Live devices ignore it and read what the organiser published.
 */
export async function fetchGrades(
  fixtureId: string,
  history: FixtureRecord[] = [],
): Promise<StoredGrades | null> {
  if (isTestMode()) {
    const lines = testGradeLines(history, fixtureId);
    return lines ? { lines, at: Date.parse(dateOf(history, fixtureId) ?? '') || Date.now() } : null;
  }
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

/**
 * Write them and hand them back without storing — the draft the organiser reads.
 *
 * In the sandbox there is no model to ask, so the invented lines come back
 * instead of an error. Without this the one button on the panel could only ever
 * fail there, which makes the feature impossible to look at in the place built
 * for looking at features.
 */
export const draftGrades = (
  fixtureId: string,
  facts: GradesFacts,
  secret: string,
  history: FixtureRecord[] = [],
): Promise<GradesResult> => {
  if (isTestMode()) {
    const lines = testGradeLines(history, fixtureId);
    return Promise.resolve(lines ? { lines, missing: [] } : { error: 'error' });
  }
  return post({ secret, fixtureId, facts });
};

/**
 * Store the approved set, so everyone else reads these rather than their own.
 *
 * A no-op in the sandbox, which has nowhere to store anything: the lines it
 * shows are derived from the invented history every time they are asked for,
 * so they are already exactly what publishing them would produce.
 */
export const saveGrades = (
  fixtureId: string,
  lines: GradeLines,
  secret: string,
): Promise<GradesResult> =>
  isTestMode() ? Promise.resolve({ lines }) : post({ secret, fixtureId, lines });

/**
 * Forget them. The night goes back to bare marks, which is a complete state.
 *
 * In the sandbox this clears what is on screen but nothing underneath, because
 * there is nothing underneath — reopening the night derives the lines again.
 * The same way the sandbox reseeds everything else it invents.
 */
export const clearGrades = (fixtureId: string, secret: string): Promise<GradesResult> =>
  isTestMode() ? Promise.resolve({ lines: {} }) : post({ secret, fixtureId, lines: null });

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
