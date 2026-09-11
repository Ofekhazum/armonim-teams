// Why was the night uneven? (§2.54)
//
// The complaint this answers is a real one: night after night, one team runs
// away with it, one hangs on, and one is never in it. The obvious reading is
// that the teams were badly made — and the whole point of this file is that
// the obvious reading is usually wrong.
//
// **The format does most of it.** A night is played winner-stays-on: the
// winning team keeps the pitch and the resting team comes on. That produces a
// lopsided-looking tally from teams that are exactly equal, for two reasons
// stacked on each other. Twelve matches shared between three teams is about
// eight each, and eight coin flips come out 6–2 often enough to feel like a
// pattern. Then the rotation adds a feedback loop on top: the team that is
// winning is also *on the pitch more*, so it collects more wins per hour than
// its win rate alone would give. Measured over 4000 simulated nights between
// fifteen identical players:
//
//   top-to-bottom win spread │ median 3.5 │ p75 4.5 │ p90 6 │ max 11
//   nights with a 5+ spread  │ 24%
//   nights with a 7+ spread  │ 5%
//
// So "8/3/1" is not evidence of anything on its own. Before a sheet can be
// blamed, the night has to be lopsided by more than the format alone manages.
//
// **What this file does.** It puts four different nights side by side, all
// measured in the same unit — wins of spread between the best and worst team:
//
//   1. `equal`  — what the format produces from teams that are truly level
//   2. `paper`  — what it produces from the teams *as the balancer rated them*
//   3. `real`   — the same, with each player's measured rating error added in
//   4. `actual` — what happened
//
// The gaps between them are the diagnosis, and each one points somewhere
// different. `paper − equal` is the sheet being uneven on paper, which is a
// team-making problem. `real − paper` is the sheet being level on paper but
// not in life, which is a *ratings* problem and is what `calibration.ts` is
// for. `actual − real` is the night itself — luck, and nothing to fix.
//
// **It says "I don't know" a lot, on purpose.** Rating errors carry standard
// errors, and on a five-night history those are wide enough that step 3 is
// mostly silence. That is the honest answer at this much football, and §2.49
// is the long story of what happens when a tool in this area pretends
// otherwise.

import { TEAM_COLORS } from './balancer';
import { expectedShare, hasResult, ratingErrors, totalWins } from './calibration';
import { pointsFor, restingTeam } from './matchLog';
import type { FixtureRecord, MatchLogEntry, Player, TeamColor } from './types';

// --- Reading a night's shape -----------------------------------------------

// Wins per team, sorted, top minus bottom. The headline number, and the one
// that misleads — which is why nothing here reports it without a reference.
export const winSpread = (wins: Record<TeamColor, number>): number => {
  const sorted = TEAM_COLORS.map((c) => wins[c] ?? 0).sort((a, b) => b - a);
  return sorted[0] - sorted[sorted.length - 1];
};

// How many matches the night actually took, and how many of those went to
// penalties. Exact from a log; estimated from a tally, where the two are not
// separable — a shootout is worth half a win, so a night of twelve matches
// with four shootouts records the same ten points as a night of ten decisive
// ones. Tally-only nights are marked `estimated` and every number derived from
// them is offered with that caveat attached.
export interface NightShape {
  matches: number;
  shootoutRate: number;
  estimated: boolean;
}

export function nightShape(fx: FixtureRecord): NightShape {
  const log = fx.matchLog;
  if (log && log.length) {
    return {
      matches: log.length,
      shootoutRate: log.filter((m) => m.viaPenalties).length / log.length,
      estimated: false,
    };
  }
  // Without a log the best available reading is that every match was decisive,
  // which undercounts whenever one wasn't. It is close enough to place a night
  // against a reference distribution and not close enough to pretend it is
  // exact.
  return { matches: Math.max(1, Math.round(totalWins(fx.wins))), shootoutRate: 0, estimated: true };
}

// Matches played per team, which the tally alone can never say. A team on
// eight wins from ten matches and one on three from six are far closer than
// "8 and 3" makes them sound, and this is the number that shows it.
export function playedFromLog(log: MatchLogEntry[]): Record<TeamColor, number> {
  const played: Record<TeamColor, number> = { black: 0, white: 0, blue: 0 };
  for (const m of log) {
    played[m.a]++;
    played[m.b]++;
  }
  return played;
}

// --- Simulating the format -------------------------------------------------

// A plain LCG, seeded per call. Deterministic on purpose: a percentile that
// changed every time the panel re-rendered would be worse than no percentile.
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

// Turns a fixture id into a stable seed, so a given night always reads the
// same way on every device and every reload.
const seedOf = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 4294967296;
};

