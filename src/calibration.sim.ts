// A synthetic league, for measuring the rating estimator against a known truth.
//
// Nothing in the app imports this — it exists so `calibration.test.ts` and the
// tuning reports under `scripts/` run the *same* simulator, rather than each
// keeping its own copy that quietly drifts from the other.
//
// Why it's worth a file of its own. Every documented trade-off in
// `calibration.ts` — LAMBDA, MIN_IMPLIED_DELTA, RATING_BIAS — was measured
// through a simulator, so the simulator is part of the evidence. A flaw in it
// is a flaw in all of them at once, and that has happened: the original version
// drew teams with `sort(() => rnd() - 0.5)`, which is not a shuffle. It leaves
// the array close to where it started, so the strongest player landed on black
// 46% of the time instead of a third, and every table tuned through it was
// measuring a league that does not exist. Hence `shuffle` below, and hence this
// note.

import { TEAM_COLORS } from './balancer';
import type { FixtureRecord, Player, TeamColor, TeamWins } from './types';

// --- Randomness ------------------------------------------------------------

// A plain LCG. Seeded on purpose: a statistical failure has to be reproducible
// or it cannot be investigated.
let seed = 12345;
export const setSeed = (n: number) => {
  seed = n;
};
export const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

// Fisher-Yates. Every ordering equally likely — which `sort` with a random
// comparator very much does not give you.
export function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- The league ------------------------------------------------------------

export interface Spec {
  id: string;
  name: string;
  rated: number; // what their profile says
  truth: number; // what they actually are — the gap is what we try to detect
}

export const mkPlayers = (specs: Spec[]): Player[] =>
  specs.map((s) => ({ id: s.id, name: s.name, rating: s.rated, attack: 50, chemistry: [] }));

export type TeamMode =
  // Shirts drawn out of a hat. Not how any club picks sides, but it is the
  // easiest case for the estimator: who plays with whom is independent of
  // ability, so a player's results are not confounded by their team-mates'.
  | 'random'
  // What a balancer actually does: draw, and keep the draw that comes out
  // most level on the ratings the organiser typed. This is the case that
  // matters, and it is harder — a player rated too high is systematically
  // given weaker team-mates to compensate, which hides exactly the error we
  // are hunting for.
  | 'balanced';

export interface SeasonOpts {
  teams?: TeamMode;
  // How many matches each pair of teams plays. The house rotation is three
  // teams taking turns, and the club's recorded nights run to ~11-12 wins
  // between them, so four is life-sized; two was the old default and is half
  // the evidence per night.
  matchesPerPairing?: number;
  // Share of matches settled on penalties, which the house rule scores as half
  // a win each side... to the winner.
  shootoutRate?: number;
  // How many balanced draws to consider before picking the most level one.
  balanceTries?: number;
}

const PAIRS: [TeamColor, TeamColor][] = [
  ['black', 'white'],
  ['blue', 'black'],
  ['white', 'blue'],
];

type Teams = Record<TeamColor, string[]>;

const split = (ids: string[]): Teams => {
  const per = Math.floor(ids.length / 3);
  return {
    black: ids.slice(0, per),
    white: ids.slice(per, per * 2),
    blue: ids.slice(per * 2, per * 3),
  };
};

// How far apart the three teams are on paper — the thing a balancer minimises.
const ratedSpread = (teams: Teams, ratedOf: Map<string, number>): number => {
  const avgs = TEAM_COLORS.map((c) => {
    const ids = teams[c];
    return ids.length ? ids.reduce((t, id) => t + (ratedOf.get(id) ?? 0), 0) / ids.length : 0;
  });
  return Math.max(...avgs) - Math.min(...avgs);
};

function drawTeams(specs: Spec[], mode: TeamMode, tries: number): Teams {
  const ids = specs.map((s) => s.id);
  if (mode === 'random') return split(shuffle(ids));

  const ratedOf = new Map(specs.map((s) => [s.id, s.rated]));
  let best = split(shuffle(ids));
  let bestSpread = ratedSpread(best, ratedOf);
  for (let i = 1; i < tries; i++) {
    const cand = split(shuffle(ids));
    const s = ratedSpread(cand, ratedOf);
    if (s < bestSpread) {
      best = cand;
      bestSpread = s;
    }
  }
  return best;
}

// Simulates `nights` fixtures for a league whose *true* ability may differ from
// the rating on their profile. The gap between the two is exactly what
// `suggestRatings` is supposed to find.
export function season(specs: Spec[], nights: number, opts: SeasonOpts = {}): FixtureRecord[] {
  const {
    teams: mode = 'random',
    matchesPerPairing = 2,
    shootoutRate = 0.2,
    balanceTries = 30,
  } = opts;
  const truthOf = new Map(specs.map((s) => [s.id, s.truth]));

  return Array.from({ length: nights }, (_, n) => {
    const teams = drawTeams(specs, mode, balanceTries);
    const avg = (c: TeamColor) =>
      teams[c].reduce((t, id) => t + truthOf.get(id)!, 0) / teams[c].length;
    const wins: TeamWins = { black: 0, white: 0, blue: 0 };
    for (const [c, d] of PAIRS) {
      for (let m = 0; m < matchesPerPairing; m++) {
        // The same logistic the estimator assumes, so a failure to recover the
        // truth is a failure of the estimator and not of a model mismatch.
        const p = 1 / (1 + 10 ** ((avg(d) - avg(c)) / 2));
        wins[rnd() < p ? c : d] += rnd() < shootoutRate ? 0.5 : 1;
      }
    }
    return {
      id: `fx${n}`,
      date: `2026-01-0${(n % 9) + 1}`,
      teams,
      players: specs.map((s) => ({ id: s.id, name: s.name, rating: s.rated })),
      wins,
    };
  });
}

// --- Ready-made rosters ----------------------------------------------------

// Fifteen players all rated 3 and all genuinely a 3: the null case, where the
// correct number of suggestions is zero.
export const flat: Spec[] = Array.from({ length: 15 }, (_, i) => ({
  id: `p${i}`,
  name: `P${i}`,
  rated: 3,
  truth: 3,
}));

// The same league with p0 secretly a 5 and p1 secretly a 1.
export const mis: Spec[] = flat.map((s) =>
  s.id === 'p0' ? { ...s, truth: 5 } : s.id === 'p1' ? { ...s, truth: 1 } : s,
);

// A realistically spread squad — a couple of genuinely strong players, a long
// ordinary middle, a couple who are there for the football. Everyone rated
// exactly right, so it is the null case for a league that is *not* flat, which
// is where the balancer's compensation actually bites.
export const spread: Spec[] = [5, 4.5, 4, 4, 3.5, 3.5, 3, 3, 3, 3, 2.5, 2.5, 2, 2, 1.5].map(
  (r, i) => ({ id: `p${i}`, name: `P${i}`, rated: r, truth: r }),
);

// `spread`, but one named player is secretly `by` stars off their rating.
export const withError = (id: string, by: number, from: Spec[] = spread): Spec[] =>
  from.map((s) => (s.id === id ? { ...s, truth: s.truth + by } : s));
