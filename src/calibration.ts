// Standings and rating suggestions, built from each night's win tally.
//
// Ratings are the one input everything else depends on, and they're set by
// hand — which is both guesswork and socially awkward. This turns recorded
// results into *suggestions* the admin accepts or ignores; nothing here ever
// edits a rating on its own.
//
// What the data is. A night gives three numbers: how many matches each team
// won (half-steps included, since taking a shootout is worth half a win). No
// head-to-head record, and no count of how many matches were played. So the
// only usable signal is relative: over the night, black collected more wins
// than white did. Each night is therefore turned into three *pairwise*
// observations — black vs white, black vs blue, white vs blue — where the
// outcome is each side's share of the wins the two of them collected between
// them, weighted by how many wins that was. A 4–1 night is stronger evidence
// than a 1–0 one, and weighting says so.
//
// The whole design problem is not being reactionary. Five-a-side is high
// variance: a 5★ player on the losing side twice tells you almost nothing.
// Four things keep this honest:
//
//   1. Expectation is computed from *current* ratings, not the ratings in
//      force on the night. That makes a suggestion self-cancelling — accept an
//      upgrade and the player's expected results rise with it, so the same
//      history stops arguing for another one. Historic ratings are still kept
//      per fixture, but only for display.
//   2. Every player is solved for at once, ridge-regularised, so a result is
//      attributed to whoever actually keeps turning up on the right side of it
//      rather than smeared equally over all five shirts.
//   3. Nothing is said unless the *whole* uncertainty interval around a player
//      clears a real-error floor — not merely the point estimate. So most
//      players get no suggestion at all, which is the normal, correct outcome
//      and not a gap.
//   4. A floor of MIN_NIGHTS, and a suggestion only ever moves half a star.
//
// Two caveats worth keeping in view. Converting "surprise in results" into
// "stars" assumes a model of how ratings drive wins that this data cannot
// check; simulation shows the sign and ordering hold up while the magnitude
// can be well out. And a win tally is a coarse record — three numbers a night,
// no head-to-head — so individual attribution is genuinely hard.
//
// ---------------------------------------------------------------------------
// STILL BEING REBUILT. The suggestions are switched off in the UI
// (RATING_PANEL_READY in History.tsx) until the last fault below is closed.
//
// Every table in this file was once derived through a simulator that drew teams
// with `sort(() => rnd() - 0.5)`, which is not a shuffle: it leaves the array
// near where it started, so the first name on the list took the black shirt 46%
// of the time instead of a third. Re-measured through a Fisher-Yates draw at the
// club's real match volume (~12 wins a night, i.e. four matches per pairing),
// three faults came out. `scripts/calibration-report.ts` re-derives all of it.
//
//   1. FIXED. The error bars were far too small — on a league where *nobody*
//      was mis-rated the median |z| at five nights was 4.0, four-sigma
//      confidence in pure noise, which is why the old MIN_Z gate rejected
//      almost nothing and why the panel would name a player on no evidence.
//      `sigma2` divided by total weight, treating every recorded win as an
//      independent observation and spending nothing on the parameters already
//      fitted. It now divides by residual degrees of freedom and widens for
//      the fact that σ² is itself estimated; see `fitRidge`.
//
//   2. FIXED. The gate tested a point estimate against a fixed bar, so noise
//      alone carried players over it. It is now an interval: the whole
//      uncertainty range has to clear a real-error floor before anything is
//      said. Together these take a five-night history from ~1.2 wrong names to
//      ~0.6, and a twenty-night one from ~0.6 to ~0.03 — and, for the first
//      time, make the panel *more* likely to be right the more football is
//      played (precision 32% at eight nights, 87% at twenty, 94% at forty).
//
//   3. OPEN — and the reason the panel is still hidden. `delta` is attenuated
//      to roughly two-thirds. Given unlimited football, a player genuinely
//      1.5★ above their rating settles at an estimate of ~1.0 and one 2.5★ out
//      settles at ~1.6. The estimator is therefore honest but half-deaf: when
//      it speaks it is now usually right, but it only speaks for gross errors,
//      because everything it measures comes out too small to clear its own
//      floor. The fix is to weight each row by the logistic's local slope
//      rather than the 50/50 slope, and to calibrate the star scale by
//      injection so `delta` means the stars it claims.
// ---------------------------------------------------------------------------

