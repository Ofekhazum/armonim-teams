// The invented club (§2.32). Twenty players, forty Thursdays.
//
// This has to be *plausible* rather than merely present, because almost
// everything it exists to exercise is gated on a pattern rather than on a
// count. A season of coin flips produces no streaks worth a card, no bogey
// man, no duo that clears its shrinkage, and a plus-minus of noise — so the
// page under review looks empty for the same reason it looked empty with real
// data, and nothing has been tested.
//
// So results are simulated *from* team strength with noise on top: good
// players really are better, which gives the ridge solver something true to
// find, and the noise is heavy enough that upsets, droughts and runs happen on
// their own rather than being sprinkled in afterwards.
//
// **Deterministic.** One seed, so the club is the same club every time you open
// it. A sandbox that reshuffled on every reload would make "did that change?"
// unanswerable, which is the one question a test fixture exists to answer.

import type { FixtureRecord, MatchLogEntry, Player, TeamColor, Teams } from './types';
import { ATTACK_DEFAULT } from './types';
import { TEAM_COLORS } from './balancer';
import { OPENING_PAIRS, restingTeam, winsFromLog } from './matchLog';

const SEED = 0x5f3a91;
// Exported rather than kept local: the banner (`TestModeBanner.tsx`) states
// both counts in its copy, and a hardcoded "20 nights" in a second file is
// exactly how that number went stale the first time — NIGHTS moved from 20 to
// 40 and nothing checked that the sentence describing it still agreed.
export const PLAYER_COUNT = 20;

/**
 * How many Thursdays. **Forty, and the number was measured rather than picked.**
 *
 * Twenty was the obvious choice and it is not enough. Teams are redrawn every
 * week, so a given pair only line up together about a third of the nights they
 * both attend — at twenty nights the closest pair in this club had eleven
 * together, and `duos.ts` shrinks a record that short back to the base rate on
 * purpose (see SHRINK_K). The result is a Mates-and-rivals card that stays
 * empty no matter how long you look at it, which is exactly the failure the
 * sandbox exists to stop.
 *
 * Measured, on this seed:
 *
 *   nights │ players with a duo record
 *       20 │  0 / 20
 *       30 │  0 / 20
 *       40 │  6 / 20
 *       52 │  6 / 20
 *
 * Forty is also what puts the keenest players past `VETERAN_NIGHTS = 25`, so
 * the long-service badge can appear at all. Fifty-two buys nothing further.
 */
export const NIGHTS = 40;
const SQUAD_PER_NIGHT = 15; // three fives — the size the balancer is built for

// Hebrew, like the real roster. Not decoration: names are what the profile
// header, the shirt images, the reporter's prompt and every table column
// actually have to lay out, and testing that with "Player 7" tests nothing.
const NAMES = [
  'אופק', 'ירין', 'ניב', 'טום', 'עידו',
  'רון', 'גיא', 'איתי', 'נועם', 'יובל',
  'שחר', 'עומר', 'אלון', 'דור', 'ליאור',
  'אורי', 'בר', 'עמית', 'מתן', 'יהב',
];

// A realistic spread rather than a uniform one: a few who are plainly the best
// players in the room, a thick middle, and a tail. A flat distribution would
// make every team equal and every result noise.
const RATINGS = [
  5, 4.5, 4.5, 4, 4,
  3.5, 3.5, 3.5, 3, 3,
  3, 3, 2.5, 2.5, 2.5,
  2, 2, 2, 1.5, 1.5,
];

// How reliably each one turns up. The spread is the point: it produces an
// ever-present or two, a couple of stragglers who will never clear a threshold,
// and everyone in between — which is what the attendance badges, the presence
// term in a price and the "needs N nights" copy are all reacting to.
const KEENNESS = [
  0.97, 0.95, 0.9, 0.88, 0.85,
  0.84, 0.82, 0.8, 0.78, 0.76,
  0.75, 0.72, 0.7, 0.68, 0.66,
  0.64, 0.6, 0.58, 0.5, 0.45,
];

/** Deterministic PRNG (mulberry32) — same seed, same club, forever. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffled = <T,>(items: T[], rand: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * The most recent Thursday on or before today, then back a week at a time.
 *
 * Anchored to the real calendar rather than to a fixed date, so "this month",
 * "last month" and Team of the Month all have something to be about. That
 * makes the *dates* move week to week while the football stays identical,
 * which is the right way round: the results are what you are reviewing.
 */