// One night, played the house way. `strength` is each team's rating average;
// pass the same number three times for the "what would equal teams do" case.
//
// The rotation rule comes from `matchLog.ts` rather than being restated here,
// because the whole value of this simulation is that it plays the night the
// way the club actually plays it. If the house rule ever changes, this follows
// it automatically instead of silently measuring the old one.
function simulateNight(
  strength: Record<TeamColor, number>,
  shape: NightShape,
  rand: () => number,
): Record<TeamColor, number> {
  const wins: Record<TeamColor, number> = { black: 0, white: 0, blue: 0 };
  let a: TeamColor = 'black';
  let b: TeamColor = 'white';
  for (let i = 0; i < shape.matches; i++) {
    const p = expectedShare(strength[a], strength[b]);
    const winner: TeamColor = rand() < p ? a : b;
    wins[winner] += rand() < shape.shootoutRate ? 0.5 : 1;
    [a, b] = [winner, restingTeam(a, b)];
  }
  return wins;
}

export interface SpreadReference {
  median: number;
  p25: number;
  p75: number;
  p90: number;
  // Where a given spread sits in this distribution, 0–100. 50 is dead
  // ordinary; 95 means only one night in twenty comes out this lopsided.
  percentileOf: (spread: number) => number;
}

const RUNS = 1200;

// The distribution of spreads this night's shape produces, given these team
// strengths. Built by simulation rather than derived, because winner-stays-on
// has no closed form worth the trouble — the feedback loop between winning and
// playing again is the entire thing being measured.
export function spreadReference(
  strength: Record<TeamColor, number>,
  shape: NightShape,
  seed: number,
): SpreadReference {
  const rand = rng(seed || 1);
  const spreads: number[] = [];
  for (let r = 0; r < RUNS; r++) spreads.push(winSpread(simulateNight(strength, shape, rand)));
  spreads.sort((x, y) => x - y);
  const at = (q: number) => spreads[Math.min(spreads.length - 1, Math.floor(q * spreads.length))];
  return {
    median: at(0.5),
    p25: at(0.25),
    p75: at(0.75),
    p90: at(0.9),
    percentileOf: (spread) => {
      const below = spreads.filter((s) => s < spread).length;
      const equal = spreads.filter((s) => s === spread).length;
      // midpoint of the tied band, so a common whole-number spread doesn't
      // read as either the bottom or the top of everything that matches it
      return (100 * (below + equal / 2)) / spreads.length;
    },
  };
}

// --- The sheet, as it was actually scored ----------------------------------

// A team's rating average the way the balancer computed it on the night: the
// ratings *as they stood then* (`fx.players`), with anybody who was keeping
// goal left out of the outfield average entirely.
//
// The keeper rule is why `gkIds` is stored on a fixture at all. A stand-in
// keeper's outfield rating is excluded from their team's average by
// `teamStats`, so a sheet with one reads several tenths of a star different
// from the plain mean — and that difference is not recoverable afterwards.
// Whether somebody is a *permanent* keeper is read from the current roster,
// which is the one thing here that can drift; it changes rarely, and when it
// does it moves one player on one night.
export function paperAverage(
  fx: FixtureRecord,
  color: TeamColor,
  byId: Map<string, Player>,
): number {
  const ratingOf = new Map(fx.players.map((p) => [p.id, p.rating]));
  const inGoal = new Set(fx.gkIds ?? []);
  let sum = 0;
  let counted = 0;
  for (const id of fx.teams[color]) {
    const rating = ratingOf.get(id);
    if (rating == null) continue;
    // a permanent keeper's rating counts normally; an outfield player standing
    // in does not contribute an outfield rating at all
    if (inGoal.has(id) && !byId.get(id)?.isGk) continue;
    sum += rating;
    counted++;
  }
  return counted ? sum / counted : 0;
}

// --- One night's diagnosis -------------------------------------------------

export type Cause =
  // the night is within what the format does to level teams — nothing to fix
  | 'format'
  // the sheet was genuinely uneven before a ball was kicked
  | 'sheet'
  // level on paper, but somebody is not the player their rating says
  | 'ratings'
  // lopsided beyond the format, and the evidence cannot say which of the two
  | 'unclear';