import { FULL_TEAM, TEAM_COLORS } from './balancer';
import type { FixtureRecord, Player, TeamColor, TeamWins } from './types';

// A player needs this many nights behind them before anything is suggested
// about them — counted per player, not per season, so a regular builds up a
// record while someone who turns up twice a year never gets judged on it.
// Kept deliberately low, and it can be: what holds the panel back early is no
// longer this floor but the width of the interval below, which on a four-night
// record is wide enough that almost nothing clears it. A night-count threshold
// is a crude proxy for evidence, and now that evidence is measured properly
// this is only a backstop.
export const MIN_NIGHTS = 4;

// Converts a rating gap into an expected share of the wins. At SCALE = 2, a
// full point of team-average advantage means taking about 76% of them.
const SCALE = 2;

// How much one player's rating moves their team's expected share, at the point
// where two teams are even. Derived rather than guessed: the logistic's slope
// at 50/50 is ln(10)/4, the gap is divided by SCALE, and one player moving a
// full point shifts a five-a-side average by a fifth of that.
const SENSITIVITY = Math.LN10 / 4 / (SCALE * FULL_TEAM);

// Ridge penalty. Larger = more evidence needed before an estimate moves off
// zero. Tuned by simulating seasons — see `scripts/calibration-report.ts`.
const LAMBDA = 8;

// How much of the uncertainty a suggestion has to survive. The gate is not
// "does the estimate look big" but "is the *whole* plausible range still a real
// error" — |delta| minus this many standard errors has to clear the floor
// below. At 1.96 that is a 95% interval, and the difference between gating on
// the estimate and gating on the interval is the difference between a panel
// that gets less trustworthy as you feed it and one that gets more:
//
//   gate                        │  5n │  8n │ 12n │ 20n │ 40n
//   point estimate > 1.5        │  13%│  18%│  30%│  62%│  14%   ← share right
//   interval clears 0.5         │  26%│  35%│  65%│  89%│  94%
//
// (a 3★ who is really 2.5 stars better; the rest of the league rated exactly
// right). Lowering this to 1.64 roughly doubles how often the panel speaks and
// drops it to 81% right at twenty nights; raising it to 2.58 buys little and
// costs half the detections.
const EVIDENCE_K = 1.96;

// ...and how big an error has to be before it is worth a word at all, in the
// units `delta` is measured in. A statistically certain quarter-star is not
// news: ratings are set in half-stars, so nothing below that could change one.
// Set at 0.5 rather than 0.25 because `delta` currently runs about two-thirds
// of the truth (fault 3 in the header), which makes this floor worth roughly
// three-quarters of a real star. When that attenuation is fixed this number
// has to come down with it, or the panel will quietly get stricter.
const MIN_REAL_ERROR = 0.5;

// Where the scale's centre of gravity sits. Deliberately lower-mid rather than
// the arithmetic middle (3): most squads have a few genuinely strong players
// and a long tail of ordinary ones, and ratings drift upwards over time because
// nobody enjoys arguing someone down.
const ANCHOR_RATING = 2.5;

// How much the bar moves per star away from that anchor. A rating is treated as
// a claim that has to keep being justified: climbing further from the anchor
// costs more evidence than the base bar, and sliding back toward it costs less.
//
//   rating │ to go up │ to come down
//      1.0 │     0.35 │         0.65
//      2.0 │     0.45 │         0.55
//      2.5 │     0.50 │         0.50
//      3.0 │     0.55 │         0.45
//      4.0 │     0.65 │         0.35
//      5.0 │     0.75 │         0.35
//
// Symmetric about the anchor — a 1★ has to justify staying down there as much
// as a 5★ has to justify staying up — but in practice it bites at the top,
// which is where unearned ratings accumulate.
//
// **This tilt used to be doing the detecting, and now it barely does anything.**
// Under the old point-estimate gate it looked like the star of the file: 45% of
// genuinely overrated 5★s flagged down against 10% of correctly-rated ones. But
// the reason a 1.5★ error at the top was caught three times more often than the
// same error mid-table was this constant lowering the bar, not the evidence
// being any better — it was buying detections with false confidence. Under the
// interval gate, measured over 400 runs, turning it off entirely costs almost
// nothing:
//
//                                     bias 0 │ 0.10 │ 0.20     (at 12 nights)
//   5★ who is really a 3.5, caught        5% │   5% │   5%
//   5★ who really is a 5, falsely flagged 1% │   1% │   1%
//   3★ who is really a 1.5, caught       11% │  12% │  13%
//
// Kept for now at the value it had, because it is cheap and the intent behind
// it is sound. But it is no longer load-bearing, and if it has not earned its
// place once the attenuation is fixed it should go.
const RATING_BIAS = 0.10;

