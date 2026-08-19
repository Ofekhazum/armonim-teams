import type { FixtureRecord, Player, TeamColor } from './types';
import { TEAM_COLORS } from './balancer';
import { hasResult } from './calibration';

// A fact about tonight that's true by counting, not by interpretation.
//
// Nothing here says a player is *good*, *in form*, or *playing well* — the
// three-numbers-a-night record can't support a claim like that (§2.6 spends
// several paragraphs on why). "Won the last three nights" is a different kind
// of statement: checkable, and wrong only if the arithmetic is wrong.
export type Milestone =
  | { kind: 'nth-night'; id: string; name: string; nights: number }
  | { kind: 'nth-win'; id: string; name: string; wins: number }
  | { kind: 'iron-man'; id: string; name: string; nights: number }
  | { kind: 'win-streak'; id: string; name: string; nights: number }
  | { kind: 'winless'; id: string; name: string; nights: number }
  | { kind: 'debut'; id: string; name: string }
  // too many debuts to name individually — see MAX_NAMED_DEBUTS
  | { kind: 'debut-group'; count: number };

// A debut is only worth announcing if the history is deep enough that *not*
// appearing in it means something. With two nights on record, everyone who
// missed those two nights is "making their debut", which is just noise —
// and on a fresh install it would tag the entire squad at once.
export const MIN_HISTORY_FOR_DEBUTS = 5;

// Past this many first-timers it stops reading as a milestone and starts
// reading as a list, so they collapse into a single line.
export const MAX_NAMED_DEBUTS = 3;

// Runs shorter than these are ordinary. Being on the top team is roughly a
// 1-in-3 shot, so a 3-night run lands on about one player on any given night
// across a squad this size — often enough to stay alive, rare enough to mean
// something. Anything shorter would fire constantly and stop being read.
export const MIN_WIN_STREAK = 3;
export const MIN_WINLESS_RUN = 5;

// Consecutive nights *on the sheet* — attendance, not results. Turning up is a
// much more common event than winning (it doesn't depend on how the balancer
// happened to split five-a-side matches), so this needs a longer run before
// it's worth a line. Unlike MIN_WIN_STREAK/MIN_WINLESS_RUN this hasn't been
// checked against real attendance history yet — those two were originally
// guessed as well, then recalibrated once real nights showed the true rate
// (see the win-milestone ladder below); this constant is due the same
// treatment once there's enough attendance history to look at.
export const MIN_ATTEND_STREAK = 8;

// However many fire, this many get shown. In practice it's usually nought or
// one; the cap only exists so a freak night can't turn the line into a wall.
export const MAX_SHOWN = 5;

export function isMilestoneNight(n: number): boolean {
  return n === 10 || n === 25 || (n >= 50 && n % 50 === 0);
}

// Calibrated against real recorded nights, not a guess: a night's three teams
// share something like 14 wins between them, so a player banks roughly 4–5 a
// night — far faster than the 1–2 this ladder first assumed, which had 🏆
// firing three times sooner than intended. Worse, everyone accrues at about
// the same rate, so a low threshold gets crossed by half the squad within a
// week or two of each other and crowds everything else off the line.
//
// At ~4.7 a night these land near nights 11 / 22 / 54 / 107 — comparable
// rarity to the nights ladder above, and offset from it so a player doesn't
// usually trip both on the same evening.
export function isWinMilestone(n: number): boolean {
  return n === 50 || n === 100 || n === 250 || (n >= 500 && n % 500 === 0);
}

// Who took the night. Not something the app records — the organiser enters
// three win counts (§2.6) — so it's derived: the team with strictly the most
// wins took it, and a tie at the top means nobody did.
export function winnerOf(fx: FixtureRecord): TeamColor | null {
  if (!hasResult(fx.wins)) return null;
  let best: TeamColor | null = null;
  let bestWins = -1;
  let tied = false;
  for (const c of TEAM_COLORS) {
    const w = fx.wins[c] ?? 0;
    if (w > bestWins) {
      bestWins = w;
      best = c;
      tied = false;
    } else if (w === bestWins) {
      tied = true;
    }
  }
  return tied ? null : best;
}

export const teamOf = (fx: FixtureRecord, id: string): TeamColor | undefined =>
  TEAM_COLORS.find((c) => fx.teams[c].includes(id));

interface Appearance {
  won: boolean;
  wins: number; // what their team took that night
}

// Every night this player was on the sheet, oldest first. Nights with no
// result recorded are skipped rather than counted as a loss — they say
// nothing either way, and letting them break a run would be a lie. Exported
// for src/wrapped.ts, which needs the same per-player win/loss record to find
// a month's longest streak rather than just tonight's.
export function appearances(id: string, fixtures: FixtureRecord[]): Appearance[] {
  const out: Appearance[] = [];
  for (const fx of fixtures) {
    const color = teamOf(fx, id);
    if (!color) continue;
    if (!hasResult(fx.wins)) continue;
    out.push({ won: winnerOf(fx) === color, wins: fx.wins[color] ?? 0 });
  }
  return out;
}