function thursdays(count: number): string[] {
  const now = new Date();
  const anchor = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = new Date(anchor).getUTCDay();
  const back = (day - 4 + 7) % 7; // 4 = Thursday
  const latest = anchor - back * 86_400_000;
  return Array.from({ length: count }, (_, i) =>
    new Date(latest - (count - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
  );
}

const TEST_PREFIX = 'test-';

/** The invented squad. Ids are prefixed so one can never be mistaken for a real one. */
export function testPlayers(): Player[] {
  const rand = rng(SEED);
  // Three parallel arrays, so a mismatch would silently hand somebody an
  // undefined rating and poison every result generated from it.
  if (NAMES.length !== PLAYER_COUNT || RATINGS.length !== PLAYER_COUNT || KEENNESS.length !== PLAYER_COUNT) {
    throw new Error('testData: NAMES, RATINGS and KEENNESS must all be PLAYER_COUNT long');
  }
  return NAMES.map((name, i) => ({
    id: `${TEST_PREFIX}p${String(i + 1).padStart(2, '0')}`,
    name,
    rating: RATINGS[i],
    // Spread across the spectrum so the role badges and the balancer's
    // attack/defence weighting have something to do.
    attack: Math.round(ATTACK_DEFAULT + (rand() - 0.5) * 70),
    number: i + 1,
    chemistry: [],
    avoid: [],
    aliases: [],
  }));
}

const strengthOf = (ids: string[], rating: Map<string, number>): number =>
  ids.reduce((sum, id) => sum + (rating.get(id) ?? 3), 0) / Math.max(1, ids.length);

/**
 * One night of football.
 *
 * Roughly three nights in four are logged match by match; the rest are a tally
 * typed in at the end. Both paths are real — a night from before the match log
 * existed only ever had a tally — and the app has to keep reading both, so the
 * sandbox contains both.
 */
function playNight(
  date: string,
  teams: Teams,
  rating: Map<string, number>,
  rand: () => number,
): { wins: FixtureRecord['wins']; matchLog?: MatchLogEntry[] } {
  const strength = Object.fromEntries(
    TEAM_COLORS.map((c) => [c, strengthOf(teams[c], rating)]),
  ) as Record<TeamColor, number>;

  // Who wins one match. The gap matters but does not decide it: at a full point
  // of team-average advantage this is about a 70/30, which is roughly what
  // five-a-side actually looks like and leaves room for the upsets that make
  // a streak or a drought happen by itself.
  const beats = (a: TeamColor, b: TeamColor): TeamColor => {
    const edge = (strength[a] - strength[b]) * 0.55;
    return rand() < 1 / (1 + Math.exp(-edge)) ? a : b;
  };

  if (rand() < 0.75) {
    const log: MatchLogEntry[] = [];
    let [a, b] = OPENING_PAIRS[Math.floor(rand() * OPENING_PAIRS.length)];
    const matches = 9 + Math.floor(rand() * 4);
    for (let i = 0; i < matches; i++) {
      const winner = beats(a, b);
      log.push({ a, b, winner, viaPenalties: rand() < 0.16 });
      // winner stays on, the resting team comes in — the same rotation the
      // app enforces, so this log is one the fixture page could have produced
      [a, b] = [winner, restingTeam(a, b)];
    }
    return { wins: winsFromLog(log), matchLog: log };
  }

  // Tally-only: the same football, counted rather than logged.
  const wins = { black: 0, white: 0, blue: 0 };
  const matches = 9 + Math.floor(rand() * 4);
  let [a, b] = OPENING_PAIRS[Math.floor(rand() * OPENING_PAIRS.length)];
  for (let i = 0; i < matches; i++) {
    const winner = beats(a, b);
    wins[winner] += rand() < 0.16 ? 0.5 : 1;
    [a, b] = [winner, restingTeam(a, b)];
  }
  return { wins };
}

// A handful of nights carry an organiser's note, because the reporter's
// handling of one is the thing hardest to check without a night that has one.
const NOTES = [
  'הכדור עף מעל הגדר בערך חמש פעמים, כולן של אותו אחד',
  'התאורה נפלה באמצע המשחק החמישי וחיכינו עשר דקות',
  'מישהו הביא עוגה ליום הולדת, אכלנו לפני ואחרי',
];

/**
 * Every night, oldest first — the order `AppState.history` is kept in.
 *
 * Ids carry the same `test-` prefix as the players. It is what makes a stray
 * record obvious on sight if one ever turns up somewhere it should not be.
 */
export function testHistory(players: Player[]): FixtureRecord[] {
  const rand = rng(SEED + 1);
  const rating = new Map(players.map((p) => [p.id, p.rating]));
  const dates = thursdays(NIGHTS);

  return dates.map((date, night) => {
    // Attendance: a roll against each player's keenness, then trimmed or
    // topped up to fifteen so every night is a clean three-by-five.
    const keen = players.filter((_, i) => rand() < KEENNESS[i]).map((p) => p.id);
    const rest = shuffled(
      players.map((p) => p.id).filter((id) => !keen.includes(id)),
      rand,
    );
    const present = shuffled(keen, rand).slice(0, SQUAD_PER_NIGHT);
    while (present.length < SQUAD_PER_NIGHT && rest.length) present.push(rest.pop()!);

    const cut = shuffled(present, rand);
    const teams: Teams = {
      black: cut.slice(0, 5),
      white: cut.slice(5, 10),
      blue: cut.slice(10, 15),
    };

    const { wins, matchLog } = playNight(date, teams, rating, rand);

    // The MVP usually comes from the team that took the night, and usually
    // from its better players — which is what makes the pick correlate with
    // everything else instead of being a twentieth column of noise.
    const top = TEAM_COLORS.reduce((best, c) => (wins[c] > wins[best] ? c : best), 'black' as TeamColor);
    const pool = rand() < 0.8 ? teams[top] : present;
    const ranked = [...pool].sort((x, y) => (rating.get(y) ?? 3) - (rating.get(x) ?? 3));
    const mvpId = rand() < 0.9 ? ranked[Math.floor(rand() * Math.min(3, ranked.length))] : undefined;

    return {
      id: `${TEST_PREFIX}${date}`,
      date,
      teams,
      players: present.map((id) => ({
        id,
        name: players.find((p) => p.id === id)!.name,
        rating: rating.get(id) ?? 3,
      })),
      wins,
      ...(matchLog ? { matchLog } : {}),
      ...(mvpId ? { mvpId } : {}),
      ...(night % 7 === 3 ? { note: NOTES[(night / 7) | 0] ?? NOTES[0] } : {}),
    };
  });
}

/**
 * The whole invented club.
 *
 * Returns the roster and the archive but deliberately **not** a session: that
 * belongs to `storage.ts`, which owns `emptySession()`. Building one here would
 * mean two copies of what an empty night looks like, and importing it from
 * `storage.ts` would put a cycle through the module that decides which key the
 * app opens — the last place in this codebase that should have one.
 */
export function buildTestClub(): { players: Player[]; history: FixtureRecord[] } {
  const players = testPlayers();
  return { players, history: testHistory(players) };
}
