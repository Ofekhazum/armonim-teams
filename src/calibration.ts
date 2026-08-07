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

// Nothing is suggested below this many nights. Set low on purpose: the app
// should be able to speak up early. What stops that becoming noise is the
// effect-size bar below, not a long wait.
const MIN_NIGHTS = 3;

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
    if (Math.abs(est.delta) < MIN_IMPLIED_DELTA) continue;

    const direction = est.delta > 0 ? 'up' : 'down';
    const suggested = clampRating(p.rating + (direction === 'up' ? STEP : -STEP));
    if (suggested === p.rating) continue; // already at the end of the scale

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
    });
  }

  return out.sort((x, y) => Math.abs(y.impliedDelta) - Math.abs(x.impliedDelta));
}
