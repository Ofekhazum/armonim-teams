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
//
// **A fifth term, `tier`, exists for one reason: on a young club, `career` and
// `momentum` are both structurally zero for almost everyone**, and every
// player on a shirt renders as the identical number for weeks. `momentum`
// needs `MIN_RECENT` nights before it answers at all; `career` is deliberately
// shrunk hard toward the club mean while `nightsBefore` is small, which is the
// same nights-before-anything-means-anything problem `marketValue.ts` solves
// by withholding a price for `MIN_HISTORY_FOR_VALUES` nights (§2.31).
//
// **This file does not take that route, on the organiser's explicit
// instruction, with the trade-off stated plainly rather than hidden:**
// `tier` reads the organiser's own private rating (§2.28) — the one thing this
// formula was built to keep out, and the one thing every other feature in this
// app (Market Value, the recap, `PlayerCompare`) goes out of its way never to
// touch. A coarse, capped, *decaying* bump is not the same exposure as
// publishing the rating itself, but it is not zero either: `night`, `mvp`,
// `career` and `momentum` are all computable by anyone from `GET /history`,
// which needs no password, so a bad-faith reader can reconstruct exactly what
// `tier + jitter` was on any night of theirs and average it over a season. A
// zero-mean per-night `jitter` (below) cancels under that average by
// construction — the tier bump does not, and a residual that survives
// averaging is recoverable in the end, by the law of large numbers, no matter
// how it is dressed up. `coldStartWeight` narrows the window this is true in —
// the bump fades to nothing by `FADE_NIGHTS`, so it is a temporary nudge
// during the exact weeks a club has nothing else to show, not a standing leak
// under an established player — but it does not make the window's exposure
// zero, only smaller and shorter. That is a knowingly accepted trade, not an
// oversight: raise it again before widening `FADE_NIGHTS` or `TIER_BUMP`.

import type { FixtureRecord, TeamColor } from './types';
import { hasResult } from './calibration';
import { ratingTier } from './marketValue';
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

// The cold-start nudge (see the file header for why this exists and what it
// costs). Small on purpose relative to `night` — this breaks a tie, it does
// not re-rank a team.
const TIER_BUMP: Record<ReturnType<typeof ratingTier>, number> = {
  bottom: -0.25,
  middle: 0,
  top: 0.25,
};

// Larger than TIER_BUMP's span, so a single night's number never *nakedly*
// announces which tier it came from — see JITTER below for what it is doing
// and, just as importantly, what it is not.
const JITTER_SPAN = 0.35;

/**
 * How many nights of not-quite-nothing this lasts.
 *
 * By `FADE_NIGHTS`, `career`'s shrinkage weight (`nightsBefore / (nightsBefore
 * + SHRINK_K)`) is past half, and `momentum` has had room to answer for a
 * while — real signal has taken over, and the nudge has finished handing off
 * to it. Chosen a little past `SHRINK_K` rather than at it, so the two do not
 * both still be finding their feet in the same week.
 */
const FADE_NIGHTS = 8;

/**
 * 1 on a debut, straight-line down to 0 by `FADE_NIGHTS` — smoothly, so a
 * player never sees a visible jump the week the nudge switches off. The taper
 * is also the reason `tier` is a *temporary* exposure rather than a standing
 * one: past `FADE_NIGHTS` this returns 0 and the rating stops entering the
 * arithmetic at all.
 */
const coldStartWeight = (nightsBefore: number): number =>
  clamp(1 - nightsBefore / FADE_NIGHTS, 0, 1);

/**
 * A small, stable "which way does this night's coin land" per player per
 * fixture — same two ids always produce the same number, so a reload or a
 * re-render never shows somebody a different mark for a night already filed.
 *
 * **This carries no information about anybody.** It is arithmetic over two
 * public ids, nothing about the player feeds it, and its only job is to keep
 * `tier`'s ±0.25 from being nakedly readable as itself on a single night. It
 * is exactly the part of this scheme that is safe — see the file header for
 * the part that is not.
 */
function jitterOf(fixtureId: string, playerId: string): number {
  let h = 2166136261; // FNV-1a offset basis
  for (const ch of `${fixtureId} ${playerId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const unit = (h >>> 0) / 0xffffffff; // → [0, 1)
  return (unit * 2 - 1) * JITTER_SPAN; // → [-JITTER_SPAN, JITTER_SPAN)
}

export interface GradeParts {
  night: number;
  mvp: number;
  career: number;
  momentum: number;
  /** The cold-start nudge — see the file header before touching either. */
  tier: number;
  jitter: number;
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
      const rating = fx.players.find((p) => p.id === id)?.rating ?? 3;
      const coldStart = coldStartWeight(nightsBefore);
      // `+ 0` rather than a bare product: `negative * 0` is `-0` in IEEE754,
      // and a mark that is exactly BASE past FADE_NIGHTS should read as
      // ordinary 0 rather than surface a sign nobody put there.
      const tier = TIER_BUMP[ratingTier(rating)] * coldStart + 0;
      const jitter = jitterOf(fx.id, id) * coldStart + 0;
      const parts: GradeParts = { night, mvp: isMvp ? MVP_BONUS : 0, career, momentum, tier, jitter };
      const grade = clamp(
        round(BASE + parts.night + parts.mvp + parts.career + parts.momentum + parts.tier + parts.jitter),
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
  TIER_BUMP,
  JITTER_SPAN,
  FADE_NIGHTS,
};
