import type { FixtureRecord, Player } from './types';
import { hasResult } from './calibration';
import { teamOf, winnerOf } from './milestones';

// Which pair on tonight's sheet has the best (or worst) record as teammates.
//
// Read the caveats before extending this. It is a *record*, not a verdict:
// "won 5 of their 8 nights together" is a count, and the UI says exactly that
// rather than "these two click". The difference matters, because the data
// cannot support the stronger claim — see the note on sample size below.
export interface DuoFact {
  kind: 'together-better' | 'together-worse';
  aName: string;
  bName: string;
  together: number; // nights as teammates, with a result recorded
  won: number; // how many of those nights their team took
}

// Nights together before a pair is eligible at all.
export const MIN_TOGETHER = 4;

// The honest problem with MIN_TOGETHER = 4: it is far too few to *prove*
// anything. Detecting a genuinely large chemistry effect (say +0.5 wins a
// night) would need something like 45 nights together, and well over 100 once
// you account for there being ~105 possible pairs in a 15-player squad — test
// that many and the best-looking one is noise almost every time. Four nights
// at 100% isn't even surprising: at a ~2-in-3 base rate it happens by chance
// about one time in five.
//
// So the estimate is shrunk toward the base rate rather than taken at face
// value, weighted as if every pair started with SHRINK_K ordinary nights.
// **This is deliberately strong enough that MIN_TOGETHER rarely binds**: a
// 4-from-4 pair scores below a long 80% record, so in practice a pair needs
// something like 10–15 nights before it can surface at all. That's the data's
// constraint rather than a preference — the floor stays at 4 so early records
// are still collected and ranked, but a short one can't win on its own.
export const SHRINK_K = 20;

// How far from the base rate a shrunk record has to sit before it's worth a
// line. Without this, one pair is always "best" and the fact means nothing.
// Set with SHRINK_K in mind: at a 50% base a 4-from-4 pair shrinks to 0.583
// (an edge of 0.083) and so stays quiet, while a 15-from-20 pair reaches
// 0.625 and speaks. That gap is the whole point of the pair of constants.
export const MIN_EDGE = 0.1;

interface PairRecord {
  together: number;
  won: number;
}

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The most and least successful pairing among tonight's players.
 *
 * `tonightId` is excluded the same way it is for milestones — tonight's own
 * result, if already saved, shouldn't be folded into "their record coming in".
 *
 * Returns at most one of each kind, and nothing at all until some pair clears
 * both MIN_TOGETHER and MIN_EDGE, which on a young history means nothing for
 * a good while. That's intended.
 */
export function duoFacts(
  todays: Player[],
  history: FixtureRecord[],
  tonightId?: string | null,
): DuoFact[] {
  const past = tonightId ? history.filter((f) => f.id !== tonightId) : history;
  // guests carry a fresh id every visit, so a pair involving one can never
  // accumulate a record — same reasoning as milestones
  const squad = todays.filter((p) => !p.isGuest);
  const inSquad = new Set(squad.map((p) => p.id));
  const nameOf = new Map(squad.map((p) => [p.id, p.name]));

  const pairs = new Map<string, PairRecord>();
  let nights = 0;
  let nightsWon = 0;

  for (const fx of past) {
    if (!hasResult(fx.wins)) continue;
    const winner = winnerOf(fx);
    // only pairs who are both playing tonight are worth computing
    const present = squad.map((p) => p.id).filter((id) => teamOf(fx, id));
    for (const id of present) {
      nights++;
      if (teamOf(fx, id) === winner) nightsWon++;
    }
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const [x, y] = [present[i], present[j]];
        const color = teamOf(fx, x);
        if (color !== teamOf(fx, y)) continue; // opponents that night, not a pair
        const k = key(x, y);
        const rec = pairs.get(k) ?? { together: 0, won: 0 };
        rec.together++;
        if (color === winner) rec.won++;
        pairs.set(k, rec);
      }
    }
  }

  // The rate an ordinary night is won, measured rather than assumed — with
  // three teams it's near a third, but ties at the top drag it below that.
  const base = nights > 0 ? nightsWon / nights : 1 / 3;

  let best: { fact: DuoFact; score: number } | null = null;
  let worst: { fact: DuoFact; score: number } | null = null;

  for (const [k, rec] of pairs) {
    if (rec.together < MIN_TOGETHER) continue;
    const [x, y] = k.split('|');
    if (!inSquad.has(x) || !inSquad.has(y)) continue;
    const score = (rec.won + SHRINK_K * base) / (rec.together + SHRINK_K);
    const make = (kind: DuoFact['kind']): DuoFact => ({
      kind,
      aName: nameOf.get(x)!,
      bName: nameOf.get(y)!,
      together: rec.together,
      won: rec.won,
    });
    if (score >= base + MIN_EDGE && (!best || score > best.score)) {
      best = { fact: make('together-better'), score };
    }
    if (score <= base - MIN_EDGE && (!worst || score < worst.score)) {
      worst = { fact: make('together-worse'), score };
    }
  }

  return [best?.fact, worst?.fact].filter((f): f is DuoFact => !!f);
}
