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
// **A fifth term, `tier`, is a permanent structural component and reads the
// organiser's private rating (§2.28)** — the one input every other feature in
// this app (Market Value, the recap, `PlayerCompare`) goes out of its way never
// to touch. It is here on the organiser's explicit and repeated instruction,
// and the reasoning behind it is theirs: a better player should mark higher
// than a weaker one on a comparable night, the ratings are actively maintained
// as players improve or decline, and a grade that ignored them would be
// fighting those updates rather than reflecting them.
//
// **The cost, stated plainly rather than buried.** `night`, `mvp`, `career` and
// `momentum` are all computable by anyone from `GET /history`, which needs no
// password. So the residual `grade − (those four)` is `tier` exactly, on every
// night a player has played — **a determined reader can recover which third of
// the club the organiser puts somebody in**, and since 2026-08-28 they can do it
// from a single night rather than by averaging a season.
//
// A zero-mean `jitter` used to sit in that residual. It never actually helped:
// averaging is what recovers `tier`, and averaging is precisely what removes a
// zero-mean hash, so it hid one night at a time against an attack that reads
// many. It was removed once it started cancelling the rating it was shading —
// see the note where it used to be defined. This was measured, argued and
// overruled deliberately, three times now; it is an accepted product trade,
// not an oversight.
//
// An earlier version faded this out by `FADE_NIGHTS`, which capped the exposure
// at a short window. That was removed on purpose: a fading bump means an
// improving player's updated rating stops reaching their marks precisely once
// they have played enough for the update to be based on something, which is
// backwards. `marketValue.ts` makes the same call — its `tier` never decays,
// and it buys its safety a different way, by withholding the whole feature
// until `MIN_HISTORY_FOR_VALUES` nights of real variance exist to hide inside.
//
// **What keeps this bounded** is no longer its size — the organiser has raised
// it three times and it is now the second-strongest term in the formula, at
// ±0.8 against `career`'s ±0.5 and `momentum`'s ±0.55. What bounds it is that
// `night` still spans 5.0 plus a `WIN_BONUS`, so **a top-tier player on a beaten
// team still marks below a bottom-tier player on the winning one.** That
// ordering is the line: it is what keeps these marks about the football rather
// than about the organiser's opinion of who is good, and it should not be
// crossed without them saying so in as many words.

import type { FixtureRecord, TeamColor } from './types';
import { hasResult } from './calibration';
// From its own module rather than from `marketValue.ts`, which `values.ts`
// deliberately loads lazily — a static import of it here would put the
// valuation formula and its ridge solver into everybody's main bundle.
import { ratingTier } from './ratingTier';
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
const NIGHT_W = 2.6;
const NIGHT_CAP = 2.5;

/**
 * A night won outright is worth at least this, whatever else is true.
 *
 * **Asked for directly, after the first real night the club graded.** A team
 * took 7 of 12 while the other two took 2 and 3, and players on it still came
 * out at 7.5 — the personal terms (`career`, `momentum`, `tier`) span enough
 * between them, which is easily enough to drag somebody below the
 * mark their team's night deserved. The complaint was not that the ordering was
 * wrong, it was that the *floor* was: winning a night comfortably and being
 * told you were a 7.5 reads as a correction rather than a result.
 *
 * A floor rather than a bigger `night` term, because the two do different
 * things. Widening `night` lifts the winners and pushes the other two teams
 * down by the same move — it is one symmetric slider — and nobody complained
 * about the losing teams. This lifts only the team that actually took the
 * night, and leaves every other mark on the sheet exactly where it was.
 *
 * **What it costs, said plainly:** marks inside the winning team compress. Two
 * players who would have been 7 and 7.5 are now both 8, and the spread that
 * survives is only the part above the floor. That is the trade the floor *is* —
 * the alternative is a winner reading a 7. `NIGHT_W` was widened a little at
 * the same time (2.3 → 2.6) so a dominant win clears 8 on its own and the floor
 * stays what it is meant to be: a safety net for the narrow wins, not the thing
 * setting most of the winners' marks.
 *
 * Outright only. A night level at the top belongs to nobody (§2.6), so nobody
 * on it is floored for having won one.
 */