// However far the bias pushes, never take the bar below this: a suggestion
// still has to rest on a real effect, not merely on someone being highly rated.
// Half a star is the smallest change the organiser can actually make, so this
// is the smallest error worth reporting.
const MIN_BAR = 0.35;

// How much a player has to look out by before it's worth saying anything,
// given where they currently sit and which way the evidence points.
export function barFor(rating: number, direction: 'up' | 'down'): number {
  const distance = rating - ANCHOR_RATING;
  const movingAway =
    (direction === 'up' && distance > 0) || (direction === 'down' && distance < 0);
  const shift = RATING_BIAS * Math.abs(distance) * (movingAway ? 1 : -1);
  return Math.max(MIN_BAR, MIN_REAL_ERROR + shift);
}

// Rating points a suggestion moves by. Deliberately one small step: the app
// can always suggest again next month if the evidence keeps building.
const STEP = 0.5;

const clampRating = (r: number) => Math.max(1, Math.min(5, r));

export interface RatingSuggestion {
  id: string;
  name: string;
  current: number;
  suggested: number;
  direction: 'up' | 'down';
  nights: number;
  wins: number;
  impliedDelta: number;
  // Half-width of the uncertainty range around `impliedDelta`, in the same
  // units. The figure is an estimate, not a measurement, and anything that
  // shows the one should be able to show the other.
  margin: number;
  confidence: 'building' | 'solid' | 'strong';
  // The evidence points past the end of the 1–5 scale: already a 5 and still
  // winning more than a 5 should, or already a 1 and still losing more. There
  // is no half-star left to offer, so this is a note rather than an action —
  // but it is worth saying rather than swallowing, because the balancer only
  // ever compares players. Someone pinned at the ceiling who keeps beating
  // expectation means the top of the scale is compressed, and teams built
  // around them are stronger than their numbers admit.
  atLimit: boolean;
}

// --- Reading a night -------------------------------------------------------

// Did anyone actually record anything for this night?
export const hasResult = (w: TeamWins | null | undefined): boolean =>
  !!w && TEAM_COLORS.some((c) => (w[c] ?? 0) > 0);

export const totalWins = (w: TeamWins): number =>
  TEAM_COLORS.reduce((n, c) => n + (w[c] ?? 0), 0);

// --- Estimating who is mis-rated -------------------------------------------

export interface Row {
  idx: number[];
  sign: number[];
  y: number;
  w: number; // weight — how many wins this comparison is based on
  // Which night this comparison came from. The three rows of one night are not
  // independent of each other — black's wins appear in both the black-white
  // and black-blue rows — so the error bars have to treat a night as the unit
  // of evidence rather than a row. See `fitRidge`.
  night: number;
}

export interface PlayerEstimate {
  delta: number; // rating points out, positive = better than rated
  se: number;
  z: number;
}

