// A month-in-review recap, in the same spirit as tonight's milestones (§2.9)
// and duo records (§2.10) — every line here is a count over a month's nights,
// never a verdict, and it costs the organiser nothing: no new input, just a
// different lens on `AppState.history`. Rendered as a shareable image by
// src/wrappedImage.ts.

import type { FixtureRecord, Player, TeamColor, TonightPlayer } from './types';
import { hasResult, totalWins as fixtureWins } from './calibration';
import { TEAM_COLORS } from './balancer';
import {
  appearances,
  MIN_WIN_STREAK,
  MIN_WINLESS_RUN,
  tonightsMilestones,
  winnerOf,
  type Milestone,
} from './milestones';
import { computeDuoRecords, type DuoFact } from './duos';
import { mvpCounts } from './mvp';
import { TOTM_SIZE, teamOfMonth, totmEligible, totmScore, type TotmPlayer } from './totm';
import { loserOf, playedCounts } from './matchLog';
import { lean, playerArcs, rate as arcRate } from './playerArcs';
import { nightStory, HALVES_MIN, type Flavour, type NightFact } from './nightStory';
import type { AllMarks } from './gradeHistory';

// The Team of the Month scoring lives in totm.ts, because the Worker's cron
// scores the same month with the same rule and a second copy would drift
// (§2.25). Re-exported here so everything that already imported it from
// `wrapped` still can.
export { TOTM_SIZE, teamOfMonth, totmEligible, totmScore };
export type { TotmPlayer };

// A little banter alongside the honest counts — same "it's a count, not a
// verdict" rule applies (the copy says "fewest wins", not "worst player"),
// but a recap with only good news reads as a highlight reel, not a record.
// One asymmetry from the positive side: `bottomScorer` requires at least
// this many nights before it's reported, so a newcomer's only night ever
// isn't what gets them roasted — the same mercy the app already extends
// elsewhere to small samples (debuts, MIN_NIGHTS on rating suggestions).
const MIN_NIGHTS_FOR_ROAST = 2;

// --- Banter stats (2026-08-28) ----------------------------------------------
//
// A second wave of the same idea: every one of these is still a count over
// the month's own nights, never a claim the data can't support. What's new is
// where the counts come from — grades, the match log, the arcs engine, the
// derby-style head-to-head walk, and a replay of `tonightsMilestones` across
// the whole month rather than one night. None of it touches a rating: the one
// stat that would have needed to (a tier-based "overachiever/fraud" pairing)
// was dropped rather than built, because grades.ts's own header spends a
// paragraph on what it costs to let a rating shade a published number even
// invisibly, and a badge naming a tier outright in a shared image is a
// different and much larger cost than that.

// A mark "averaged" over one or two nights isn't an average anybody should
// read anything into — this is the floor below which the month's highest and
// lowest average both decline to speak.
const MIN_GRADED_NIGHTS_FOR_RECAP = 3;

// How rare a month has to be before "snagged glory on barely any nights" is
// still the honest description rather than "played a normal amount".
const MAX_RESERVIST_NIGHTS = 2;

// The floor on matches faced before The Bully is announced — deliberately
// lower than derby.ts's career-scoped MIN_MATCHES (10). A derby is picked for
// being *level* over a whole season's worth of meetings; this is picked for
// being *lopsided* over one month, where there is simply less football to
// have accumulated a record in.
const MIN_BULLY_MATCHES = 5;

export interface GradeExtreme {
  id: string;
  name: string;
  avg: number;
  nights: number; // graded nights the average is over
}

export interface Benchwarmer {
  id: string;
  name: string;
  matchesBenched: number; // total matches sat out while their team was on the sheet
}

export interface OutOfGas {
  id: string;
  name: string;
  earlyRate: number; // win rate in their own first half of matches, this month
  lateRate: number; // win rate in their own second half
}

export interface Reservist {
  id: string;
  name: string;
  nights: number; // at most MAX_RESERVIST_NIGHTS
  wins: number; // matches banked across those nights
}

export interface Bully {
  aId: string;
  aName: string;
  aWon: number;
  bId: string;
  bName: string;
  bWon: number;
  faced: number;
}

