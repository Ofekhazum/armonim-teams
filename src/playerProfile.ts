// Everything one player's page shows, counted from the nights already on
// record (§2.19).
//
// Nothing here is new data. It is the same history the standings table, the
// badges and the milestones are built from, sliced per player instead of per
// column — which is the whole reason a profile page is cheap: the counting was
// already being done, just never gathered in one place with somebody's name on
// it.
//
// One rule runs through all of it. The app records three teams and how many
// matches each won; it has never recorded an individual. So a player's wins
// are the wins of the teams he was in, and the wording here says so wherever
// it could be misread — "his team won it on penalties", never "he won it".

import type { FixtureRecord, MatchLogEntry, TeamColor, TeamWins } from './types';
import { TEAM_COLORS } from './balancer';
import { hasResult } from './calibration';
import {
  isFixtureWinMilestone,
  isMilestoneNight,
  isMvpMilestone,
  isWinMilestone,
  winnerOf,
} from './milestones';

// How much football before a *rate* is worth printing. The same bar the
// rating calibration uses (`MIN_NIGHTS`), and deliberately one number rather
// than a different threshold per statistic: a page that shows "67%" under one
// heading and "not enough nights yet" under the next, off the same four
// nights, is a page nobody can calibrate their trust against.
export const MIN_PROFILE_NIGHTS = 4;

// Which shirt this player wore that night, if they were on the sheet at all.
export const shirtOf = (fx: FixtureRecord, id: string): TeamColor | null =>
  TEAM_COLORS.find((c) => fx.teams[c].includes(id)) ?? null;

// --- The night-by-night ribbon ---------------------------------------------

// Where a team finished that night, out of the three. Standard competition
// ranking: a place is one more than the number of teams strictly above, so two
// teams level at the top are both 1st and the third is 3rd, not 2nd.
export type Place = 1 | 2 | 3;

// Note this is a *placement*, not a win. `winnerOf` (§2.6) says nobody took a
// night that ended level at the top, and that stays true — `nights won` counts
// outright wins only. Two teams genuinely level did both finish first, though,
// so the ribbon gives them both gold and the tooltip says it was shared.
export function placeOf(wins: TeamWins, shirt: TeamColor): Place {
  const mine = wins[shirt] ?? 0;
  return (TEAM_COLORS.filter((c) => (wins[c] ?? 0) > mine).length + 1) as Place;
}

// Did anyone else finish on exactly the same number?
export const sharedPlace = (wins: TeamWins, shirt: TeamColor): boolean =>
  TEAM_COLORS.filter((c) => (wins[c] ?? 0) === (wins[shirt] ?? 0)).length > 1;

export interface ProfileNight {
  fixtureId: string;
  date: string;
  shirt: TeamColor;
  // 1st / 2nd / 3rd on the night, or null when no result was ever recorded
  place: Place | null;
  shared: boolean;
  // whether this player's team took the night outright. Null on a night whose
  // result was never entered — which is not a loss, and must not be drawn as
  // one. `appearances` in milestones.ts drops those nights entirely; a ribbon
  // cannot, because it is a picture of *turning up* as much as of winning.
  won: boolean | null;
  wins: number; // what their team took that night
}

// Every night this player was on the sheet, oldest first — the ribbon in
// order, and the thing most of the counts below are derived from.
export function profileNights(history: FixtureRecord[], id: string): ProfileNight[] {
  return [...history]
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((fx) => {
      const shirt = shirtOf(fx, id);
      if (!shirt) return [];
      const decided = hasResult(fx.wins);
      return [
        {
          fixtureId: fx.id,
          date: fx.date,
          shirt,
          place: decided ? placeOf(fx.wins, shirt) : null,
          shared: decided && sharedPlace(fx.wins, shirt),
          won: decided ? winnerOf(fx) === shirt : null,
          wins: fx.wins[shirt] ?? 0,
        },
      ];
    });
}

// How many nights in each shirt. Pure trivia — it proves nothing about anyone
// — but it is the kind of trivia a squad enjoys, and unlike most of what a
// profile page could show, it is not an inference at all: it is a count of
// what colour someone wore.
export function shirtNights(nights: ProfileNight[]): Record<TeamColor, number> {
  const out: Record<TeamColor, number> = { black: 0, white: 0, blue: 0 };
  for (const n of nights) out[n.shirt]++;
  return out;
}

