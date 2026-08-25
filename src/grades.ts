// A mark out of ten for every player on a filed night (§2.39).
//
// **The number is arithmetic. Only the sentence is written by a model.** Same
// split as Market Value (§2.31): the app computes something defensible and the
// model is handed the finished figure and told to explain it. A model asked to
// invent the grade would be inventing the one thing the data cannot support —
// see below.
//
// **What a night actually knows about one player.** `MatchLogEntry` records
// `{a, b, winner, viaPenalties}` — team colours, not people. Every match, every
// shootout and every sequence is therefore *identical* for the five players on
// a shirt. On a single night exactly one thing distinguishes teammates: the MVP
// pick. Everything else that differs between them is history.
//
// So the grade is built from four terms, and only two of them can separate
// teammates at all:
//
//   night     the team's result, shared by all five, and dominant
//   mvp       the one true per-night personal signal
//   career    where their record sits against the club's
//   momentum  where their last few nights sit against their own record
//
// **Why "did they beat their own baseline tonight" is not one of them.**
// Measured on the invented club, a single night swings a player's per-night
// figure by −2.0 to +2.4 (p10–p90) while the gap between the club's best and
// worst player is 1.61. One night is mostly luck. Worse, that term inverts:
// on an identical night the weakest player "overperforms" by more than the
// strongest, so over a season every player averages the same mark and the best
// players score lowest on ordinary wins. The personal-expectation angle is
// real and worth saying — it belongs in the *sentence*, where it can be
// qualitative, not in the number, where it would be backwards.
//
// **Momentum is safe for the opposite reason.** Averaged over several nights
// it is far less noisy, it is measured against each player's *own* baseline so
// it favours nobody, and it mean-reverts: per-player season averages land
// between −0.30 and +0.21 on the sandbox. It adds movement, not bias.

import type { FixtureRecord, TeamColor } from './types';
import { hasResult } from './calibration';
import { placeOf, profileNights, shirtOf, type Place } from './playerProfile';

/**
 * Where an ordinary night lands.
 *
 * Six rather than the arithmetic midpoint of the scale. A 1–10 centred on 5.5
 * is technically balanced and reads as mean: most nights are unremarkable, so
 * most marks sat at 5 and below, and a group reading their own marks every week
 * would be told they were average-to-poor most of the time. Six leaves the same
 * spread and the same ordering — it moves where "nothing special happened"
 * sits, which is a judgement about tone, not about the football.
 */
export const BASE = 6;
export const GRADE_MIN = 1;
export const GRADE_MAX = 10;

/**
 * The night's result, relative to that night's own size.
 *
 * Relative on purpose: four wins on a nine-match night is not four wins on a
 * thirteen-match night, and the club plays both. A team taking exactly its
 * share of a night scores 0 here.
 */
const NIGHT_W = 2.3;
const NIGHT_CAP = 2.5;

/** The only thing on this list that is about a person rather than a team. */
const MVP_BONUS = 1;

// Both historical terms are shrunk toward the club mean, the same move
// `duos.ts` and `marketValue.ts` make: a player three nights into their career
// should sit near the middle rather than at whichever extreme those three
// nights happened to produce.
const SHRINK_K = 6;

// Raw spread measured on the invented club: career sits within about ±0.65
// wins/night of the club mean, momentum within about ±1.1 of a player's own
// baseline. The weights below turn those into grade points, and the caps stop
// one freak run from swamping the night itself.
const CAREER_W = 0.75;
const CAREER_CAP = 0.5;
const MOMENTUM_W = 0.65;
const MOMENTUM_CAP = 0.7;

/** How many nights back "recent form" looks, and the fewest it will answer on. */
export const RECENT_NIGHTS = 5;
export const MIN_RECENT = 3;

/** How far from their own baseline a run has to be before it is worth a word. */
const TREND_EDGE = 0.4;

export type Trend = 'hot' | 'cold' | 'steady';

export interface GradeParts {
  night: number;
  mvp: number;
  career: number;
  momentum: number;
}

/**
 * Everything the sentence-writer is allowed to know about this player.
 *
 * Counts only, and every one of them is either tonight's result or something
 * that happened *before* tonight — never a rating, and never a verdict. The
 * model's job is to phrase these, not to add to them.
 */
export interface GradeContext {
  shirt: TeamColor;
  teamWins: number;
  place: Place;
  /** Whether their team took the night outright — level at the top is nobody. */
  wonNight: boolean;
  isMvp: boolean;
  /** Nights on record *before* tonight. 0 means this was a debut. */
  nightsBefore: number;
  /** Their own wins per night coming in, or null on a debut. */
  baseline: number | null;
  /** Mean wins per night over the last few, or null below MIN_RECENT. */
  recent: number | null;
  trend: Trend | null;
  /** Winning nights in a row coming into tonight. */
  runBefore: number;
  /** Nights since their team last took one, coming in. */
  droughtBefore: number;
}