export interface CursedShirt {
  color: TeamColor;
  nightsWon: number; // nights this colour finished outright top
  nightsPlayed: number; // the month's own night count — every colour plays every night
  matchWinShare: number; // this colour's share of every match win banked this month
}

// One shirt's night, as the recap's scoreboard needs it. `nightStory` already
// works all of this out from the match log (`TeamNight`); what it doesn't
// carry is who actually wore the shirt, which the recap needs because it
// redraws the three squads the way the fixture page shows them.
export interface NightOfMonthTeam {
  played: number;
  won: number;
  points: number; // half a win for a shootout, as the tally counts it
  squad: string[]; // the names on that shirt, in the order the fixture kept them
}

export interface NightOfMonth {
  fixtureId: string;
  date: string;
  leadChanges: number;
  alternation: number;
  matches: number;
  flavour: Flavour;
  headline: string;
  facts: NightFact[];
  // The scoreboard half of the night's own page. `winner` is the strict top
  // of the night — the same `winnerOf` reading used everywhere else, so a tie
  // at the top is nobody rather than a coin toss.
  teams: Record<TeamColor, NightOfMonthTeam>;
  winner: TeamColor | null;
  penalties: number;
  mvpName: string | null;
}

export interface LongestRun {
  fixtureId: string;
  date: string;
  color: TeamColor;
  length: number; // consecutive matches that colour won, within that one night
  // Who was actually wearing the shirt. The colour on its own says nothing —
  // the teams are redrawn every week, so "black won 4 on the spin" describes
  // a set of people that existed for one evening and never again.
  squad: string[];
}

// A shirt that topped one of the month's nights, with the squad that wore it.
// Usually one entry per night, but a night that finished level at the top
// produces one entry *per* tied shirt rather than none — unlike `winnerOf`
// (used everywhere else a night needs a single champion or nobody), this page
// is enumerating nights rather than aggregating them, so silently dropping a
// tied one would be a visibly missing card for a result that genuinely
// happened. `shared` is what lets the card say so rather than claiming an
// outright win it didn't have.
export interface WinningTeam {
  fixtureId: string;
  date: string;
  color: TeamColor;
  wins: number; // match wins that shirt banked on the night
  squad: string[];
  shared: boolean; // true when another shirt tied it for the top that night
}

export interface WrappedStats {
  period: string; // 'YYYY-MM'
  label: string; // e.g. 'August 2026'
  nightsRecorded: number;
  totalWins: number;
  // Everyone who played *every* recorded night this month — not just
  // whoever happened to have the highest count. The old version of this
  // stat picked the single top attendee and unconditionally labelled them
  // "never missed", which was wrong whenever even the best attendance that
  // month fell short of a clean sweep.
  perfectAttendance: { names: string[]; nights: number } | null;
  // Two different questions, deliberately kept apart rather than collapsed
  // into one "top scorer" — there's no goal tally in this app (§2.6), so
  // "scorer" was never the right word. A *match* win is the three-numbers-a-
  // night tally credited to everyone on the team (§2.6); a *fixture* win is
  // whether that team was the strict top of the whole night (winnerOf, same
  // definition milestones/duos already use). A player can rack up match wins
  // on a team that still didn't top many actual nights, or vice versa.
  topMatchWinners: { name: string; wins: number }[]; // top 3, most individual match wins
  topFixtureWinners: { name: string; nights: number }[]; // top 3, most nights their team outright won
  // The one stat here that isn't derived from a result — the organiser's own
  // pick, just counted (see src/mvp.ts). Unlike the two leaderboards above,
  // *not* capped at 3: an MVP pick is one player a night, so it's common
  // for it to spread across many more people than "most matches won" ever
  // does, and cutting that off would hide most of who actually got picked.
  topMvps: { name: string; count: number }[]; // everyone with at least one MVP night, ranked
  bottomScorer: { name: string; wins: number; nights: number } | null;
  longestStreak: { name: string; nights: number } | null;
  longestWinless: { name: string; nights: number } | null;
  bestDuo: DuoFact | null;
  worstDuo: DuoFact | null;
  // Every shirt that took a night outright this month, best night first. Not
  // capped here — how many will fit on a page is the poster's business, and
  // `wrappedImage.ts` takes the top few.
  winningTeams: WinningTeam[];
  // The five who carried the month, drawn onto the gold shirt card (§2.21).
  // Ordered best first — the top of the pentagon is the top of the list.
  teamOfMonth: TotmPlayer[];

