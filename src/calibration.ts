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
//   3. A player has to look a long way out (MIN_IMPLIED_DELTA) before anything
//      is said, so most players get no suggestion at all — which is the normal,
//      correct outcome, not a gap.
//   4. A floor of MIN_NIGHTS, and a suggestion only ever moves half a star.
//
// Two caveats worth keeping in view. Converting "surprise in results" into
// "stars" assumes a model of how ratings drive wins that this data cannot
// check; simulation shows the sign and ordering hold up while the magnitude
// can be well out. And a win tally is a coarse record — three numbers a night,
// no head-to-head — so individual attribution is genuinely hard. See the note
// on MIN_IMPLIED_DELTA for the measured hit and error rates; the short version
// is that this is designed to stay quiet and be right when it doesn't.

import { FULL_TEAM, TEAM_COLORS } from './balancer';
import type { FixtureRecord, Player, TeamColor, TeamWins } from './types';

// A player needs this many nights behind them before anything is suggested
// about them — counted per player, not per season, so a regular builds up a
// record while someone who turns up twice a year never gets judged on it.
// Kept deliberately low so the app can speak up early; what stops that becoming
// noise is the effect-size bar below, not a long wait.
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
// zero. Tuned by simulating seasons — see the table under MIN_IMPLIED_DELTA.
const LAMBDA = 8;

// A light sanity check that the estimate isn't merely noise. The real gate is
// MIN_IMPLIED_DELTA below.
const MIN_Z = 1;

// The real gate: how far out a player has to *look* before it's worth saying
// anything. Set high deliberately, and this is the number that makes an early
// suggestion trustworthy rather than a coin flip.
//
// Tuned by simulation (120 runs per setting, one player a full star underrated
// and one a full star overrated, everyone else exactly right). Measured at this
// setting, for a genuinely mis-rated player:
//
//   nights │ found │ pointed the wrong way │ fairly-rated players flagged
//        4 │   ~8% │                   ~7% │  1.6 of 13
//        6 │  ~18% │                   ~9% │  2.6 of 13
//       10 │  ~28% │                   ~3% │  3.0 of 13
//
// So from three or four nights it *can* speak, but it mostly won't — and that
// is the intended behaviour, not a shortfall. Dropping this to 0.6 quadruples
// how often it fires at four nights and simultaneously pushes the wrong-way
// rate to ~25%: it would be recommending a downgrade for a genuinely good
// player one time in four. Most players should simply get no suggestion.
const MIN_IMPLIED_DELTA = 1.5;

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
//      1.0 │     1.35 │         1.65
//      2.0 │     1.45 │         1.55
//      2.5 │     1.50 │         1.50
//      3.0 │     1.55 │         1.45
//      4.0 │     1.65 │         1.35
//      5.0 │     1.75 │         1.25
//
// Symmetric about the anchor — a 1★ has to justify staying down there as much
// as a 5★ has to justify staying up — but in practice it bites at the top,
// which is where unearned ratings accumulate.
//
// Kept gentle deliberately, and tuned down once already (from 0.20): the
// stronger the tilt, the more it also flags players who are exactly where they
// should be, and a panel that keeps nagging you to demote your best player
// trains you to stop reading it. Measured over 120 runs × 20 nights on a
// realistically spread roster, at this value:
//
//                                        suggested down
//   5★ who is really a 3.5 (overrated)          47%   ← the point of the tilt
//   5★ who really is a 5 (correctly rated)      17%   ← the price of it
//   4★ who is really a 3 (overrated)             23%
//   4★ who really is a 4 (correctly rated)       12%
//
// Almost three right for every one wrong. A steeper tilt (0.20, the original
// value) catches more genuine over-ratings — 58% vs 47% here — but very nearly
// doubles the false-flag rate on a correctly-rated 5★ (28% vs 17%), which is a
// worse trade than it looks: a wrong "demote your best player" costs more
// trust than a missed "you should probably drop this one" costs opportunity.
const RATING_BIAS = 0.10;

// However far the bias pushes, never take the bar below this: a suggestion
// still has to rest on a real effect, not merely on someone being highly rated.
const MIN_BAR = 1.0;

// How much a player has to look out by before it's worth saying anything,
// given where they currently sit and which way the evidence points.
export function barFor(rating: number, direction: 'up' | 'down'): number {
  const distance = rating - ANCHOR_RATING;
  const movingAway =
    (direction === 'up' && distance > 0) || (direction === 'down' && distance < 0);
  const shift = RATING_BIAS * Math.abs(distance) * (movingAway ? 1 : -1);
  return Math.max(MIN_BAR, MIN_IMPLIED_DELTA + shift);
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

interface Row {
  idx: number[];
  sign: number[];
  y: number;
  w: number; // weight — how many wins this comparison is based on
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
  const M = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (const row of rows) {
    for (let i = 0; i < row.idx.length; i++) {
      b[row.idx[i]] += row.w * row.sign[i] * row.y;
      for (let j = 0; j < row.idx.length; j++) {
        M[row.idx[i]][row.idx[j]] += row.w * row.sign[i] * row.sign[j];
      }
    }
  }
  for (let i = 0; i < n; i++) M[i][i] += lambda;

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
  let wsum = 0;
  for (const row of rows) {
    let pred = 0;
    for (let i = 0; i < row.idx.length; i++) pred += row.sign[i] * beta[row.idx[i]];
    wrss += row.w * (row.y - pred) ** 2;
    wsum += row.w;
  }
  // scale to "per unit weight", so the error bars shrink as real evidence
  // accumulates rather than as rows are counted
  const sigma2 = wrss / Math.max(1, wsum - 1);
  const se = inv.map((rowI, i) => Math.sqrt(Math.max(0, sigma2 * rowI[i])));

  return { beta, se };
}

export function ratingErrors(
  history: FixtureRecord[],
  ratingOf: (id: string) => number | null,
  lambda: number = LAMBDA,
): Map<string, PlayerEstimate> {
  const index = new Map<string, number>();
  const idx = (id: string) => {
    if (!index.has(id)) index.set(id, index.size);
    return index.get(id)!;
  };
  const rows: Row[] = [];

  for (const fx of history) {
    if (!hasResult(fx.wins)) continue;

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
        });
      }
    }
  }

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

    // the real gate: could noise alone have produced this?
    if (Math.abs(est.z) < MIN_Z) continue;

    const direction = est.delta > 0 ? 'up' : 'down';
    // ...and is it enough, given what they're already rated? Climbing away from
    // the anchor costs more evidence than sliding back toward it.
    if (Math.abs(est.delta) < barFor(p.rating, direction)) continue;
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
      // evidence grows with nights played, not with how big the estimate looks
      confidence: rec.nights >= 15 ? 'strong' : rec.nights >= 8 ? 'solid' : 'building',
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