// --- The counted line -------------------------------------------------------

export interface ProfileCounts {
  nights: number; // nights with a result — what every rate below is over
  onSheet: number; // nights turned up for, result or not
  nightsWon: number; // nights their team finished top of
  wins: number; // matches their teams won, a shootout counting half
  perNight: number | null; // null only when there is nothing to divide by
  currentRun: number; // nights won in a row, right now
  bestRun: number; // the longest such run ever
}

export function profileCounts(nights: ProfileNight[]): ProfileCounts {
  const decided = nights.filter((n) => n.won !== null);
  let best = 0;
  let run = 0;
  for (const n of decided) {
    run = n.won ? run + 1 : 0;
    if (run > best) best = run;
  }
  const wins = decided.reduce((sum, n) => sum + n.wins, 0);
  return {
    nights: decided.length,
    onSheet: nights.length,
    nightsWon: decided.filter((n) => n.won).length,
    wins,
    // No threshold, unlike everything else on that page that carries one.
    // The rest of them are *inferences* — a bogey man, mates and rivals,
    // shootout form — and a claim about who somebody struggles against, off
    // two nights, is noise. This is not an inference: it is `wins / nights`,
    // and both of those numbers are in the tiles either side of it, so
    // withholding it only hid arithmetic the reader could do by looking left.
    // Null is kept for the one case it means something — no nights to divide by.
    perNight: decided.length > 0 ? wins / decided.length : null,
    currentRun: run, // the loop ends on the most recent night, so this is it
    bestRun: best,
  };
}

// --- The milestone ladder ---------------------------------------------------

export interface Rung {
  target: number;
  reached: boolean;
}

// The ladder of night counts and win counts a player is climbing, as rungs
// rather than as a surprise on the fixture page. `tonightsMilestones` already
// announces the moment one is crossed (§2.9); this is the same ladder standing
// still, so the announcement reads as an arrival rather than a trick.
//
// Shows every rung already reached plus the next one, and nothing beyond it:
// a list running out to 500 wins is a list about the ladder, not about the
// player standing on it.
function ladder(count: number, isRung: (n: number) => boolean, ceiling: number): Rung[] {
  const rungs: Rung[] = [];
  for (let n = 1; n <= ceiling; n++) {
    if (!isRung(n)) continue;
    rungs.push({ target: n, reached: n <= count });
    if (n > count) break; // the next one, and then stop
  }
  return rungs;
}

// Ceilings are just loop bounds — high enough that a real player never reaches
// them, low enough that this stays a handful of iterations.
export const nightRungs = (nights: number): Rung[] => ladder(nights, isMilestoneNight, 5_000);
export const winRungs = (wins: number): Rung[] => ladder(Math.floor(wins), isWinMilestone, 50_000);
export const fixtureRungs = (won: number): Rung[] => ladder(won, isFixtureWinMilestone, 5_000);
export const mvpRungs = (picks: number): Rung[] => ladder(picks, isMvpMilestone, 1_000);

// --- Ladder badges ----------------------------------------------------------

export interface LadderBadge {
  key: string;
  icon: string;
  // what it is, short enough to wear: "25 nights"
  label: string;
  // how it was earned, in a sentence — shown on hover, and on tap, because a
  // phone has no hover and a badge nobody can decode is decoration
  detail: string;
  // How many rungs of *this* ladder have been passed — 1 the first time it is
  // worn, climbing by one every time a further rung is crossed. Not capped
  // here: nightRungs alone has rungs every 50 nights past the first two, so a
  // long career passes far more than three of them, and a scheme that stopped
  // counting at "gold" would make the badge stop meaning anything for exactly
  // the players who have earned the most of it. Where a tier count this high
  // still fits on screen is a rendering decision, made in PlayerPage.
  tier: number;
}