  // --- Banter stats ----------------------------------------------------
  teachersPet: GradeExtreme | null;
  punchingBag: GradeExtreme | null;
  benchwarmer: Benchwarmer | null;
  outOfGas: OutOfGas | null;
  // Everyone who qualified, not just the best story — on a month with several
  // one-off appearances, naming one of them and silently dropping the rest
  // reads as the app not having noticed the others.
  reservists: Reservist[];
  bully: Bully | null;
  cursedShirt: CursedShirt | null;
  nightOfMonth: NightOfMonth | null;
  longestRun: LongestRun | null;
  // Every milestone crossed on one of the month's own nights, replaying
  // `tonightsMilestones` fixture by fixture rather than capping at MAX_SHOWN —
  // a month digest lists everything, where a single night's panel has to
  // throttle itself.
  monthlyAchievements: Milestone[];
}


const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// Which months have at least one recorded night, newest first — populates the
// month picker without assuming the current calendar month has any data yet.
export function wrappedPeriods(history: FixtureRecord[]): string[] {
  const periods = new Set<string>();
  for (const fx of history) {
    if (!hasResult(fx.wins)) continue;
    periods.add(fx.date.slice(0, 7));
  }
  return [...periods].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/** The names on one shirt, in the order the fixture kept them. */
const squadNames = (fx: FixtureRecord, color: TeamColor): string[] =>
  fx.teams[color].map((id) => fx.players.find((p) => p.id === id)?.name ?? '?');

function longestRun(apps: { won: boolean }[], won: boolean): number {
  let best = 0;
  let cur = 0;
  for (const a of apps) {
    if (a.won === won) {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

// iron-man/win-streak/winless fire every night a run is still active, not
// just once — a player mid-streak turns up in `tonightsMilestones`' output on
// each of the run's own nights, each time with a bigger number than last.
// Replayed across a whole month, that means "7 nights running" and "8 nights
// running" for the same player are not two achievements, they're one seen
// twice. `nth-night`/`nth-win`/`debut`/`debut-group` don't have this problem
// — each only fires at its own specific threshold — so only these three kinds
// get filtered, keeping just the best (and, if two nights somehow tie, the
// first) per player per kind.
type RunningStreak = Extract<Milestone, { kind: 'iron-man' | 'win-streak' | 'winless' }>;

const isRunningStreak = (m: Milestone): m is RunningStreak =>
  m.kind === 'iron-man' || m.kind === 'win-streak' || m.kind === 'winless';

function dedupeRunningStreaks(milestones: Milestone[]): Milestone[] {
  const bestOf = new Map<string, number>();
  for (const m of milestones) {
    if (!isRunningStreak(m)) continue;
    const key = `${m.kind}:${m.id}`;
    if (m.nights > (bestOf.get(key) ?? -Infinity)) bestOf.set(key, m.nights);
  }
  const kept = new Set<string>();
  return milestones.filter((m) => {
    if (!isRunningStreak(m)) return true;
    const key = `${m.kind}:${m.id}`;
    if (m.nights !== bestOf.get(key)) return false;
    if (kept.has(key)) return false;
    kept.add(key);
    return true;
  });
}

// `players` and `marks` are both optional and both default to nothing, so
// every existing caller — and every test in this file that predates the
// banter stats — keeps working unchanged. Only the stats that genuinely need
// them go quiet without them: the roster is what tells `monthlyAchievements`
// who's a guest (absent, it treats nobody as one, the same as every other
// stat in this file already does), and `marks` is what the three grade-based
// picks read from.
export function buildWrapped(
  history: FixtureRecord[],
  period: string,
  players: Player[] = [],
  marks: AllMarks = {},
): WrappedStats {
  const chronological = [...history]
    .filter((fx) => hasResult(fx.wins) && fx.date.startsWith(`${period}-`))
    .sort((a, b) => a.date.localeCompare(b.date));

  const nameOf = new Map<string, string>();
  for (const fx of chronological) for (const p of fx.players) nameOf.set(p.id, p.name);

  const nights = new Map<string, number>();
  const wins = new Map<string, number>();
  for (const fx of chronological) {
    for (const c of TEAM_COLORS) {
      for (const id of fx.teams[c]) {
        nights.set(id, (nights.get(id) ?? 0) + 1);
        wins.set(id, (wins.get(id) ?? 0) + (fx.wins[c] ?? 0));
      }
    }
  }

  // Not the same number as summing the `wins` map above — that map is each
  // *player's* personal credit (their team's tally, once per player on it),
  // so a single 3-0 night would count as 15 there. This is the actual match
  // total, once per night — what "wins banked by the squad" should mean.
  const totalWins = chronological.reduce((n, fx) => n + fixtureWins(fx.wins), 0);

  const perfectNames = [...nights.entries()]
    .filter(([, n]) => n === chronological.length)
    .map(([id]) => nameOf.get(id)!)
    .sort((a, b) => a.localeCompare(b, 'he'));
  const perfectAttendance =
    chronological.length > 0 && perfectNames.length > 0
      ? { names: perfectNames, nights: chronological.length }
      : null;

  const topMatchWinners = [...wins.entries()]
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, w]) => ({ name: nameOf.get(id)!, wins: w }));

  // Nights (not matches) this player's team was the strict top of the whole
  // night — `appearances()` already carries that flag per night (`won`),
  // computed the same way tonight's win-streak fact reads it.
  const fixturesWon = new Map<string, number>();
  for (const id of nameOf.keys()) {
    fixturesWon.set(id, appearances(id, chronological).filter((a) => a.won).length);
  }
  const topFixtureWinners = [...fixturesWon.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, n]) => ({ name: nameOf.get(id)!, nights: n }));

  const topMvps = mvpCounts(chronological).map((m) => ({ name: m.name, count: m.count }));

  const teamOfMonthPicks = teamOfMonth(history, period);

  const [bottomScorerId, bottomScorerWins] =
    [...wins.entries()]
      .filter(([id]) => (nights.get(id) ?? 0) >= MIN_NIGHTS_FOR_ROAST)
      .sort((a, b) => a[1] - b[1])[0] ?? [];

  let longestStreak: { name: string; nights: number } | null = null;
  let longestWinless: { name: string; nights: number } | null = null;
  for (const id of nameOf.keys()) {
    const apps = appearances(id, chronological);
    const won = longestRun(apps, true);
    if (won >= MIN_WIN_STREAK && (!longestStreak || won > longestStreak.nights)) {
      longestStreak = { name: nameOf.get(id)!, nights: won };
    }
    const lost = longestRun(apps, false);
    if (lost >= MIN_WINLESS_RUN && (!longestWinless || lost > longestWinless.nights)) {
      longestWinless = { name: nameOf.get(id)!, nights: lost };
    }
  }

  const { best: bestDuo, worst: worstDuo } = computeDuoRecords(
    chronological,
    new Set(nameOf.keys()),
    nameOf,
  );

  // --- Grades: Teacher's Pet, Punching Bag, the Rollercoaster --------------
  // Grades are already fully public per fixture (GET /grades/all) — averaging
  // a month of them says nothing a reader couldn't already work out by hand,
  // one night at a time. `marks[fx.id]` is only ever present for a fixture
  // whose grades were actually published, so a month the organiser never
  // graded simply contributes nothing here rather than a wrong number.
  //
  // A per-player average is only half the guard, though — it says nothing
  // about how much of the *month* it's speaking for. Grades launched
  // partway through, so an early month can have two graded nights out of
  // twelve; a "Teacher's Pet" built from a sixth of the month would read as
  // a verdict on the whole thing when it isn't one. So there's a macro gate
  // ahead of the per-player one: strictly more than half of the month's own
  // fixtures need published grades before any of these three even attempt a
  // pick, not just the fixtures that happen to mention a given player.
  const gradedFixtures = chronological.filter((fx) => {
    const lines = marks[fx.id];
    return lines != null && Object.keys(lines).length > 0;
  });
  const monthIsGraded =
    chronological.length > 0 && gradedFixtures.length > chronological.length / 2;

  let teachersPet: GradeExtreme | null = null;
  let punchingBag: GradeExtreme | null = null;
  if (monthIsGraded) {
    const gradesByPlayer = new Map<string, number[]>();
    for (const fx of chronological) {
      const lines = marks[fx.id];
      if (!lines) continue;
      for (const [id, grade] of Object.entries(lines)) {
        if (!Number.isFinite(grade)) continue;
        const list = gradesByPlayer.get(id);
        if (list) list.push(grade);
        else gradesByPlayer.set(id, [grade]);
      }
    }
    for (const [id, grades] of gradesByPlayer) {
      if (grades.length < MIN_GRADED_NIGHTS_FOR_RECAP) continue;
      const name = nameOf.get(id) ?? '?';
      const avg = grades.reduce((s, g) => s + g, 0) / grades.length;
      if (
        !teachersPet ||
        avg > teachersPet.avg ||
        (avg === teachersPet.avg && grades.length > teachersPet.nights)
      ) {
        teachersPet = { id, name, avg, nights: grades.length };
      }
      if (
        !punchingBag ||
        avg < punchingBag.avg ||
        (avg === punchingBag.avg && grades.length > punchingBag.nights)
      ) {
        punchingBag = { id, name, avg, nights: grades.length };
      }
    }
  }

  // --- The Benchwarmer -------------------------------------------------
  // Winner-stays-on means sitting out is exactly the gap between a team's own
  // matches and the night's total — `playedCounts` already answers "how many
  // did each team actually play", so this is that, inverted and credited to
  // everyone who wore the shirt.
  const benchedByPlayer = new Map<string, number>();
  for (const fx of chronological) {
    const log = fx.matchLog;
    if (!log?.length) continue;
    const played = playedCounts(log);
    for (const c of TEAM_COLORS) {
      const benched = log.length - played[c];
      if (benched <= 0) continue;
      for (const id of fx.teams[c]) {
        benchedByPlayer.set(id, (benchedByPlayer.get(id) ?? 0) + benched);
      }
    }
  }
  let benchwarmer: Benchwarmer | null = null;
  for (const [id, matchesBenched] of benchedByPlayer) {
    if (!benchwarmer || matchesBenched > benchwarmer.matchesBenched) {
      benchwarmer = { id, name: nameOf.get(id) ?? '?', matchesBenched };
    }
  }

  // --- Out of Gas --------------------------------------------------------
  // playerArcs already scopes itself to whatever fixtures it's handed, so
  // passing just this month's is the whole of the change — the MIN_HALF floor
  // (8 matches on each side) is left exactly as playerArcs.ts calibrated it,
  // which means most months this says nothing at all. That's the honest
  // answer on a young or quiet month, not a bug to work around.
  let outOfGas: OutOfGas | null = null;
  for (const id of nameOf.keys()) {
    const arcs = playerArcs(chronological, id);
    if (lean(arcs) !== 'early') continue; // 'early' = stronger first half, faded late
    const earlyRate = arcRate(arcs.early) ?? 0;
    const lateRate = arcRate(arcs.late) ?? 0;
    const gap = earlyRate - lateRate;
    if (!outOfGas || gap > outOfGas.earlyRate - outOfGas.lateRate) {
      outOfGas = { id, name: nameOf.get(id) ?? '?', earlyRate, lateRate };
    }
  }

  // --- The Reservist -----------------------------------------------------
  // Minimum effort, maximum glory: at most MAX_RESERVIST_NIGHTS nights, and
  // their team took at least one of them outright (`appearances` already
  // carries that flag per night). Ranked by fewest nights first — the rarer
  // the appearance, the better the story — then by wins banked, then by name.
  const reservists: Reservist[] = [];
  for (const [id, n] of nights) {
    if (n > MAX_RESERVIST_NIGHTS) continue;
    if (!appearances(id, chronological).some((a) => a.won)) continue;
    reservists.push({ id, name: nameOf.get(id) ?? '?', nights: n, wins: wins.get(id) ?? 0 });
  }
  reservists.sort(
    (a, b) => a.nights - b.nights || b.wins - a.wins || a.name.localeCompare(b.name, 'he'),
  );

  // --- The Bully -----------------------------------------------------------
  // The same head-to-head walk derby.ts uses for tonight's rivalry banner,
  // scoped to a month instead of a career and picking the *widest* gap
  // instead of the narrowest — a derby is announced for being level; this is
  // announced for being exactly the opposite.
  const h2hKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const h2h = new Map<string, { faced: number; first: number; second: number }>();
  for (const fx of chronological) {
    const log = fx.matchLog;
    if (!log?.length) continue;
    for (const m of log) {
      const loser = loserOf(m);
      for (const w of fx.teams[m.winner] ?? []) {
        for (const l of fx.teams[loser] ?? []) {
          const k = h2hKey(w, l);
          const r = h2h.get(k) ?? { faced: 0, first: 0, second: 0 };
          r.faced++;
          if (w < l) r.first++;
          else r.second++;
          h2h.set(k, r);
        }
      }
    }
  }
  let bully: Bully | null = null;
  let bullyGap = -1;
  for (const [k, r] of h2h) {
    if (r.faced < MIN_BULLY_MATCHES) continue;
    const gap = Math.abs(r.first - r.second);
    if (gap === 0) continue; // a bully needs an actual lopsided record, not a tie
    if (gap > bullyGap || (gap === bullyGap && bully && r.faced > bully.faced)) {
      const [aId, bId] = k.split('|');
      bully = {
        aId,
        aName: nameOf.get(aId) ?? '?',
        aWon: r.first,
        bId,
        bName: nameOf.get(bId) ?? '?',
        bWon: r.second,
        faced: r.faced,
      };
      bullyGap = gap;
    }
  }

  // --- The Cursed Shirt ----------------------------------------------------
  // Every colour plays every night by construction, so "nights played" needs
  // no counting of its own — it's just the month's own length.
  const nightsWonByColor: Record<TeamColor, number> = { black: 0, white: 0, blue: 0 };
  const matchWinsByColor: Record<TeamColor, number> = { black: 0, white: 0, blue: 0 };
  for (const fx of chronological) {
    const w = winnerOf(fx);
    if (w) nightsWonByColor[w]++;
    for (const c of TEAM_COLORS) matchWinsByColor[c] += fx.wins[c] ?? 0;
  }
  const totalMatchWins = TEAM_COLORS.reduce((s, c) => s + matchWinsByColor[c], 0);
  let cursedShirt: CursedShirt | null = null;
  if (chronological.length > 0) {
    for (const c of TEAM_COLORS) {
      const matchWinShare = totalMatchWins > 0 ? matchWinsByColor[c] / totalMatchWins : 0;
      if (
        !cursedShirt ||
        nightsWonByColor[c] < cursedShirt.nightsWon ||
        (nightsWonByColor[c] === cursedShirt.nightsWon && matchWinShare < cursedShirt.matchWinShare)
      ) {
        cursedShirt = {
          color: c,
          nightsWon: nightsWonByColor[c],
          nightsPlayed: chronological.length,
          matchWinShare,
        };
      }
    }
  }

  // --- The month's winning teams -------------------------------------------
  // Ranked by how many matches the shirt actually banked, so the page leads
  // with the most dominant evening rather than the most recent one. Every
  // shirt that topped the night's tally is credited — on the (~10% of
  // nights, going by a season of the invented club) that finish level, that's
  // more than one shirt from the same fixture. Ties in the sort fall back to
  // date, oldest first, so the order is stable rather than however the sort
  // happened to land.
  const winningTeams: WinningTeam[] = [];
  for (const fx of chronological) {
    const topWins = Math.max(...TEAM_COLORS.map((c) => fx.wins[c] ?? 0));
    const topColors = TEAM_COLORS.filter((c) => (fx.wins[c] ?? 0) === topWins);
    for (const color of topColors) {
      winningTeams.push({
        fixtureId: fx.id,
        date: fx.date,
        color,
        wins: topWins,
        squad: squadNames(fx, color),
        shared: topColors.length > 1,
      });
    }
  }
  winningTeams.sort((a, b) => b.wins - a.wins || a.date.localeCompare(b.date));

  // --- Night of the Month, and the longest run within one ------------------
  // Both fall out of the same pass over `nightStory`, which already reads a
  // night's own match log for its shape — nothing here is new arithmetic, only
  // a max held across the month. Night of the Month is gated at HALVES_MIN
  // matches so a three-match evening can't win by having nothing else to
  // compare against; the longest run isn't, since a big run is the fact
  // regardless of how short the rest of the night was.
  let nightOfMonth: NightOfMonth | null = null;
  let biggestRun: LongestRun | null = null;
  for (const fx of chronological) {
    const story = nightStory(fx);
    if (!story) continue;
    if (
      story.matches >= HALVES_MIN &&
      (!nightOfMonth ||
        story.leadChanges > nightOfMonth.leadChanges ||
        (story.leadChanges === nightOfMonth.leadChanges &&
          (story.alternation > nightOfMonth.alternation ||
            (story.alternation === nightOfMonth.alternation && story.matches > nightOfMonth.matches))))
    ) {
      const nameIn = (id: string) => fx.players.find((p) => p.id === id)?.name ?? '?';
      const teams = {} as Record<TeamColor, NightOfMonthTeam>;
      for (const c of TEAM_COLORS) {
        teams[c] = {
          played: story.teams[c].played,
          won: story.teams[c].won,
          points: story.teams[c].points,
          squad: squadNames(fx, c),
        };
      }
      nightOfMonth = {
        fixtureId: fx.id,
        date: fx.date,
        leadChanges: story.leadChanges,
        alternation: story.alternation,
        matches: story.matches,
        flavour: story.flavour,
        headline: story.headline,
        facts: story.facts,
        teams,
        winner: winnerOf(fx),
        penalties: story.penalties,
        mvpName: fx.mvpId ? nameIn(fx.mvpId) : null,
      };
    }
    if (story.longest && (!biggestRun || story.longest.length > biggestRun.length)) {
      const runColor = story.longest.team;
      biggestRun = {
        fixtureId: fx.id,
        date: fx.date,
        color: runColor,
        length: story.longest.length,
        squad: squadNames(fx, runColor),
      };
    }
  }

  // --- Monthly achievements --------------------------------------------
  // The exact function the fixture page calls on the night itself
  // (`tonightsMilestones`), replayed once per night this month against the
  // *whole* archive filtered to "as of that night" — not just this month's
  // fixtures, since a milestone like "10th night" depends on every night
  // before it, most of which are outside the period being recapped. Each
  // night's own MAX_SHOWN=5 cap still applies (it would have on the fixture
  // page too); only the month-level list goes uncapped. `dedupeRunningStreaks`
  // then collapses a streak that spanned several of the month's own nights
  // down to its best showing — see that function for why.
  const rosterIds = players.length > 0 ? new Set(players.map((p) => p.id)) : null;
  const rawAchievements: Milestone[] = [];
  for (const fx of chronological) {
    const todays: TonightPlayer[] = fx.players.map((p) => ({
      id: p.id,
      name: p.name,
      isGuest: rosterIds !== null && !rosterIds.has(p.id),
    }));
    const historySoFar = history.filter((f) => f.date <= fx.date);
    rawAchievements.push(...tonightsMilestones(todays, historySoFar, fx.id));
  }
  const monthlyAchievements = dedupeRunningStreaks(rawAchievements);

  return {
    period,
    label: periodLabel(period),
    nightsRecorded: chronological.length,
    totalWins,
    perfectAttendance,
    topMatchWinners,
    topFixtureWinners,
    topMvps,
    bottomScorer: bottomScorerId
      ? {
          name: nameOf.get(bottomScorerId)!,
          wins: bottomScorerWins,
          nights: nights.get(bottomScorerId)!,
        }
      : null,
    longestStreak,
    longestWinless,
    bestDuo,
    worstDuo,
    winningTeams,
    teamOfMonth: teamOfMonthPicks,
    teachersPet,
    punchingBag,
    benchwarmer,
    outOfGas,
    reservists,
    bully,
    cursedShirt,
    nightOfMonth,
    longestRun: biggestRun,
    monthlyAchievements,
  };
}
