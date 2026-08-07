// Rating suggestions from recorded results.
//
// Ratings are the one input everything else depends on, and they're set by
// hand — which is both guesswork and socially awkward. This turns the season's
// results into *suggestions* the admin accepts or ignores; nothing here ever
// edits a rating on its own.
//
// The whole design problem is not being reactionary. Five-a-side is high
// variance: a 5★ player on the losing side twice tells you almost nothing.
// Four things keep this honest:
//
//   1. Expectation is computed from *current* ratings, not the ratings in
//      force on the night. That makes the suggestion self-cancelling — accept
//      an upgrade and the player's expected results rise with it, so the same
//      history stops arguing for another one. Historic ratings are still kept
//      per fixture, but only for display.
//   2. Every player is solved for at once, ridge-regularised, so a result is
//      attributed to whoever actually keeps turning up on the right side of it
//      rather than smeared equally over all five shirts.
//   3. The trigger is a confidence test (MIN_Z), not a raw margin: an estimate
//      has to stand clear of its own error bars before it is mentioned.
//   4. A hard floor of MIN_MATCHES before anything is suggested at all.
//
// Penalties are deliberately ignored here even though they decide the night's
// standings: a shootout is close to a coin flip, so for judging *ability* a
// match that finished level is simply a draw.
//
// A caveat worth keeping in view: the conversion from "surprise in results" to
// "stars" assumes a particular model of how ratings drive goals, and that model
// cannot be checked against this data. Simulation shows the *magnitude* can be
// off by roughly a factor of two while the sign and the ordering hold up, which
// is why the confidence test does the gatekeeping and the suggestion only ever
// moves half a star at a time.

import { FULL_TEAM } from './balancer';
import type { FixtureRecord, MatchResult, Player, TeamColor } from './types';

// Nothing is suggested below this many matches, however lopsided the record.
const MIN_MATCHES = 12;

// Converts a rating gap into an expected score. At SCALE = 2, a full point of
// team-average advantage means winning about 76% of the time — roughly how it
// plays out at this level, and flat enough that a single upset isn't damning.
const SCALE = 2;

// Goal margin that counts as a maximal win. Beyond this the result stops
// carrying extra information and starts being about who kept shooting.
const MARGIN_CAP = 3;

// How much one player's rating moves their team's expected score, at the point
// where the teams are even. Derived rather than guessed: the logistic's slope
// at 50/50 is ln(10)/4, the gap is divided by SCALE, and one player moving a
// full point shifts a five-a-side average by a fifth of that. Dividing the
// observed edge by this turns it back into rating points, which is the only
// unit worth showing a human.
const SENSITIVITY = Math.LN10 / 4 / (SCALE * FULL_TEAM);

// Rating points a suggestion moves by. Deliberately one small step: the app
// can always suggest again next month if the evidence keeps building.
const STEP = 0.5;

export interface RatingSuggestion {
  id: string;
  name: string;
  current: number;
  suggested: number;
  direction: 'up' | 'down';
  played: number;
  wins: number;
  draws: number;
  losses: number;
  // how far off their rating looks, in rating points, after shrinkage — the
  // number the suggestion is actually argued from
  impliedDelta: number;
  // how much evidence is behind it, for the admin to eyeball
  confidence: 'building' | 'solid' | 'strong';
}

const clampRating = (r: number) => Math.max(1, Math.min(5, r));

// Result from A's point of view, on the same 0–1 scale as `expected`. A margin
// of MARGIN_CAP or more is a full 1; a one-goal win is 0.67; level is 0.5.
export function actualScore(m: MatchResult): number | null {
  if (m.scoreA == null || m.scoreB == null) return null;
  const diff = m.scoreA - m.scoreB;
  const capped = Math.max(-MARGIN_CAP, Math.min(MARGIN_CAP, diff));
  return 0.5 + 0.5 * (capped / MARGIN_CAP);
}

