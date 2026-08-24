// A price tag for a player (§2.31).
//
// The idea is Transfermarkt's: a single number, in euros, that says roughly
// what someone is worth to the club and moves a little every week. The reason
// it is built the way it is below is §2.28 — ratings are the organiser's
// private opinion and do not leave the Worker — and a price tag is the easiest
// possible way to undo that. Publish a number that is a monotone function of a
// rating and you have published the rating, the whole ordering of the club, and
// a euro figure against each friend's name.
//
// So the rating is one of *five* terms, it enters as a three-way tier rather
// than as a number, and it is the narrowest band in the formula. Four public
// terms move the price around it. The most anyone can recover from a published
// value is roughly which third of the club somebody sits in — which everyone
// already knows — and never a star value or the order inside a tier.
//
// **Where this runs.** In the Worker, on `GET /values`. A public device has no
// ratings at all and physically cannot compute this; the Worker still holds
// them, because only the *read* is stripped. One implementation, in one place,
// so nothing can disagree with itself — the same reason `src/totm.ts` exists.
//
// **What it is not.** It is not a rating, and the UI must never present it as
// one. It is a season summarised as a price: results, appearances and honours,
// with a coarse nod to how good the organiser thinks somebody is.

import type { FixtureRecord, Player } from './types';
import { resultStrength } from './calibration';
import { playerAchievements } from './achievements';
import { profileNights } from './playerProfile';

/**
 * Nights on record before *anybody* has a price. This is a privacy gate, not a
 * quality one, and it is the sharpest edge in the file.
 *
 * With no history at all, every term except the tier is neutral by
 * construction, so the price is exactly `BASE × tier` — three distinct numbers
 * across the whole club, and the tier is simply *published*. One or two nights
 * is barely better: a handful of possible prices, each decoding to a tier.
 *
 * The obscuring only works once results, attendance and honours have had time
 * to pull players apart, so nothing is served until they have. Five nights is
 * the same floor `MIN_HISTORY_FOR_DEBUTS` uses, for the same kind of reason —
 * a fact that needs a history to mean anything must wait for one.
 */
export const MIN_HISTORY_FOR_VALUES = 5;

// The price of a player nothing is known about: no football, no honours, an
// ordinary rating. Every term below multiplies this rather than adding to it,
// the way a real valuation moves — additive terms let one big number swamp the
// rest, where proportional ones keep every term honest and the range sane.
export const BASE = 6.0;

/**
 * The rating, coarsened.
 *
 * Three tiers, and deliberately the **narrowest band in the formula**. A
 * continuous map from rating to price is invertible: knowing the four public
 * terms, you solve for the fifth. Bucketed at ±18% the same arithmetic recovers
 * only which third of the club someone is in.
 */
const tierOf = (rating: number): number => (rating <= 2.5 ? 0.85 : rating >= 4 ? 1.18 : 1.0);

// What their presence has been worth, from results alone (see `resultStrength`).
// Weighted modestly and clamped tight: it is correlated with the win rate in
// `form` below, so a wide band here would be counting the same football twice.
const IMPACT_W = 0.3;
const IMPACT_MIN = 0.9;
const IMPACT_MAX = 1.15;

// The career record, as a share of nights their team finished top of. Measured
// against the club's own rate rather than against a third, because three teams
// tie for the night often enough that nobody wins it.
const FORM_W = 1.6;
const FORM_MIN = 0.75;
const FORM_MAX = 1.35;

// Nights of evidence a record is shrunk toward the club rate by. Without it a
// two-night player who won both is the most valuable man in the club — the
// same failure `duos.ts` uses SHRINK_K to avoid, at the scale this needs.
const SHRINK_K = 6;

// The recent window, and how many of it must have been played before it is
// allowed to say anything. Measured against the player's *own* shrunk rate, so
// the arrow means "hot" rather than "good" and a mid-table regular can be the
// biggest riser of the week.
const RECENT_NIGHTS = 5;
const MIN_RECENT = 3;
const MOMENTUM_W = 0.45;
const MOMENTUM_MIN = 0.88;
const MOMENTUM_MAX = 1.15;

// Turning up is worth money. Entirely a count, entirely public, and the term
// that does most of the work of hiding the tier — it moves the price enough
// that no clean read-back survives it.
const PRESENCE_NIGHTS = 10;
const PRESENCE_FLOOR = 0.85;
const PRESENCE_SPAN = 0.25;

// The long grind: badges held, and months named in the Team of the Month.
// Capped so a decorated veteran cannot run away with the whole table.
const PER_BADGE = 0.04;
const PER_MONTH = 0.06;
const HONOURS_MAX = 1.3;

/**
 * The most a value may move in a week, as a share of the last one.
 *
 * A price that lurches four million because one night went badly is noise. One
 * that climbs for six weeks is a story, and the story is the entire feature.
 */
export const MAX_SWING = 0.15;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Prices look like prices, and the arithmetic stops being invertible exactly.
 *
 * Quarter-million steps under ten, half-million over — the same coarsening
 * real transfer values have, and enough granularity that a good month still
 * visibly moves the number.
 */
export function quantise(value: number): number {
  const step = value < 10 ? 0.25 : 0.5;
  return Math.round(Math.round(value / step) * step * 100) / 100;
}

/** How many months this player has been named in the registered five. */
export type MonthsWon = (id: string) => number;

interface Parts {
  tier: number;
  impact: number;
  form: number;
  momentum: number;
  presence: number;
  honours: number;
}