// The top rung reached on each ladder, worn as a badge — together with how
// many rungs of that ladder have been passed, which is the tier.
//
// The highest rung only, not every one crossed: a player four ladders deep
// would otherwise carry a dozen chips, and "10 nights" stops being worth saying
// the moment "25 nights" is true. The ladder card underneath still shows the
// whole climb, so nothing is hidden — this is the headline of it, and the tier
// is how far up that hidden climb the headline actually sits.
export function ladderBadges(
  counts: Pick<ProfileCounts, 'nights' | 'nightsWon' | 'wins'>,
  mvps: number,
): LadderBadge[] {
  const top = (rungs: Rung[]): { target: number; tier: number } | null => {
    const reached = rungs.filter((r) => r.reached);
    return reached.length
      ? { target: reached[reached.length - 1].target, tier: reached.length }
      : null;
  };

  const out: LadderBadge[] = [];
  const nights = top(nightRungs(counts.nights));
  if (nights) {
    out.push({
      key: `nights-${nights.target}`,
      icon: '🎽',
      label: `${nights.target} nights`,
      detail: `Played ${nights.target} recorded nights.`,
      tier: nights.tier,
    });
  }
  const wins = top(winRungs(counts.wins));
  if (wins) {
    out.push({
      key: `wins-${wins.target}`,
      icon: '🏆',
      label: `${wins.target} wins`,
      detail: `Their teams have won ${wins.target} matches with them on the pitch.`,
      tier: wins.tier,
    });
  }
  const fixtures = top(fixtureRungs(counts.nightsWon));
  if (fixtures) {
    out.push({
      key: `fixtures-${fixtures.target}`,
      icon: '🥇',
      label: `${fixtures.target} nights won`,
      detail: `Finished top of the night ${fixtures.target} times.`,
      tier: fixtures.tier,
    });
  }
  const picks = top(mvpRungs(mvps));
  if (picks) {
    out.push({
      key: `mvp-${picks.target}`,
      icon: '🌟',
      label: picks.target === 1 ? 'First MVP' : `${picks.target} MVPs`,
      detail:
        picks.target === 1
          ? 'Picked MVP for the first time.'
          : `Picked MVP on ${picks.target} different nights.`,
      tier: picks.tier,
    });
  }
  return out;
}

// How far off the next rung is, or null when it has just been reached exactly.
export function toGo(rungs: Rung[], count: number): { target: number; away: number } | null {
  const next = rungs.find((r) => !r.reached);
  return next ? { target: next.target, away: next.target - Math.floor(count) } : null;
}

// --- Teammates --------------------------------------------------------------

export interface Matchup {
  id: string;
  name: string;
  // --- on the same team
  together: number; // nights alongside, with a result recorded
  togetherWon: number; // of those, nights their team finished top of
  // --- on opposite teams
  against: number; // nights on different teams
  // The head-to-head, counted in *matches* rather than nights, and therefore
  // only from nights logged match by match (§2.17). A night is a blunt unit
  // for a rivalry: two players can be opponents for two hours and the night
  // records one winner between three teams. Matches are the thing they
  // actually played against each other.
  faced: number; // matches with these two on opposite sides
  beat: number; // of those, matches this player's team won
  beatenBy: number; // of those, matches the other player's team won
}

// Everyone this player has shared a pitch with, and what happened.
//
// One pass, both halves. The app has always counted who somebody plays *with*
// and never who they play *against*, even though every night puts them
// opposite ten people — which left the most naturally competitive thing in the
// ledger unread.
//
// `beat` and `beatenBy` only count nights one of the two teams actually took:
// with three teams on the pitch, two players can be opponents on a night the
// third team wins, and that is a night neither of them beat anybody. Note also
// what these are counts *of* — one team finishing above another, not one
// person beating another. The labels can have their fun; the sentences say the
// true thing (§2.8).
export function matchups(history: FixtureRecord[], id: string): Matchup[] {
  const nameOf = new Map<string, string>();
  const rec = new Map<string, Omit<Matchup, 'id' | 'name'>>();
  const get = (other: string) =>
    rec.get(other) ??
    { together: 0, togetherWon: 0, against: 0, faced: 0, beat: 0, beatenBy: 0 };

  for (const fx of history) {
    if (!hasResult(fx.wins)) continue;
    const mine = shirtOf(fx, id);
    if (!mine) continue;
    const winner = winnerOf(fx);

    // The head-to-head half, per shirt: how many matches this player's team
    // won and lost against each other shirt on this night.
    const log = fx.matchLog ?? [];
    const won = new Map<TeamColor, number>();
    const lost = new Map<TeamColor, number>();
    for (const m of log) {
      if (m.a !== mine && m.b !== mine) continue; // a match they sat out
      const foe = m.a === mine ? m.b : m.a;
      const table = m.winner === mine ? won : lost;
      table.set(foe, (table.get(foe) ?? 0) + 1);
    }

    for (const c of TEAM_COLORS) {
      for (const other of fx.teams[c]) {
        if (other === id) continue;
        const r = get(other);
        if (c === mine) {
          r.together++;
          if (winner === mine) r.togetherWon++;
        } else {
          r.against++;
          const w = won.get(c) ?? 0;
          const l = lost.get(c) ?? 0;
          r.faced += w + l;
          r.beat += w;
          r.beatenBy += l;
        }
        rec.set(other, r);
        nameOf.set(other, fx.players.find((p) => p.id === other)?.name ?? '?');
      }
    }
  }

  return [...rec.entries()]
    .map(([other, r]) => ({ id: other, name: nameOf.get(other) ?? '?', ...r }))
    .sort((a, b) => b.together - a.together || a.name.localeCompare(b.name, 'he'));
}