// Who lined up for which team in a given match, loans included. A player
// loaned to the short side played *for* that side, so the result is theirs.
export function sidesFor(
  teams: Record<TeamColor, string[]>,
  m: MatchResult,
): { a: string[]; b: string[] } {
  const loaned = new Set((m.loans ?? []).map((l) => l.id));
  const side = (c: TeamColor) => [
    ...teams[c].filter((id) => !loaned.has(id)),
    ...(m.loans ?? []).filter((l) => l.to === c).map((l) => l.id),
  ];
  return { a: side(m.a), b: side(m.b) };
}

interface Tally {
  played: number;
  surprise: number;
  wins: number;
  draws: number;
  losses: number;
}

// Per-player record and cumulative over/under-performance across every
// recorded match in `history`.
export function tallyPlayers(
  history: FixtureRecord[],
  ratingOf: (id: string) => number | null,
): Map<string, Tally> {
  const out = new Map<string, Tally>();
  const bump = (id: string, fn: (t: Tally) => void) => {
    const t = out.get(id) ?? { played: 0, surprise: 0, wins: 0, draws: 0, losses: 0 };
    fn(t);
    out.set(id, t);
  };

  for (const fx of history) {
    for (const m of fx.matches) {
      const actual = actualScore(m);
      if (actual == null) continue;
      const { a, b } = sidesFor(fx.teams, m);
      if (!a.length || !b.length) continue;

      // A player still on the roster is judged against what we believe today;
      // one who has left (a guest, mostly) falls back to the night's rating so
      // they still contribute to their team's strength.
      const rated = (ids: string[]) => {
        const vals = ids.map(
          (id) => ratingOf(id) ?? fx.players.find((p) => p.id === id)?.rating ?? null,
        );
        const known = vals.filter((v): v is number => v != null);
        return known.length ? known.reduce((n, v) => n + v, 0) / known.length : null;
      };
      const avgA = rated(a);
      const avgB = rated(b);
      if (avgA == null || avgB == null) continue;

      const expected = 1 / (1 + 10 ** ((avgB - avgA) / SCALE));
      const level = m.scoreA === m.scoreB;

      for (const [ids, act, exp] of [
        [a, actual, expected],
        [b, 1 - actual, 1 - expected],
      ] as const) {
        for (const id of ids) {
          bump(id, (t) => {
            t.played++;
            t.surprise += act - exp;
            if (level) t.draws++;
            else if (act > 0.5) t.wins++;
            else t.losses++;
          });
        }
      }
    }
  }
  return out;
}

// --- Estimating who is actually mis-rated ----------------------------------
//
// The obvious approach — take a team's surprise and blame all five players
// equally — cannot tell a good player from their teammates, and on a synthetic
// season it found genuinely mis-rated players only about half the time while
// flagging fairly-rated ones in most seasons. Not good enough to put a name in
// front of someone.
//
// So instead: solve for every player at once, ridge-regularised. Each recorded
// match is one equation — "the surprise in this result is the sum of the
// mistakes in the ratings of the players on A, minus those on B" — and because
// the balancer reshuffles teams every week, the same player turns up in many
// different combinations. That variation is what lets the fit separate a
// player from the people around them.
//
// The λ term is the anti-reactionary part, and it is doing the same job the
// old shrinkage did: it pulls every estimate toward "your rating is fine"
// unless the evidence keeps insisting otherwise, week after week.

// Ridge penalty, in units of matches. Larger = more evidence needed before an
// estimate moves off zero.
const LAMBDA = 20;

// How many standard errors an estimate must sit from zero before it is worth
// mentioning. This — not the rating scale — is what makes the feature
// trustworthy: it asks "could noise alone have produced this?" and stays quiet
// unless the answer is clearly no. It also means the bar gets easier to clear
// only by playing more matches, never by one lucky night.
//
// Chosen by simulating 80 seasons at a time. At this bar a league where
// everyone is correctly rated throws up a spurious suggestion in roughly one
// season in six, while a player who really is a star out gets found about a
// fifth of the time once a couple of years of results exist. Loosening it to
// z=1.0 quadruples the hit rate but makes a spurious suggestion near-certain
// every season, which would teach everyone to ignore the whole feature.
const MIN_Z = 2;