// Consecutive nights *in a row on the sheet* — every recorded night counts,
// whether or not a result was ever typed in, since attendance doesn't depend
// on whether anyone remembered to tally the score. Walks backward from the
// most recent night and stops at the first one this id is absent from.
function attendanceStreak(id: string, chronological: FixtureRecord[]): number {
  let n = 0;
  for (let i = chronological.length - 1; i >= 0; i--) {
    if (!teamOf(chronological[i], id)) break;
    n++;
  }
  return n;
}

// Length of the run at the end of the list, counting *nights played* — a week
// someone missed doesn't break it. Someone who plays fortnightly can still
// build a run, the same way MIN_NIGHTS is counted per player rather than per
// season (§2.6).
const runLength = (apps: Appearance[], won: boolean): number => {
  let n = 0;
  for (let i = apps.length - 1; i >= 0 && apps[i].won === won; i--) n++;
  return n;
};

// Rarer/bigger facts first, so the cap drops the ordinary ones.
const RANK: Record<Milestone['kind'], number> = {
  'nth-night': 0,
  'nth-win': 1,
  'iron-man': 2,
  'win-streak': 3,
  winless: 4,
  debut: 5,
  'debut-group': 6,
};

const sizeOf = (m: Milestone): number =>
  m.kind === 'nth-night' ||
  m.kind === 'win-streak' ||
  m.kind === 'winless' ||
  m.kind === 'iron-man'
    ? m.nights
    : m.kind === 'nth-win'
      ? m.wins
      : 0;

/**
 * Facts about tonight, from the nights already on record.
 *
 * `tonightId` is the fixture id tonight was saved under, if it has been saved
 * (`session.savedFixtureId`). It matters twice: tonight must not be counted
 * towards "tonight is your Nth night" — it's the +1 — and it *must* be counted
 * towards career wins, which is the only way "that was your 100th win" can
 * ever be true. Before the result is entered, the two are the same thing.
 */
export function tonightsMilestones(
  todays: Player[],
  history: FixtureRecord[],
  tonightId?: string | null,
): Milestone[] {
  const chronological = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const past = tonightId ? chronological.filter((f) => f.id !== tonightId) : chronological;
  const tonight = tonightId ? history.find((f) => f.id === tonightId) : undefined;

  const found: Milestone[] = [];
  const debuts: { id: string; name: string }[] = [];

  for (const p of todays) {
    // Guests get a fresh uid every visit, so their history never matches and
    // they'd be "making their debut" every single week.
    if (p.isGuest) continue;

    // nights on the sheet, result recorded or not — turning up is turning up,
    // and this is also what makes someone a debutant or not
    const playedBefore = past.filter((fx) => teamOf(fx, p.id)).length;
    if (playedBefore === 0) {
      debuts.push({ id: p.id, name: p.name });
      continue;
    }

    const before = appearances(p.id, past);
    const nightsPlayed = playedBefore + 1;
    if (isMilestoneNight(nightsPlayed)) {
      found.push({ kind: 'nth-night', id: p.id, name: p.name, nights: nightsPlayed });
    }

    // Tonight counts toward the streak too — showing up is what's being
    // measured, and not playing tonight was never on the table for anyone in
    // `todays`.
    const attendStreak = attendanceStreak(p.id, past) + 1;
    if (attendStreak >= MIN_ATTEND_STREAK) {
      found.push({ kind: 'iron-man', id: p.id, name: p.name, nights: attendStreak });
    }

    // Career wins, and whether tonight is what carried them past a round
    // number. Only ever true once tonight's result is in.
    const winsBefore = before.reduce((n, a) => n + a.wins, 0);
    const tonightColor = tonight && teamOf(tonight, p.id);
    const winsNow =
      tonight && tonightColor && hasResult(tonight.wins)
        ? winsBefore + (tonight.wins[tonightColor] ?? 0)
        : winsBefore;
    for (let t = Math.ceil(winsBefore); t <= winsNow; t++) {
      if (t > winsBefore && isWinMilestone(t)) {
        found.push({ kind: 'nth-win', id: p.id, name: p.name, wins: t });
        break;
      }
    }

    // Runs count tonight too once it's known, so the line stays true rather
    // than describing the moment before the result went in.
    const upToNow =
      tonight && tonightColor && hasResult(tonight.wins)
        ? [...before, { won: winnerOf(tonight) === tonightColor, wins: 0 }]
        : before;
    const streak = runLength(upToNow, true);
    const winless = runLength(upToNow, false);
    if (streak >= MIN_WIN_STREAK) {
      found.push({ kind: 'win-streak', id: p.id, name: p.name, nights: streak });
    } else if (winless >= MIN_WINLESS_RUN) {
      found.push({ kind: 'winless', id: p.id, name: p.name, nights: winless });
    }
  }

  found.sort((a, b) => RANK[a.kind] - RANK[b.kind] || sizeOf(b) - sizeOf(a));

  const debutLines: Milestone[] =
    past.length < MIN_HISTORY_FOR_DEBUTS
      ? []
      : debuts.length > MAX_NAMED_DEBUTS
        ? [{ kind: 'debut-group', count: debuts.length }]
        : debuts
            .sort((a, b) => a.name.localeCompare(b.name, 'he'))
            .map((d): Milestone => ({ kind: 'debut', id: d.id, name: d.name }));

  return [...found, ...debutLines].slice(0, MAX_SHOWN);
}