// The pick of each column, or null when nothing in it is worth naming. Ties go
// to the player who has shared more football, then to the name — never to
// whichever way the sort happened to fall.
const pickBy = (
  list: Matchup[],
  value: (m: Matchup) => number,
  floor: number,
): Matchup | null => {
  const best = [...list]
    .filter((m) => value(m) >= floor)
    .sort((a, b) => value(b) - value(a) || b.together + b.against - (a.together + a.against))[0];
  return best ?? null;
};

// How much shared football before a pairing is worth a line of its own. Low,
// because these are counts rather than claims — but not one, because "you have
// beaten him once" is a sentence about an evening, not about a rivalry.
export const MIN_MATCHUP = 2;

// The same idea for the head-to-head half, in matches. A logged night puts two
// opponents against each other several times over, so this is a couple of
// nights' worth rather than a couple of matches — enough that a record is
// about how they play each other rather than about one evening.
export const MIN_FACED = 8;

/**
 * How often somebody has to beat you before they are a bogey man — and, read
 * the other way, how level a record has to stay to be a *rivalry*.
 *
 * One constant doing both jobs is the fix for a real bug: the bogey man and
 * the worthy opponent kept coming out as **the same person**. The bogey pick
 * used to be a raw count of matches lost, so the player you had faced most was
 * usually top of it — and the player you have faced most is also, very often,
 * the one with the closest record, because a long record has had time to even
 * out. A 10–12 head-to-head is simultaneously "the most matches he has beaten
 * you in" and "the most level record you have", and the page said both about
 * one man on the same card.
 *
 * A *rate* is the right question anyway — being beaten twelve times by the man
 * you have played ninety matches against is not a bogey man, it is a lot of
 * football. Once the bogey is a rate, using the same number as the ceiling for
 * `worthy` makes the two **mutually exclusive by construction** rather than by
 * a tie-break somewhere: at 60%, a bogey man is someone who takes at least
 * three in five, and a rivalry stays worthy only while neither of them does.
 *
 * Sixty per cent against `MIN_FACED = 8` means the thinnest possible bogey man
 * is a 5–3 record. That is deliberately not a high bar — this is a count on a
 * page about somebody's own football, not a claim about the club — but it is
 * far enough off even that the two picks can never be one person again.
 */
export const BOGEY_RATE = 0.6;

export interface MatchupPicks {
  playedMost: Matchup | null; // most nights alongside
  wonMost: Matchup | null; // most nights *won* alongside — a different question
  facedMost: Matchup | null; // most matches on opposite sides
  bogey: Matchup | null; // beats them the highest share of the time
  victim: Matchup | null; // and the other way round
  worthy: Matchup | null; // the closest record of the lot
  neverTogether: Matchup | null; // seen plenty, never once on the same team
}

const shareOf = (wins: number, faced: number): number => (faced > 0 ? wins / faced : 0);

// The highest *share*, not the highest count. Ties go to the pairing with more
// football behind it — 6 of 8 beats 3 of 4, both being three-quarters — and
// then to the name, never to whichever way the sort happened to fall.
const pickByShare = (list: Matchup[], wins: (m: Matchup) => number): Matchup | null => {
  const best = [...list]
    .filter((m) => m.faced >= MIN_FACED && shareOf(wins(m), m.faced) >= BOGEY_RATE)
    .sort(
      (a, b) =>
        shareOf(wins(b), b.faced) - shareOf(wins(a), a.faced) ||
        b.faced - a.faced ||
        a.name.localeCompare(b.name, 'he'),
    )[0];
  return best ?? null;
};