const WIN_FLOOR = 8;

/**
 * The most a player can score without being picked player of the night.
 *
 * **The top of the scale is reserved for the pick, deliberately.** Before this,
 * a top-tier player on a winning team started at 9.50 before any of their own
 * history was counted, and needed only `career + momentum >= +0.25` to reach a
 * 10 — on a 7-of-12 night that was not even a rout, with no pick. The
 * theoretical maximum without one was 11.10 raw, which the clamp was quietly
 * absorbing: when the ceiling is overshot by that much, the top of the scale
 * has stopped discriminating and a 10 means "good night on a good team".
 *
 * Now 9.5 and 10 exist only for the player the room voted for. That makes the
 * two best marks of the evening say something a scoreline cannot, which is the
 * whole reason the MVP is in this formula (§2.39: it is the one genuinely
 * personal signal a night produces).
 *
 * It does **not** hand the MVP the best mark automatically — a pick on a beaten
 * team still marks below a winner, because `night` outweighs `MVP_BONUS` by
 * some distance. It only means the top two rungs cannot be climbed without one.
 *
 * Interaction with {@link WIN_FLOOR} is deliberate and worth reading together:
 * a non-MVP winner now lives in [8, 9], which on a half-point scale is three
 * rungs. That is enough for the three rating tiers to separate cleanly — as
 * they do on the night this was measured against — and it is the honest width
 * of "won the night, was not the best player on the pitch".
 */
const UNPICKED_CAP = 9;

/**
 * And nobody who turned up goes below this, whatever the scoreboard did.
 *
 * The same night that produced {@link WIN_FLOOR}: the two teams that did not
 * win were landing at 3 and 3.5, and the organiser raised both to 4. It is the
 * `BASE = 6` argument applied to the other end of the scale — the mark is read
 * every week by the person it is about, and there is no version of a Thursday
 * five-a-side night that is worth telling somebody they were a 3 out of 10 for.
 *
 * **What it is not.** Not a claim that every night was fine, and not a
 * flattening of the bottom third: the spread between a quiet night and a
 * hammering survives above the floor, and losing teams still mark clearly below
 * winning ones. It only sets where the bottom of the scale actually starts, the
 * way `BASE` sets where the middle sits.
 *
 * `GRADE_MIN` stays 1 as the definition of the scale rather than being raised
 * to match — the scale is 1–10 and that is what the chip renders against; this
 * is a floor applied within it, and conflating the two would hide that a
 * judgement is being made here.
 */
const PLAYED_FLOOR = 4;

/** The only thing on this list that is about a person rather than a team. */
const MVP_BONUS = 1;

/**
 * Taking the night outright, as a thing in itself rather than as a margin.
 *
 * **This exists to stop {@link WIN_FLOOR} doing the separating.** With the
 * floor alone, a winning team's shared starting point on a typical night was
 * 7.95 — a fraction under the floor — so essentially the whole team landed
 * *on* 8 and the floor was deciding most of their marks. Measured on the night
 * that prompted it: a 5-star earned exactly 8.0 while a 3-star earned 7.0 and
 * was lifted to 8 to meet him. The rating had been widened specifically so it
 * would show, and the floor was flattening it straight back out.
 *
 * A discrete bonus for winning, in the same shape as `MVP_BONUS`, lifts the
 * team's whole starting point clear of the floor instead — so the personal
 * terms spread people out *above* 8 rather than piling them on it, and the
 * floor goes back to being what it was meant to be: a backstop for the one
 * player whose form was bad enough to fall through, not the thing setting the
 * team's marks.
 *
 * Winning is also worth saying as its own fact. `night` measures the *margin*,
 * which is a different claim: taking a night 5–4–3 and taking it 9–2–1 are both
 * winning it, and only one of them is a rout.
 */
