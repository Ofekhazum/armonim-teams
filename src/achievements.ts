// Per-player badges for the History standings.
//
// Same rule as everywhere else in this app: every one of these is a **count**,
// never a verdict (§2.9). "Most wins in the club" is a fact about a column;
// "best player" is a claim the three numbers a night can't support, and isn't
// on this list. The MVP badge is the one exception the app already makes —
// it's a count of a human's subjective pick, and it says so.
//
// Nothing here needs new data: it's all re-read from `history`, the same
// fixtures the standings table above it is built from.

import type { FixtureRecord } from './types';
import { hasResult, playerStandings } from './calibration';
import { MIN_ATTEND_STREAK, MIN_WIN_STREAK, appearances } from './milestones';
import { mvpCounts } from './mvp';
import { MIN_PROFILE_NIGHTS, loggedNightsFor, shootoutWins } from './playerProfile';

export type AchievementKind =
  | 'most-wins'
  | 'most-fixtures'
  | 'mvp'
  | 'shootouts'
  | 'iron-man'
  | 'win-streak'
  | 'active-run'
  | 'ever-present'
  | 'veteran';

export interface Achievement {
  kind: AchievementKind;
  icon: string;
  // shown on hover — written as the sentence it is, so the badge never has to
  // be decoded from its emoji alone
  label: string;
}

// Enough nights that "played all of them" means something. Below this it's
// just "showed up twice", which every regular would also have.
export const MIN_NIGHTS_FOR_EVER_PRESENT = 4;

// A long-service badge. Weekly football makes this most of a year.
export const VETERAN_NIGHTS = 25;

// A one-line title for a player, taken from the badge they hold that fewest
// people can hold. Not a new fact — every one of these is the badge underneath
// it, said as a name instead of a sentence, and the count that earned it is
// always on screen beside it.
//
// Ordered by how much the club wants a player to be *wearing* it, which is a
// judgement rather than something derivable. Rarity was the first ordering and
// it read wrong: it put "most shootouts won by your team" — a single-holder
// badge, but one earned on a technicality of how matches ended — above a live
// winning run, which is the thing anyone at the pitch would actually mention.
// So this list is the organiser's call, set here in one place, and the roster
// skins follow it rather than keeping a ranking of their own.
const TITLE_ORDER: { kind: AchievementKind; title: string; minNights?: number }[] = [
  { kind: 'most-wins', title: 'Top of the Club' },
  { kind: 'mvp', title: 'The Star' },
  // Third, and the only one that carries its own evidence: a run of
  // MIN_WIN_STREAK winning nights cannot exist in a history shorter than
  // MIN_WIN_STREAK, so unlike "played every night" it can never be an artefact
  // of a thin record. It is therefore also let through early, on its own terms
  // — which makes it the first title the club will ever see.
  { kind: 'active-run', title: 'On a Run', minNights: MIN_WIN_STREAK },
  { kind: 'most-fixtures', title: 'Night Taker' },
  { kind: 'ever-present', title: 'Ever Present' },
  { kind: 'iron-man', title: 'Iron Man' },
  { kind: 'veteran', title: 'Veteran' },
  { kind: 'shootouts', title: 'Nerves of Steel' },
].map((t) => ({ ...t, kind: t.kind as AchievementKind }));

// No titles until the club has this many recorded nights behind it. A title is
// the most declarative thing in the app — a noun attached to a person — and on
// a young history the badge underneath it is nearly free: "played every night"
// off three nights is a fact about the history's length, not about the player.
// The badges themselves stay on from the start, because a badge shows its
// count and a title doesn't.
//
// A title may set its own lower bar (see TITLE_ORDER) when the thing it names
// is impossible to earn by accident on a short history.
export const MIN_NIGHTS_FOR_TITLES = 5;

/**
 * The badge this player holds that fewest people can hold, said as a name.
 *
 * `recordedNights` is the club's whole history, not this player's — one player
 * turning up a lot is not what makes a title mean something; the league having
 * happened is.
 */
export interface PlayerTitle {
  kind: AchievementKind;
  title: string;
  // taken off the badge itself rather than a second lookup table, so the emoji
  // on a themed roster row is always the one in the badge it came from
  icon: string;
}

/** The title itself, with the badge it came from — which is what a theme keys off. */
export function titleBadgeFor(
  achievements: Achievement[],
  recordedNights: number,
): PlayerTitle | null {
  const held = new Set(achievements.map((a) => a.kind));
  // The first title they hold that the history is deep enough to justify — so
  // a suppressed title falls through to the next one rather than silencing the
  // player entirely.
  const found = TITLE_ORDER.find(
    (t) => held.has(t.kind) && recordedNights >= (t.minNights ?? MIN_NIGHTS_FOR_TITLES),
  );
  if (!found) return null;
  const badge = achievements.find((a) => a.kind === found.kind)!;
  return { kind: found.kind, title: found.title, icon: badge.icon };
}

export function titleFor(achievements: Achievement[], recordedNights: number): string | null {
  return titleBadgeFor(achievements, recordedNights)?.title ?? null;
}

export interface PlayerAchievements {
  id: string;
  fixturesWon: number; // nights this player's team was the outright top
  mvps: number;
  // matches this player's teams took on penalties, over the nights that were
  // logged match by match — absent from a tallied night, so this is not
  // comparable with `wins` and is never shown beside it without saying so
  shootouts: number;
  achievements: Achievement[];
}