// The most even head-to-head anybody has: fewest matches between the two
// columns, and among equally close records the one with the most football
// behind it — 6–5 is a worthier rivalry than 1–1, and both are a gap of one.
//
// The BOGEY_RATE ceiling is what keeps this from naming the same person the
// bogey pick just named. A record where one side takes three in five is a
// mismatch being described as a rivalry.
function pickWorthy(list: Matchup[]): Matchup | null {
  const gap = (m: Matchup) => Math.abs(m.beat - m.beatenBy);
  const level = (m: Matchup) => shareOf(Math.max(m.beat, m.beatenBy), m.faced) < BOGEY_RATE;
  const best = [...list]
    .filter((m) => m.faced >= MIN_FACED && level(m))
    .sort((a, b) => gap(a) - gap(b) || b.faced - a.faced || a.name.localeCompare(b.name, 'he'))[0];
  return best ?? null;
}

const NO_PICKS: MatchupPicks = {
  playedMost: null,
  wonMost: null,
  facedMost: null,
  bogey: null,
  victim: null,
  worthy: null,
  neverTogether: null,
};

/**
 * `subjectNights` is the whole card's gate: below `MIN_PROFILE_NIGHTS` it says
 * nothing at all.
 *
 * The per-pair floor above is about whether *that pairing* is worth a line;
 * this is about whether the player has been around long enough for any of it
 * to be about them. Somebody two nights in has a bogey man and a favourite
 * victim by arithmetic, and naming either is a joke at the expense of a fact
 * that isn't there yet. Same number the rest of the page uses.
 */
export function matchupPicks(list: Matchup[], subjectNights: number): MatchupPicks {
  if (subjectNights < MIN_PROFILE_NIGHTS) return NO_PICKS;
  return {
    playedMost: pickBy(list, (m) => m.together, MIN_MATCHUP),
    wonMost: pickBy(list, (m) => m.togetherWon, MIN_MATCHUP),
    facedMost: pickBy(list, (m) => m.faced, MIN_FACED),
    bogey: pickByShare(list, (m) => m.beatenBy),
    victim: pickByShare(list, (m) => m.beat),
    worthy: pickWorthy(list),
    // the joke only lands if they have actually been around each other a lot
    neverTogether: pickBy(
      list.filter((m) => m.together === 0),
      (m) => m.against,
      MIN_MATCHUP * 2,
    ),
  };
}

// --- Shootouts --------------------------------------------------------------

export interface ShootoutRecord {
  loggedNights: number; // nights on this player's sheet that were logged match by match
  taken: number; // matches their team won on penalties
  wonInPlay: number; // matches their team won before it got that far
}

// Only nights written down match by match can answer this: a win tally records
// half-wins, but not *which* matches they were. So the record is explicitly
// over the logged nights alone, and the page says how many those are — two
// counts over different windows are fine, two that look like they cover the
// same window are not.
export function shootoutRecord(history: FixtureRecord[], id: string): ShootoutRecord {
  let loggedNights = 0;
  let taken = 0;
  let wonInPlay = 0;
  for (const fx of history) {
    const shirt = shirtOf(fx, id);
    if (!shirt || !fx.matchLog?.length) continue;
    loggedNights++;
    for (const m of fx.matchLog) {
      if (m.winner !== shirt) continue;
      if (m.viaPenalties) taken++;
      else wonInPlay++;
    }
  }
  return { loggedNights, taken, wonInPlay };
}

// Shootouts won by each player's teams, across every logged night — the input
// to the 🎯 badge. Keyed by player id; anybody whose nights were all tallied
// rather than logged simply isn't in the map.
export function shootoutWins(history: FixtureRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (ids: string[], by: number) => {
    for (const id of ids) out.set(id, (out.get(id) ?? 0) + by);
  };
  for (const fx of history) {
    if (!fx.matchLog?.length) continue;
    const penalties = fx.matchLog.filter((m: MatchLogEntry) => m.viaPenalties);
    for (const c of TEAM_COLORS) {
      bump(fx.teams[c], penalties.filter((m) => m.winner === c).length);
    }
  }
  return out;
}

// Nights on a player's sheet that were logged match by match. The 🎯 badge is
// gated on this rather than on nights played: a shootout count from one logged
// night is not a fact about anybody.
export function loggedNightsFor(history: FixtureRecord[], id: string): number {
  return history.filter((fx) => fx.matchLog?.length && shirtOf(fx, id)).length;
}