export interface NightDiagnosis {
  id: string;
  date: string;
  shape: NightShape;
  wins: Record<TeamColor, number>;
  actual: number;
  /** Matches played and win rate — only a logged night can say. */
  played: Record<TeamColor, number> | null;
  winRate: Record<TeamColor, number> | null;
  /** Team averages as the balancer scored them, and the gap between them. */
  paper: Record<TeamColor, number>;
  paperGap: number;
  /**
   * Whether the night recorded who was in goal. Without it the paper average
   * is a plain mean, which differs from what the balancer scored whenever an
   * outfield player kept goal — so the panel labels those as approximate
   * rather than quietly presenting a number the balancer never saw.
   */
  gkKnown: boolean;
  /** The same teams with each player's measured rating error folded in. */
  real: Record<TeamColor, number>;
  realGap: number;
  /**
   * How the rating evidence came out for this night. Three states, not two —
   * "we cannot see" and "we looked and there is nothing there" are different
   * findings, and a tool that reports the second as the first would go on
   * saying "not enough nights" forever on a history that had long since become
   * conclusive.
   */
  ratingVerdict: 'blind' | 'level' | 'error';
  /** Correction the ratings imply between the strongest and weakest team. */
  ratingCorrection: number;
  /** Half-width of the 95% interval on that correction, in stars. */
  ratingMargin: number;
  /** Expected spreads, all in wins, all from this night's own shape. */
  equalSpread: number;
  paperSpread: number;
  realSpread: number;
  /** Where the night landed against level teams, 0–100. */
  percentile: number;
  cause: Cause;
}

// A sheet this far apart on paper is doing something to the football. Not a
// tuned constant — it is the point where the win model says the stronger team
// takes about 57% of its matches, which is roughly one extra win over a night
// and the smallest gap worth a word.
const PAPER_GAP_NOTABLE = 0.25;

// Above this percentile against level teams, the night is lopsided enough to
// be worth explaining. Below it, the format alone accounts for the night and
// the honest answer is that nothing happened.
const LOPSIDED_PERCENTILE = 75;

// How much of the uncertainty a rating correction has to survive before it is
// allowed to explain a night. The same 95% interval `calibration.ts` gates
// suggestions on, and for the same reason.
const EVIDENCE_K = 1.96;

// How tight the interval has to be before "we found nothing" is a finding
// rather than an admission. Twice the gap worth acting on: if a correction
// that size would have cleared the bar and didn't, the teams really were
// level. Measured on a forty-night club the margin is still about 1.4 stars,
// so in practice this stays out of reach for a long time — which is the
// honest state of affairs, not a defect.
const RATING_VISIBLE_MARGIN = 0.5;

export function diagnoseNight(
  fx: FixtureRecord,
  byId: Map<string, Player>,
  errorOf: (id: string) => { delta: number; se: number } | undefined,
): NightDiagnosis {
  const shape = nightShape(fx);
  const seed = seedOf(fx.id);
  const wins = { black: fx.wins.black ?? 0, white: fx.wins.white ?? 0, blue: fx.wins.blue ?? 0 };

  const paper = {} as Record<TeamColor, number>;
  const real = {} as Record<TeamColor, number>;
  // Uncertainty on each team's *average* error, which is the quantity this
  // section actually compares — not on any one player's. Averaging five
  // estimates is a good deal more certain than any of them alone, so judging
  // the team by its shakiest member (the first thing tried here) let one
  // player with a thin record silence a night the evidence could speak about.
  const teamSe = {} as Record<TeamColor, number>;
  for (const c of TEAM_COLORS) {
    paper[c] = paperAverage(fx, c, byId);
    const ids = fx.teams[c];
    // A team's real strength is its paper strength plus whatever error the
    // estimator has attributed to the players in it — averaged, because that
    // is the unit `paper` is in.
    let sum = 0;
    let varSum = 0;
    for (const id of ids) {
      const e = errorOf(id);
      sum += e?.delta ?? 0;
      varSum += (e?.se ?? 0) ** 2;
    }
    real[c] = paper[c] + (ids.length ? sum / ids.length : 0);
    // se of a mean. Treats the five as independent, which slightly overstates
    // the certainty — they are all fitted off the same nights — but it is far
    // closer than either taking the worst or ignoring the question.
    teamSe[c] = ids.length ? Math.sqrt(varSum) / ids.length : 0;
  }

  const flat = { black: 3, white: 3, blue: 3 } as Record<TeamColor, number>;
  const equalRef = spreadReference(flat, shape, seed);
  const paperRef = spreadReference(paper, shape, seed + 1);
  const realRef = spreadReference(real, shape, seed + 2);

  const actual = winSpread(wins);
  const percentile = equalRef.percentileOf(actual);
  const paperGap = Math.max(...TEAM_COLORS.map((c) => paper[c])) - Math.min(...TEAM_COLORS.map((c) => paper[c]));
  const realGap = Math.max(...TEAM_COLORS.map((c) => real[c])) - Math.min(...TEAM_COLORS.map((c) => real[c]));

  // Is the correction the ratings imply bigger than the uncertainty on it? The
  // same interval test `suggestRatings` uses, asked of a team rather than a
  // player: how far the strongest and weakest teams' average errors sit apart,
  // against the error bar on that difference. On a short history it never
  // clears, and the panel says so rather than drawing a confident bar over
  // noise — which is the whole lesson of §2.49–§2.50.
  const byReal = [...TEAM_COLORS].sort((a, b) => real[b] - real[a]);
  const [strongest, weakest] = [byReal[0], byReal[byReal.length - 1]];
  const ratingCorrection =
    real[strongest] - paper[strongest] - (real[weakest] - paper[weakest]);
  const ratingMargin = EVIDENCE_K * Math.sqrt(teamSe[strongest] ** 2 + teamSe[weakest] ** 2);
  const ratingVerdict: NightDiagnosis['ratingVerdict'] =
    Math.abs(ratingCorrection) >= ratingMargin && Math.abs(ratingCorrection) >= PAPER_GAP_NOTABLE
      ? 'error'
      : // Only claim "nothing there" when the interval is tight enough that a
        // correction worth acting on would have shown up. Wider than that and
        // the honest answer is that we cannot see, not that there is nothing.
        ratingMargin <= RATING_VISIBLE_MARGIN
        ? 'level'
        : 'blind';
  const ratingUncertain = ratingVerdict !== 'error';

  let cause: Cause = 'format';
  if (percentile >= LOPSIDED_PERCENTILE) {
    if (paperGap >= PAPER_GAP_NOTABLE) cause = 'sheet';
    else if (!ratingUncertain && realGap >= PAPER_GAP_NOTABLE) cause = 'ratings';
    else cause = 'unclear';
  }

  const log = fx.matchLog;
  const played = log && log.length ? playedFromLog(log) : null;
  const winRate = played
    ? (Object.fromEntries(
        TEAM_COLORS.map((c) => [c, played[c] ? wins[c] / played[c] : 0]),
      ) as Record<TeamColor, number>)
    : null;

  return {
    id: fx.id,
    date: fx.date,
    shape,
    wins,
    actual,
    played,
    winRate,
    paper,
    paperGap,
    gkKnown: fx.gkIds !== undefined,
    real,
    realGap,
    ratingVerdict,
    ratingCorrection,
    ratingMargin,
    equalSpread: equalRef.median,
    paperSpread: paperRef.median,
    realSpread: realRef.median,
    percentile,
    cause,
  };
}