// Weighted ridge fit with posterior standard errors. Inverting the (small)
// normal matrix outright rather than just solving it, because the diagonal of
// the inverse is exactly what the error bars need.
function fitRidge(rows: Row[], n: number, lambda: number): { beta: number[]; se: number[] } {
  // XᵀWX, kept whole: the fit needs it with the ridge penalty added, and the
  // error bars need it without, to count how many degrees of freedom the
  // penalised fit actually spent.
  const XtWX = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (const row of rows) {
    for (let i = 0; i < row.idx.length; i++) {
      b[row.idx[i]] += row.w * row.sign[i] * row.y;
      for (let j = 0; j < row.idx.length; j++) {
        XtWX[row.idx[i]][row.idx[j]] += row.w * row.sign[i] * row.sign[j];
      }
    }
  }
  const M = XtWX.map((r, i) => r.map((v, j) => (i === j ? v + lambda : v)));

  // Gauss-Jordan on [M | I] leaves the inverse in the right-hand block
  const inv: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j): number => (i === j ? 1 : 0)),
  );
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) continue; // player never varied — leave at zero
    [M[col], M[piv]] = [M[piv], M[col]];
    [inv[col], inv[piv]] = [inv[piv], inv[col]];
    const d = M[col][col];
    for (let c = 0; c < n; c++) {
      M[col][c] /= d;
      inv[col][c] /= d;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (!f) continue;
      for (let c = 0; c < n; c++) {
        M[r][c] -= f * M[col][c];
        inv[r][c] -= f * inv[col][c];
      }
    }
  }

  const beta = inv.map((rowI) => rowI.reduce((s, v, j) => s + v * b[j], 0));

  let wrss = 0;
  for (const row of rows) {
    let pred = 0;
    for (let i = 0; i < row.idx.length; i++) pred += row.sign[i] * beta[row.idx[i]];
    wrss += row.w * (row.y - pred) ** 2;
  }

  // How much of the data the fit has already spent on itself: the trace of the
  // hat matrix, inv · XᵀWX. A ridge fit does not spend one degree of freedom
  // per player — the penalty buys some of them back — so this comes out around
  // 8 for fifteen players rather than 15, and it has to be measured rather than
  // assumed.
  let spent = 0;
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) spent += inv[i][k] * XtWX[k][i];
  const residualDf = Math.max(1, rows.length - spent);

  // Residual variance per unit weight. The old version divided by total weight
  // — by the number of *wins recorded* — which treated every win as an
  // independent observation and spent nothing on the parameters already
  // fitted. On a five-night history that inflated the denominator roughly
  // ninefold and shrank every error bar by a factor of three, which is where
  // four-sigma confidence in a fair league came from.
  const sigma2 = wrss / residualDf;

  // And the last of the same problem: σ² is itself estimated, from as few as
  // seven residual degrees of freedom on a short history, so treating it as
  // known is one more kind of false confidence. Widening by the t ratio at
  // those degrees of freedom is the standard remedy, and measurably the right
  // one here — on a league where nobody is mis-rated it takes the flags a
  // five-night history produces from 1.03 to 0.59, while a genuine two-and-a-
  // half star error is still found about as often.
  const widen = tInflation(residualDf);
  const se = inv.map((rowI, i) => widen * Math.sqrt(Math.max(0, sigma2 * rowI[i])));

  return { beta, se };
}

// How much wider a t interval is than a normal one at the same confidence,
// given `v` degrees of freedom — the Cornish-Fisher expansion of the t quantile
// at 97.5%, divided by 1.96. Close enough for the purpose (it gives 2.55 against
// the true 2.57 at v = 5) and it needs no table. Approaches 1 as v grows, so on
// a long history it quietly stops mattering.
function tInflation(v: number): number {
  const z = 1.959964;
  if (v <= 2) return 3;
  const t =
    z +
    (z ** 3 + z) / (4 * v) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * v * v) +
    (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * v ** 3);
  return t / z;
}