/**
 * Every term, before quantising or damping. Exported for tests: the parts are
 * what a formula change should be asserted against, and they are deliberately
 * **never published** — five multipliers are five equations, and five equations
 * are the tier.
 */
export function valuationParts(
  history: FixtureRecord[],
  players: Player[],
  monthsWon: MonthsWon,
): Map<string, Parts> {
  const byDate = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const strength = resultStrength(byDate);
  const records = playerAchievements(byDate);

  // The club's own rate of taking a night outright, over every player-night on
  // record. Below a third, because a tie at the top means nobody won it.
  let playerNights = 0;
  let playerNightsWon = 0;
  for (const p of players) {
    for (const night of profileNights(byDate, p.id)) {
      if (night.won === null) continue;
      playerNights++;
      if (night.won) playerNightsWon++;
    }
  }
  const clubRate = playerNights > 0 ? playerNightsWon / playerNights : 1 / 3;

  // Attendance is over nights *held*, whether or not anyone tallied them —
  // missing a night is missing a night regardless of whether the score got
  // written down.
  const recent = byDate.slice(-PRESENCE_NIGHTS);

  const out = new Map<string, Parts>();
  for (const player of players) {
    const nights = profileNights(byDate, player.id);
    // Nobody who has never been on a sheet gets a price. Partly because a new
    // name has no season to summarise — Transfermarkt does the same — but
    // mainly because every term except the tier would be neutral for them, and
    // `BASE × tier` is the tier with a euro sign in front of it.
    if (nights.length === 0) continue;

    const tier = tierOf(player.rating);
    const decided = nights.filter((n) => n.won !== null);
    const nightsWon = decided.filter((n) => n.won).length;
    const rate = (nightsWon + SHRINK_K * clubRate) / (decided.length + SHRINK_K);

    const recentWindow = decided.slice(-RECENT_NIGHTS);
    const recentRate =
      recentWindow.length >= MIN_RECENT
        ? recentWindow.filter((n) => n.won).length / recentWindow.length
        : null;

    const played = recent.filter((fx) => nights.some((n) => n.fixtureId === fx.id)).length;
    const share = recent.length > 0 ? played / recent.length : 1;

    const record = records.get(player.id);

    out.set(player.id, {
      tier,
      impact: clamp(1 + IMPACT_W * (strength.get(player.id)?.delta ?? 0), IMPACT_MIN, IMPACT_MAX),
      form: clamp(1 + FORM_W * (rate - clubRate), FORM_MIN, FORM_MAX),
      momentum:
        recentRate === null
          ? 1
          : clamp(1 + MOMENTUM_W * (recentRate - rate), MOMENTUM_MIN, MOMENTUM_MAX),
      presence: PRESENCE_FLOOR + PRESENCE_SPAN * share,
      honours: Math.min(
        HONOURS_MAX,
        1 + PER_BADGE * (record?.achievements.length ?? 0) + PER_MONTH * monthsWon(player.id),
      ),
    });
  }
  return out;
}

const priceOf = (p: Parts): number =>
  BASE * p.tier * p.impact * p.form * p.momentum * p.presence * p.honours;

export interface Valuation {
  id: string;
  /** In millions of euros, quantised and damped. */
  value: number;
  /** What it was before the most recent night, or null for a first appearance. */
  previous: number | null;
}

/**
 * Everyone's price, this week and last.
 *
 * Last week's is the same formula over the history with the most recent night
 * removed, rather than a stored figure — so there is nothing to keep in sync,
 * nothing to migrate, and a corrected result recomputes both sides at once.
 * That is also what makes the swing cap safe to apply: it clamps against a
 * number derived from the same code, not against whatever happened to be
 * written down last time.
 */
export function marketValues(
  history: FixtureRecord[],
  players: Player[],
  monthsWon: MonthsWon = () => 0,
): Map<string, Valuation> {
  const byDate = [...history].sort((a, b) => a.date.localeCompare(b.date));
  // The gate that makes the whole thing safe to publish — see
  // MIN_HISTORY_FOR_VALUES. An empty map is the correct answer, and the page
  // that reads it says the club is not there yet rather than showing nothing.
  if (byDate.length < MIN_HISTORY_FOR_VALUES) return new Map();

  const latest = byDate[byDate.length - 1].date;
  // A night is a date, not a record: two fixtures filed under one evening are
  // one week's football and have to leave the "before" history together.
  const earlier = byDate.filter((fx) => fx.date !== latest);

  const now = valuationParts(byDate, players, monthsWon);
  const before = earlier.length > 0 ? valuationParts(earlier, players, monthsWon) : null;

  const out = new Map<string, Valuation>();
  for (const player of players) {
    const parts = now.get(player.id);
    if (!parts) continue;

    const priorParts = before?.get(player.id);
    // A player with no football behind them has no previous price to be held
    // to — their first valuation is allowed to be whatever it is.
    const previous =
      priorParts && profileNights(earlier, player.id).length > 0
        ? quantise(priceOf(priorParts))
        : null;

    const raw = priceOf(parts);
    const damped =
      previous === null
        ? raw
        : clamp(raw, previous * (1 - MAX_SWING), previous * (1 + MAX_SWING));

    out.set(player.id, { id: player.id, value: quantise(damped), previous });
  }
  return out;
}

// Rendering a price lives in `src/values.ts`, with the fetch that gets one —
// so a phone never imports this file, and the ridge solver and six tuning
// constants stay out of the client bundle.