function longestWinRun(apps: { won: boolean }[]): number {
  let best = 0;
  let cur = 0;
  for (const a of apps) {
    cur = a.won ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  return best;
}

// The run they are on *right now*, which is a different fact from the longest
// one they have ever had — and the only one of the two worth wearing. A player
// who won three on the trot last winter is not "on a run"; the title says
// something is happening, so it has to still be happening.
function activeWinRun(apps: { won: boolean }[]): number {
  let n = 0;
  for (let i = apps.length - 1; i >= 0 && apps[i].won; i--) n++;
  return n;
}

// How many recorded nights, counting back from the most recent one, this
// player has appeared at without a gap. Same shape as the iron-man milestone
// on the fixture page, read over the whole season rather than tonight.
function attendanceStreak(id: string, recorded: FixtureRecord[]): number {
  let streak = 0;
  for (let i = recorded.length - 1; i >= 0; i--) {
    const played = Object.values(recorded[i].teams).some((ids: string[]) => ids.includes(id));
    if (!played) break;
    streak++;
  }
  return streak;
}

export function playerAchievements(history: FixtureRecord[]): Map<string, PlayerAchievements> {
  const recorded = [...history]
    .filter((fx) => hasResult(fx.wins))
    .sort((a, b) => a.date.localeCompare(b.date));

  const standings = playerStandings(history);
  const mvps = new Map(mvpCounts(history).map((m) => [m.id, m.count]));
  const shootouts = shootoutWins(history);

  const fixturesWon = new Map<string, number>();
  const winRun = new Map<string, number>();
  const liveRun = new Map<string, number>();
  for (const s of standings) {
    const apps = appearances(s.id, recorded);
    fixturesWon.set(s.id, apps.filter((a) => a.won).length);
    winRun.set(s.id, longestWinRun(apps));
    liveRun.set(s.id, activeWinRun(apps));
  }

  // Ties share the badge rather than being broken arbitrarily — two players
  // level on wins are exactly as level as the number says.
  const topOf = (get: (id: string) => number): Set<string> => {
    const best = Math.max(0, ...standings.map((s) => get(s.id)));
    return best > 0 ? new Set(standings.filter((s) => get(s.id) === best).map((s) => s.id)) : new Set();
  };
  const mostWins = topOf((id) => standings.find((s) => s.id === id)?.wins ?? 0);
  const mostFixtures = topOf((id) => fixturesWon.get(id) ?? 0);
  // Same treatment as the other two: a badge for the top of the column, not
  // for appearing in it. Every regular collects an MVP night eventually, and a
  // badge nearly everyone wears stops being one — 🌟 means "most picked", the
  // way 🥇 means "most wins".
  const mostMvps = topOf((id) => mvps.get(id) ?? 0);
  // Gated on *logged* nights rather than nights played: a shootout count drawn
  // from one logged night says nothing, and everybody's count is zero until
  // the first night is logged at all — which topOf already declines to award.
  const mostShootouts = topOf((id) =>
    loggedNightsFor(history, id) >= MIN_PROFILE_NIGHTS ? (shootouts.get(id) ?? 0) : 0,
  );

  const out = new Map<string, PlayerAchievements>();
  for (const s of standings) {
    const list: Achievement[] = [];
    const won = fixturesWon.get(s.id) ?? 0;
    const mvpCount = mvps.get(s.id) ?? 0;
    const streak = winRun.get(s.id) ?? 0;
    const onNow = liveRun.get(s.id) ?? 0;
    const attend = attendanceStreak(s.id, recorded);

    if (mostWins.has(s.id)) {
      list.push({ kind: 'most-wins', icon: '🥇', label: `Most wins in the club — ${s.wins}` });
    }
    if (mostFixtures.has(s.id)) {
      list.push({ kind: 'most-fixtures', icon: '🏅', label: `Most nights won outright — ${won}` });
    }
    if (mostMvps.has(s.id)) {
      list.push({
        kind: 'mvp',
        icon: '🌟',
        label: `Most MVP picks — ${mvpCount} time${mvpCount === 1 ? '' : 's'}`,
      });
    }
    if (mostShootouts.has(s.id)) {
      const n = shootouts.get(s.id) ?? 0;
      list.push({
        kind: 'shootouts',
        icon: '🎯',
        // "their team won", not "they won" — a shootout is taken by a side.
        // The badge is still worth having: somebody keeps being in the team
        // that holds its nerve, and that is a count, not a verdict.
        label: `Most shootouts won by their team — ${n}`,
      });
    }
    if (attend >= MIN_ATTEND_STREAK) {
      list.push({ kind: 'iron-man', icon: '🦾', label: `Hasn't missed a night in ${attend}` });
    }
    if (streak >= MIN_WIN_STREAK) {
      list.push({ kind: 'win-streak', icon: '📈', label: `Longest winning run — ${streak} nights` });
    }
    // A separate badge from the one above, deliberately: "the longest run they
    // ever had" and "the run they are on" answer different questions, and only
    // the second one is news.
    if (onNow >= MIN_WIN_STREAK) {
      list.push({ kind: 'active-run', icon: '🔥', label: `On a ${onNow}-night winning run` });
    }
    if (recorded.length >= MIN_NIGHTS_FOR_EVER_PRESENT && s.nights === recorded.length) {
      list.push({ kind: 'ever-present', icon: '✨', label: `Played every night — all ${s.nights}` });
    }
    if (s.nights >= VETERAN_NIGHTS) {
      list.push({ kind: 'veteran', icon: '🎖️', label: `${s.nights} nights played` });
    }

    out.set(s.id, {
      id: s.id,
      fixturesWon: won,
      mvps: mvpCount,
      shootouts: shootouts.get(s.id) ?? 0,
      achievements: list,
    });
  }
  return out;
}