const WIN_BONUS = 0.75;

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
// Trimmed 0.7 → 0.55 on 2026-08-28, so the organiser's rating outranks it (see
// TIER_BUMP). Momentum is the noisiest real signal in the formula — it reads
// five nights, which on a young club is often three, and a single evening moves
// it a long way. It should move a mark; it should not be the loudest thing in
// it after the result itself.
const MOMENTUM_W = 0.65;
const MOMENTUM_CAP = 0.55;

/** How many nights back "recent form" looks, and the fewest it will answer on. */
export const RECENT_NIGHTS = 5;
export const MIN_RECENT = 3;

/** How far from their own baseline a run has to be before it is worth a word. */
const TREND_EDGE = 0.4;

export type Trend = 'hot' | 'cold' | 'steady';

/**
 * The organiser's rating, coarsened to a third of the club and turned into a
 * permanent shade on every mark (see the file header for why this term exists
 * and what it costs).
 *
 * **Widened from ±0.25 to ±0.6 and then to ±0.8 on 2026-08-28**, which the file
 * header said must not happen without the organiser asking for it in as many
 * words. They asked, and the diagnosis backed them: at ±0.25 this was the
 * *weakest* term in the formula, and the jitter — noise carrying no information
 * whatsoever — had a wider span than it did. Measured on the real
 * night that prompted the complaint: a 5-star and a 2.5-star on the same shirt
 * came out on the identical mark, because the 0.5 the rating opened between
 * them was cancelled almost exactly by jitter and career. The organiser's own
 * judgement was being outvoted by a hash function.
 *
 * **Raised again to ±0.8 the same day**, on the organiser's follow-up: they
 * want the rating to be more decisive than form. At a span of 1.6 it now
 * outranks `momentum` (1.1 after its own trim), `career` (1.0) and the MVP
 * bonus — making it the second-strongest term in the formula, behind only the
 * night's result. That is a deliberate statement about what a mark is for in
 * this club: the organiser's read of a player is meant to show through a single
 * bad Thursday, and only the team's result outweighs it.
 *
 * What it still cannot do is rescue a bad night on its own. `night` spans 5.0
 * plus a `WIN_BONUS`, so a top-tier player on a beaten team stays below a
 * bottom-tier player on the winning one — which is the ordering that keeps
 * these marks about football rather than about the organiser's opinion.
 *
 * **The privacy cost, which is real and got worse.** The file header explains
 * that averaging a player's residual over many nights recovers their tier.
 * A wider bump makes that recovery both faster and sharper — fewer nights are
 * needed and the answer is less ambiguous. It stays a three-way bucket rather
 * than the raw 1–5 precisely to bound what is recoverable to "which third",
 * which is why this was widened rather than made continuous.
 */
const TIER_BUMP: Record<ReturnType<typeof ratingTier>, number> = {
  bottom: -0.8,
  middle: 0,
  top: 0.8,
};

// **There is deliberately no jitter term any more (removed 2026-08-28).**
//
// There was: a stable per-player-per-night hash worth ±0.35, later ±0.2. Its
// stated job was to stop a single night's mark being a bare readout of which
// tier it came from. Three things retired it, in order of how much they matter:
//
//  1. **It never did that job.** The term it was hiding is recovered by
//     *averaging* a player's residual (see the file header), and a zero-mean
//     hash is exactly what averaging removes. It obscured one night at a time
//     against an attack that reads many.
//  2. **It was cancelling the signal it was meant to shade.** Measured on a
//     real night while `tier` was ±0.25: a 5-star and a 2.5-star on the same
//     shirt came out on the identical mark, the rating between them wiped out
//     by two hash values pointing opposite ways. Noise was outvoting the
//     organiser's own judgement.
//  3. **Marks round to the nearest half.** So its whole remaining effect was to
//     flip players sitting near a rounding boundary, arbitrarily. That is not
//     variety, it is a coin toss on somebody's mark, and it is unanswerable
//     when they ask why they got a 6 and their teammate a 6.5.
//
// What replaces it is nothing, and that is the point: **every difference
// between two players' marks now traces back to a fact about them.** Two
// teammates the app genuinely knows nothing to separate — two debutants on the
// same shirt, say — read the same number, which is the honest answer rather
// than a manufactured one.