// Turns a history into the pairwise comparisons the fit runs on. Separated out
// so `scripts/calibration-report.ts` can hold the data fixed and vary only the
// arithmetic — comparing two estimators on two different sets of rows tells you
// nothing about either.
export function buildRows(
  history: FixtureRecord[],
  ratingOf: (id: string) => number | null,
): { rows: Row[]; index: Map<string, number> } {
  const index = new Map<string, number>();
  const idx = (id: string) => {
    if (!index.has(id)) index.set(id, index.size);
    return index.get(id)!;
  };
  const rows: Row[] = [];

  let night = -1;
  for (const fx of history) {
    if (!hasResult(fx.wins)) continue;
    night++;

    const rated = (ids: string[]) => {
      const vals = ids.map(
        (id) => ratingOf(id) ?? fx.players.find((p) => p.id === id)?.rating ?? null,
      );
      const known = vals.filter((v): v is number => v != null);
      return known.length ? known.reduce((n, v) => n + v, 0) / known.length : null;
    };

    // every pairing of teams that turned out, compared on their share of the
    // wins the two of them took between them
    for (let i = 0; i < TEAM_COLORS.length; i++) {
      for (let j = i + 1; j < TEAM_COLORS.length; j++) {
        const c = TEAM_COLORS[i];
        const d = TEAM_COLORS[j];
        const a = fx.teams[c];
        const bIds = fx.teams[d];
        if (!a.length || !bIds.length) continue;

        const wc = fx.wins[c] ?? 0;
        const wd = fx.wins[d] ?? 0;
        const n = wc + wd;
        if (n <= 0) continue; // neither won anything — nothing to compare

        const avgA = rated(a);
        const avgB = rated(bIds);
        if (avgA == null || avgB == null) continue;

        const expected = 1 / (1 + 10 ** ((avgB - avgA) / SCALE));
        rows.push({
          idx: [...a.map(idx), ...bIds.map(idx)],
          sign: [...a.map(() => 1), ...bIds.map(() => -1)],
          y: wc / n - expected,
          w: n,
          night,
        });
      }
    }
  }

  return { rows, index };
}

export function ratingErrors(
  history: FixtureRecord[],
  ratingOf: (id: string) => number | null,
  lambda: number = LAMBDA,
): Map<string, PlayerEstimate> {
  const { rows, index } = buildRows(history, ratingOf);
  const { beta, se } = fitRidge(rows, index.size, lambda);
  const out = new Map<string, PlayerEstimate>();
  for (const [id, i] of index) {
    const delta = beta[i] / SENSITIVITY;
    const sd = se[i] / SENSITIVITY;
    out.set(id, { delta, se: sd, z: sd > 0 ? delta / sd : 0 });
  }
  return out;
}

// --- Per-player record -----------------------------------------------------

export interface PlayerStanding {
  id: string;
  name: string;
  nights: number;
  wins: number; // a shootout counts half, per the house rule
  perNight: number;
}

// Which team a player was on that night, if any.
const teamOf = (fx: FixtureRecord, id: string): TeamColor | null =>
  TEAM_COLORS.find((c) => fx.teams[c].includes(id)) ?? null;

export function playerStandings(history: FixtureRecord[]): PlayerStanding[] {
  const out = new Map<string, PlayerStanding>();
  const nameOf = new Map<string, string>();
  for (const fx of history) for (const p of fx.players) nameOf.set(p.id, p.name);

  for (const fx of history) {
    if (!hasResult(fx.wins)) continue;
    for (const c of TEAM_COLORS) {
      for (const id of fx.teams[c]) {
        const s =
          out.get(id) ??
          ({ id, name: nameOf.get(id) ?? '?', nights: 0, wins: 0, perNight: 0 } satisfies PlayerStanding);
        s.nights++;
        s.wins += fx.wins[c] ?? 0;
        out.set(id, s);
      }
    }
  }

  for (const s of out.values()) s.perNight = s.nights ? s.wins / s.nights : 0;

  return [...out.values()].sort((x, y) => y.perNight - x.perNight || y.nights - x.nights);
}

// Everyone's record plus the estimate behind it, whether or not it clears the
// bar for a suggestion. Worth showing on its own: it takes a lot of football
// before a suggestion fires, and meanwhile "who keeps beating what the ratings
// expect" is the interesting part.
/**
 * The same solver with the organiser's opinion taken out of it (§2.30).
 *
 * `ratingErrors` measures *surprise*: how far a player's results sit from what
 * their rating said to expect. That makes it a statement about a rating, which
 * makes it private, which is why the "vs rating" column is admin-only.
 *
 * Hand it a constant instead and the question changes. Every team's average is
 * then identical, so `expected` collapses to 0.5 for every pairing and the
 * ridge is left attributing the whole deviation from an even split — *who keeps
 * turning up on the winning side, controlling for who they lined up with*. No
 * rating enters the arithmetic anywhere, so nothing about the result can leak
 * one, and it is safe to publish to every phone in the club.
 *
 * Which constant is irrelevant: only the difference between two team averages
 * reaches the model, and every difference here is zero.
 *
 * **Units.** `delta` comes out of the same `SENSITIVITY` divide as the rating
 * version, so it is still "rating points of advantage this player's presence is
 * worth" — but read against an average player rather than against their own
 * rating. It is *not* a rating and must never be rendered as stars.
 *
 * **Small records need no special case.** The ridge penalty pulls an estimate
 * with little evidence behind it toward zero on its own, so a newcomer lands
 * near "ordinary" rather than at an extreme. That is the whole reason for
 * regularising rather than solving exactly.
 *
 * **Not yet simulated.** The hit-rate table under `MIN_IMPLIED_DELTA` was
 * measured with a real rating prior; a flat prior is a different estimator and
 * is owed its own pass before anything gates a decision on the number. Nothing
 * currently does — it feeds a price tag (§2.31), where being roughly right is
 * the requirement.
 */