// --- The season ------------------------------------------------------------

export interface SeasonDiagnosis {
  nights: NightDiagnosis[];
  /** Median spread actually seen, and what level teams would have given. */
  medianActual: number;
  medianEqual: number;
  /** Share of nights that were lopsided beyond what the format explains. */
  lopsidedShare: number;
  /**
   * What that share would be if the team-making were perfect — which is *not*
   * zero. The threshold is the format's own 75th percentile, so a quarter of
   * nights clear it however well the teams are made. Reporting the share
   * without this baseline beside it would turn an ordinary season into an
   * accusation, which is the exact mistake this whole file exists to avoid.
   */
  expectedLopsidedShare: number;
  /** How many nights it would take before that share means anything. */
  nightsForConfidence: number;
  /** True when there is not yet enough football to say anything at all. */
  inconclusive: boolean;
}

// Nights needed before a mild lean is distinguishable from luck. A night is a
// coin flip against the format's own 75th percentile, so telling a 25% rate
// from a 40% one is a proportion test — and that needs about this many. Kept
// as a plain number because the exact figure moves with how big a lean you
// care about, and being told "about a dozen" is the useful part.
const NIGHTS_FOR_CONFIDENCE = 12;

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function diagnoseSeason(history: FixtureRecord[], players: Player[]): SeasonDiagnosis {
  const byId = new Map(players.map((p) => [p.id, p]));
  const played = history.filter((fx) => hasResult(fx.wins));
  const errors = ratingErrors(played, (id) => byId.get(id)?.rating ?? null);
  const nights = played
    .map((fx) => diagnoseNight(fx, byId, (id) => errors.get(id)))
    .sort((a, b) => b.date.localeCompare(a.date));

  const lopsided = nights.filter((n) => n.percentile >= LOPSIDED_PERCENTILE).length;
  return {
    nights,
    medianActual: median(nights.map((n) => n.actual)),
    medianEqual: median(nights.map((n) => n.equalSpread)),
    lopsidedShare: nights.length ? lopsided / nights.length : 0,
    expectedLopsidedShare: (100 - LOPSIDED_PERCENTILE) / 100,
    nightsForConfidence: NIGHTS_FOR_CONFIDENCE,
    inconclusive: nights.length < NIGHTS_FOR_CONFIDENCE,
  };
}