export interface GradeParts {
  night: number;
  mvp: number;
  career: number;
  momentum: number;
  /** The organiser's rating, coarsened — see TIER_BUMP and the file header. */
  tier: number;
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
  /**
   * How many of *their own* nights ago they were last picked player of the
   * night — 1 being the last time they played — or null if never.
   *
   * **Here because the sentence-writer was being cruel with a straight face.**
   * A player picked MVP a fortnight earlier had two bad nights after it, which
   * is enough to set `trend: 'cold'`, and the line called it a free-fall. Every
   * word of that was true of the last two nights and false about the player,
   * and the model had no way to know: the payload said "declining form" and
   * carried nothing at all about the pick. The MVP is the one genuinely
   * personal thing a night produces (§2.39), and it was being thrown away the
   * moment the night after it went badly.
   *
   * Counted in nights *they played* rather than in calendar weeks or in
   * fixtures, so somebody who missed a month does not have their pick aged out
   * by nights they were not at.
   */
  lastMvpAgo: number | null;
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
      // The rating as it stood *on that night*, off the fixture's own snapshot
      // rather than off today's roster — the same rule every other term here
      // follows. A player the organiser has since re-rated keeps the marks
      // their old nights were actually given, instead of having a season
      // silently re-scored underneath them.
      const rating = fx.players.find((p) => p.id === id)?.rating ?? 3;
      const tier = TIER_BUMP[ratingTier(rating)];
      // Outright winners only — see WIN_BONUS, WIN_FLOOR and §2.6.
      const wonNight = place === 1 && !hasTie(fx, teamWins);
      const parts: GradeParts = {
        night: night + (wonNight ? WIN_BONUS : 0),
        mvp: isMvp ? MVP_BONUS : 0,
        career,
        momentum,
        tier,
      };
      // Rounded before the floor rather than after, so the floor is exactly the
      // number it says it is: flooring a rounded 7.5 cannot leave anybody below
      // the mark, where rounding a floored 7.9 could.
      const raw = round(
        BASE + parts.night + parts.mvp + parts.career + parts.momentum + parts.tier,
      );
      // Floor first, then the ceiling. `UNPICKED_CAP` is inclusive — 9 is an
      // ordinary mark anybody can earn, and only the two rungs above it are
      // reserved for the pick.
      const floored = Math.max(raw, wonNight ? WIN_FLOOR : PLAYED_FLOOR);
      const capped = isMvp ? floored : Math.min(floored, UNPICKED_CAP);
      const grade = clamp(capped, GRADE_MIN, GRADE_MAX);

      // Coming in: a live winning run, or nights since their team last took one.
      let runBefore = 0;
      for (let i = before.length - 1; i >= 0 && before[i].won; i--) runBefore++;
      let droughtBefore = 0;
      for (let i = before.length - 1; i >= 0 && before[i].won === false; i--) droughtBefore++;

      // The most recent night of their own that they were picked on, counted
      // back from tonight — see `lastMvpAgo`.
      let lastMvpAgo: number | null = null;
      for (let i = before.length - 1; i >= 0; i--) {
        if (byDate.find((f) => f.id === before[i].fixtureId)?.mvpId === id) {
          lastMvpAgo = before.length - i;
          break;
        }
      }

      out.push({
        id,
        name: fx.players.find((p) => p.id === id)?.name ?? '?',
        grade,
        parts,
        context: {
          shirt: c,
          teamWins,
          place,
          wonNight,
          isMvp,
          nightsBefore,
          baseline,
          recent,
          trend,
          runBefore,
          droughtBefore,
          lastMvpAgo,
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
  WIN_BONUS,
  UNPICKED_CAP,
  WIN_FLOOR,
  PLAYED_FLOOR,
  CAREER_W,
  CAREER_CAP,
  MOMENTUM_W,
  MOMENTUM_CAP,
  SHRINK_K,
  RECENT_NIGHTS,
  MIN_RECENT,
  TIER_BUMP,
};