export interface Grade {
  id: string;
  name: string;
  /** 1–10, to the nearest half. */
  grade: number;
  parts: GradeParts;
  context: GradeContext;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** To the nearest half — a mark out of ten is not a measurement to two places. */
const round = (n: number) => Math.round(n * 2) / 2;

/**
 * Grades for one filed night, or `null` when the night has no result.
 *
 * Every historical term is read from the nights *before* this one. Tonight is
 * already the `night` term; letting it into the baseline as well would mean a
 * good night quietly raising the bar it is being measured against.
 */
export function nightGrades(history: FixtureRecord[], fixtureId: string): Grade[] | null {
  const byDate = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const fx = byDate.find((f) => f.id === fixtureId);
  if (!fx || !hasResult(fx.wins)) return null;

  const past = byDate.filter((f) => f.date < fx.date || (f.date === fx.date && f.id !== fx.id));

  // The club's own wins-per-night, over every player-night before tonight.
  let totalWins = 0;
  let totalNights = 0;
  const everyone = new Set<string>();
  for (const f of past) for (const c of ['black', 'white', 'blue'] as TeamColor[]) for (const id of f.teams[c]) everyone.add(id);
  for (const id of everyone) {
    for (const n of profileNights(past, id)) {
      totalWins += n.wins;
      totalNights++;
    }
  }
  const clubMean = totalNights > 0 ? totalWins / totalNights : 0;

  // The night's own size, so a short evening is not graded as a bad one.
  const matches = (['black', 'white', 'blue'] as TeamColor[]).reduce((s, c) => s + (fx.wins[c] ?? 0), 0);
  const fairShare = matches / 3;

  const out: Grade[] = [];
  for (const c of ['black', 'white', 'blue'] as TeamColor[]) {
    const teamWins = fx.wins[c] ?? 0;
    const place = placeOf(fx.wins, c);
    // Relative to the night's own average, then capped.
    const night = clamp(
      fairShare > 0 ? NIGHT_W * ((teamWins - fairShare) / fairShare) : 0,
      -NIGHT_CAP,
      NIGHT_CAP,
    );

    for (const id of fx.teams[c]) {
      const before = profileNights(past, id);
      const nightsBefore = before.length;

      let career = 0;
      let momentum = 0;
      let baseline: number | null = null;
      let recent: number | null = null;
      let trend: Trend | null = null;

      if (nightsBefore > 0) {
        const sum = before.reduce((s, n) => s + n.wins, 0);
        const shrunk = (sum + SHRINK_K * clubMean) / (nightsBefore + SHRINK_K);
        baseline = sum / nightsBefore;
        career = clamp(CAREER_W * (shrunk - clubMean), -CAREER_CAP, CAREER_CAP);

        if (nightsBefore >= MIN_RECENT) {
          const window = before.slice(-RECENT_NIGHTS);
          recent = window.reduce((s, n) => s + n.wins, 0) / window.length;
          const raw = recent - shrunk;
          momentum = clamp(MOMENTUM_W * raw, -MOMENTUM_CAP, MOMENTUM_CAP);
          trend = raw > TREND_EDGE ? 'hot' : raw < -TREND_EDGE ? 'cold' : 'steady';
        }
      }

      const isMvp = fx.mvpId === id;
      const parts: GradeParts = { night, mvp: isMvp ? MVP_BONUS : 0, career, momentum };
      const grade = clamp(
        round(BASE + parts.night + parts.mvp + parts.career + parts.momentum),
        GRADE_MIN,
        GRADE_MAX,
      );

      // Coming in: a live winning run, or nights since their team last took one.
      let runBefore = 0;
      for (let i = before.length - 1; i >= 0 && before[i].won; i--) runBefore++;
      let droughtBefore = 0;
      for (let i = before.length - 1; i >= 0 && before[i].won === false; i--) droughtBefore++;

      out.push({
        id,
        name: fx.players.find((p) => p.id === id)?.name ?? '?',
        grade,
        parts,
        context: {
          shirt: c,
          teamWins,
          place,
          wonNight: place === 1 && !hasTie(fx, teamWins),
          isMvp,
          nightsBefore,
          baseline,
          recent,
          trend,
          runBefore,
          droughtBefore,
        },
      });
    }
  }

  return out.sort((a, b) => b.grade - a.grade || a.name.localeCompare(b.name, 'he'));
}

// Level at the top means nobody took the night (§2.6), so nobody on it gets to
// be told they won one.
const hasTie = (fx: FixtureRecord, teamWins: number): boolean =>
  (['black', 'white', 'blue'] as TeamColor[]).filter((c) => (fx.wins[c] ?? 0) === teamWins).length > 1;

/** Exported for the calibration pass and the tests; never shown to a player. */
export const gradeConstants = {
  BASE,
  NIGHT_W,
  NIGHT_CAP,
  MVP_BONUS,
  CAREER_W,
  CAREER_CAP,
  MOMENTUM_W,
  MOMENTUM_CAP,
  SHRINK_K,
  RECENT_NIGHTS,
  MIN_RECENT,
};
