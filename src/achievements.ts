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
  for (const s of standings) {
    const apps = appearances(s.id, recorded);
    fixturesWon.set(s.id, apps.filter((a) => a.won).length);
    winRun.set(s.id, longestWinRun(apps));
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