const FLAT_PRIOR = 3;

export function resultStrength(history: FixtureRecord[]): Map<string, PlayerEstimate> {
  return ratingErrors(history, () => FLAT_PRIOR);
}

export interface PlayerForm {
  id: string;
  name: string;
  nights: number;
  wins: number;
  perNight: number;
  delta: number;
  z: number;
}

export function playerForm(history: FixtureRecord[], players: Player[]): PlayerForm[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const errors = ratingErrors(history, (id) => byId.get(id)?.rating ?? null);
  const standings = playerStandings(history);

  return standings
    .filter((s) => byId.has(s.id)) // one-off guests aren't tracked here
    .map((s) => {
      const est = errors.get(s.id);
      return {
        id: s.id,
        name: byId.get(s.id)!.name,
        nights: s.nights,
        wins: s.wins,
        perNight: s.perNight,
        delta: est?.delta ?? 0,
        z: est?.z ?? 0,
      };
    })
    .sort((a, b) => b.delta - a.delta);
}

export function suggestRatings(
  history: FixtureRecord[],
  players: Player[],
): RatingSuggestion[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const errors = ratingErrors(history, (id) => byId.get(id)?.rating ?? null);
  const standings = new Map(playerStandings(history).map((s) => [s.id, s]));

  const out: RatingSuggestion[] = [];
  for (const [id, est] of errors) {
    const p = byId.get(id);
    const rec = standings.get(id);
    if (!p || !rec || rec.nights < MIN_NIGHTS) continue;

    const direction = est.delta > 0 ? 'up' : 'down';
    const bar = barFor(p.rating, direction);

    // The gate. Not "is the estimate big" — an estimate can be big because the
    // football was strange — but "is the whole plausible range still a real
    // error", after allowing for what they're already rated. Climbing away from
    // the anchor costs more evidence than sliding back toward it.
    //
    // `certain` is how far the *near* end of the interval sits past that bar.
    // It is the honest version of the old `impliedDelta > bar` test, and it is
    // what makes the panel more trustworthy the more football it is given
    // rather than less.
    const certain = Math.abs(est.delta) - EVIDENCE_K * est.se - bar;
    if (!(certain > 0)) continue;

    const suggested = clampRating(p.rating + (direction === 'up' ? STEP : -STEP));
    // no room left to move them: reported as a note instead of being dropped
    const atLimit = suggested === p.rating;

    out.push({
      id,
      name: p.name,
      current: p.rating,
      suggested,
      direction,
      nights: rec.nights,
      wins: rec.wins,
      impliedDelta: est.delta,
      margin: est.se * EVIDENCE_K,
      // How much evidence is behind it, read off the evidence rather than off
      // the calendar. The old version counted nights, which is a proxy for the
      // real thing and a poor one — fifteen nights of lopsided football can say
      // less about a player than eight of close matches. A suggestion that only
      // just squeaks past the bar is 'building' however long the record is.
      confidence: certain > 0.5 ? 'strong' : certain > 0.2 ? 'solid' : 'building',
      atLimit,
    });
  }

  // things you can act on first; a ceiling note is information, not a to-do
  return out.sort(
    (x, y) =>
      Number(x.atLimit) - Number(y.atLimit) ||
      Math.abs(y.impliedDelta) - Math.abs(x.impliedDelta),
  );
}