// A floor on the size of the effect, in rating points, so a statistically
// certain but negligible difference doesn't trigger a change. Deliberately
// loose: the conversion from match outcomes to "stars" depends on a model of
// how ratings translate into goals that we cannot verify from this data, so
// the magnitude here is indicative and MIN_Z does the real gatekeeping.
const MIN_IMPLIED_DELTA = 0.25;

export interface PlayerEstimate {
  delta: number; // rating points out, positive = better than rated
  se: number; // standard error of that estimate, same units
  z: number; // delta / se — how far from "could just be noise"
}

// Ridge fit with its posterior standard errors. Inverting the (small) normal
// matrix outright rather than just solving it, because the diagonal of the
// inverse is exactly what the error bars need.
function fitRidge(
  rows: { idx: number[]; sign: number[]; y: number }[],
  n: number,
  lambda: number,
): { beta: number[]; se: number[] } {
  // M = XᵀX + λI, and b = Xᵀy, both accumulated a row at a time
  const M = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (const row of rows) {
    for (let i = 0; i < row.idx.length; i++) {
      b[row.idx[i]] += row.sign[i] * row.y;
      for (let j = 0; j < row.idx.length; j++) {
        M[row.idx[i]][row.idx[j]] += row.sign[i] * row.sign[j];
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

  // residual variance, for scaling the error bars
  let rss = 0;
  for (const row of rows) {
    let pred = 0;
    for (let i = 0; i < row.idx.length; i++) pred += row.sign[i] * beta[row.idx[i]];
    rss += (row.y - pred) ** 2;
  }
  const dof = Math.max(1, rows.length - 1);
  const sigma2 = rss / dof;
  const se = inv.map((rowI, i) => Math.sqrt(Math.max(0, sigma2 * rowI[i])));

  return { beta, se };
}

// How far each player's rating looks to be out, with the uncertainty attached.
// Positive delta means "better than their rating says".
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
  const rows: { idx: number[]; sign: number[]; y: number }[] = [];

  for (const fx of history) {
    for (const m of fx.matches) {
      const actual = actualScore(m);
      if (actual == null) continue;
      const { a, b } = sidesFor(fx.teams, m);
      if (!a.length || !b.length) continue;

      const rated = (ids: string[]) => {
        const vals = ids.map(
          (id) => ratingOf(id) ?? fx.players.find((p) => p.id === id)?.rating ?? null,
        );
        const known = vals.filter((v): v is number => v != null);
        return known.length ? known.reduce((n, v) => n + v, 0) / known.length : null;
      };
      const avgA = rated(a);
      const avgB = rated(b);
      if (avgA == null || avgB == null) continue;

      const expected = 1 / (1 + 10 ** ((avgB - avgA) / SCALE));
      rows.push({
        idx: [...a.map(idx), ...b.map(idx)],
        sign: [...a.map(() => 1), ...b.map(() => -1)],
        y: actual - expected,
      });
    }
  }

  const { beta, se } = fitRidge(rows, index.size, lambda);
  const out = new Map<string, PlayerEstimate>();
  for (const [id, i] of index) {
    // β is in expected-score units; SENSITIVITY converts it back toward stars
    const delta = beta[i] / SENSITIVITY;
    const sd = se[i] / SENSITIVITY;
    out.set(id, { delta, se: sd, z: sd > 0 ? delta / sd : 0 });
  }
  return out;
}

export function suggestRatings(
  history: FixtureRecord[],
  players: Player[],
): RatingSuggestion[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const ratingOf = (id: string) => byId.get(id)?.rating ?? null;
  const tallies = tallyPlayers(history, ratingOf);
  const errors = ratingErrors(history, ratingOf);

  const out: RatingSuggestion[] = [];
  for (const [id, t] of tallies) {
    const p = byId.get(id);
    if (!p || t.played < MIN_MATCHES) continue; // guests aren't on the roster to adjust

    const est = errors.get(id);
    if (!est) continue;
    // the real gate: could noise alone have produced this?
    if (Math.abs(est.z) < MIN_Z) continue;
    if (Math.abs(est.delta) < MIN_IMPLIED_DELTA) continue;

    const impliedDelta = est.delta;
    const direction = impliedDelta > 0 ? 'up' : 'down';
    const suggested = clampRating(p.rating + (direction === 'up' ? STEP : -STEP));
    if (suggested === p.rating) continue; // already at the top or bottom of the scale

    out.push({
      id,
      name: p.name,
      current: p.rating,
      suggested,
      direction,
      played: t.played,
      wins: t.wins,
      draws: t.draws,
      losses: t.losses,
      impliedDelta,
      confidence: Math.abs(est.z) >= 4 ? 'strong' : Math.abs(est.z) >= 3 ? 'solid' : 'building',
    });
  }

  // strongest case first, so the admin sees the ones worth acting on
  return out.sort((x, y) => Math.abs(y.impliedDelta) - Math.abs(x.impliedDelta));
}

// Everyone's record plus the estimate behind it, whether or not it clears the
// bar for a suggestion. Worth showing on its own: it takes years of results
// before a suggestion fires, and in the meantime "who keeps beating what the
// ratings expect" is the interesting part.
export interface PlayerForm {
  id: string;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  delta: number; // rating points out, positive = better than rated
  z: number;
}

export function playerForm(history: FixtureRecord[], players: Player[]): PlayerForm[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const ratingOf = (id: string) => byId.get(id)?.rating ?? null;
  const tallies = tallyPlayers(history, ratingOf);
  const errors = ratingErrors(history, ratingOf);

  const out: PlayerForm[] = [];
  for (const [id, t] of tallies) {
    const p = byId.get(id);
    if (!p) continue; // one-off guests aren't tracked here
    const est = errors.get(id);
    out.push({
      id,
      name: p.name,
      played: t.played,
      wins: t.wins,
      draws: t.draws,
      losses: t.losses,
      delta: est?.delta ?? 0,
      z: est?.z ?? 0,
    });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

// --- Standings -------------------------------------------------------------

export interface PlayerStanding {
  id: string;
  name: string;
  played: number;
  wins: number; // house rule: a shootout counts half (see MatchResult)
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

// What a match is worth to each side under the house rule: a decisive result
// is a full win, a shootout is half a win to whoever took it, and a level
// match nobody recorded penalties for is an honest draw.
export function winShare(m: MatchResult): { a: number; b: number } | null {
  if (m.scoreA == null || m.scoreB == null) return null;
  if (m.scoreA > m.scoreB) return { a: 1, b: 0 };
  if (m.scoreB > m.scoreA) return { a: 0, b: 1 };
  if (m.penaltyWinner === m.a) return { a: 0.5, b: 0 };
  if (m.penaltyWinner === m.b) return { a: 0, b: 0.5 };
  return { a: 0.5, b: 0.5 };
}

export function playerStandings(history: FixtureRecord[]): PlayerStanding[] {
  const out = new Map<string, PlayerStanding>();
  const nameOf = new Map<string, string>();
  for (const fx of history) for (const p of fx.players) nameOf.set(p.id, p.name);

  for (const fx of history) {
    for (const m of fx.matches) {
      const share = winShare(m);
      if (!share) continue;
      const { a, b } = sidesFor(fx.teams, m);
      const level = m.scoreA === m.scoreB;

      for (const [ids, got, gf, ga] of [
        [a, share.a, m.scoreA!, m.scoreB!],
        [b, share.b, m.scoreB!, m.scoreA!],
      ] as const) {
        for (const id of ids) {
          const s =
            out.get(id) ??
            ({
              id,
              name: nameOf.get(id) ?? '?',
              played: 0,
              wins: 0,
              draws: 0,
              losses: 0,
              goalsFor: 0,
              goalsAgainst: 0,
            } satisfies PlayerStanding);
          s.played++;
          s.wins += got;
          if (level) s.draws++;
          else if (got === 0) s.losses++;
          s.goalsFor += gf;
          s.goalsAgainst += ga;
          out.set(id, s);
        }
      }
    }
  }

  return [...out.values()].sort(
    (x, y) => y.wins / (y.played || 1) - x.wins / (x.played || 1) || y.played - x.played,
  );
}
