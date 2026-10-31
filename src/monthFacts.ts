// What the month's show is told about a month (§2.74).
//
// The month's twin of `recapFacts`: one pure function, the month's archive in,
// a small object of finished numbers and bare English clauses out. Everything
// in it is already computed by `buildWrapped` — the leaderboards, the awards,
// the milestones — and this only picks and flattens. Same rule as for a night:
// **facts, never the log**, so the model does no arithmetic, and nothing here
// is a finished sentence, so every show does not sound like the same show.
//
// **The Worker calls this, not the app.** A night's facts come from the
// client; a month's request carries only the month, and the Worker reads the
// archive, the roster, the marks and the registered team out of KV itself. So
// nothing free-text reaches the prompt from outside — the organiser notes are
// the one piece of prose here, and they are read out of the stored archive.
//
// **No rating travels.** The roster goes into `buildWrapped` because it tells
// guests apart and breaks a Team of the Month tie, and nothing it carries comes
// out the other side. The two mark awards do go in, as the average the monthly
// image's marks card already prints (§2.74) — a public figure, never a rating
// or a tier. A test asserts both halves of that.

import type { FixtureRecord, Player, TeamColor } from './types';
import type { AllMarks } from './gradeHistory';
import type { Milestone } from './milestones';
import { buildWrapped } from './wrapped';
import { hasResult } from './calibration';
import { parseEvents } from './eventMarks';

/** The registered team, as `worker/awards.js` stores it: best first. */
export interface RegisteredTeam {
  ids: string[];
  names: string[];
}

export interface MonthFacts {
  month: string; // the month's Hebrew name, alone: never a day, never a year
  nights: number;
  matchWins: number;
  // Each night of the month in order, so an event can be told as "the second
  // מחזור" rather than by a date the model must never print.
  nightsInOrder: { night: number; winners: string[]; events: string[] }[];
  leaders: string[];
  awards: string[];
  milestones: string[];
  // Best first. The countdown reads it backwards.
  team: string[];
  // False while the month is still being played: the show is "the month so
  // far", and its team is the table as it stands rather than an announcement.
  final: boolean;
}

// Spelt out rather than asked of `Intl`, because the Worker has no language
// setting and this is only ever said in Hebrew.
const HEBREW_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

// Named, not coded, the way `recapFacts` names a team: the prompt maps these
// to השחורים / הלבנים / הכחולים.
const COLOUR: Record<TeamColor, string> = { black: 'Black', white: 'White', blue: 'Blue' };

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const nth = (n: number) => ORDINAL[n - 1] ?? `${n}th`;

// One decimal, the way the marks card prints it — an average of marks out of
// ten with more digits than that is precision nobody measured.
const mark = (avg: number) => avg.toFixed(1);
const pct = (rate: number) => `${Math.round(rate * 100)}%`;

function milestoneLine(m: Milestone): string {
  switch (m.kind) {
    case 'debut-group':
      return `${m.count} players played their first night`;
    case 'debut':
      return `${m.name} played their first night`;
    case 'nth-night':
      return `${m.name} played their ${m.nights}th night`;
    case 'nth-win':
      return `${m.name} reached ${m.wins} career match wins`;
    case 'iron-man':
      return `${m.name} has not missed a night in ${m.nights}`;
    case 'win-streak':
      return `${m.name}'s team won ${m.nights} nights in a row`;
    case 'winless':
      return `${m.name}'s team went ${m.nights} nights without winning one`;
  }
}

/**
 * The month as the show is told it, or null when it has no recorded night.
 *
 * **Which team the countdown is.** A finished month's is the registered one —
 * the announcement, on the gold card — so the show can never name a different
 * five from the card everyone saw. A month still being played (`final` false)
 * has no announcement yet, so it gets the team as it stands, worked out the
 * way the monthly images work it out: the show and the images sent with it
 * agree. That holds even when the current month has been registered by hand,
 * since a mid-month registration is a snapshot the images no longer show. A
 * finished month nobody registered falls back to the same live count.
 */
export function monthFacts(
  history: FixtureRecord[],
  period: string,
  players: Player[],
  marks: AllMarks,
  registered: RegisteredTeam | null,
  final = true,
): MonthFacts | null {
  const w = buildWrapped(history, period, players, marks);
  if (w.nightsRecorded === 0) return null;

  // The same nights `buildWrapped` counted: in the month, with a result.
  const nights = history
    .filter((fx) => hasResult(fx.wins) && fx.date.startsWith(`${period}-`))
    .sort((a, b) => a.date.localeCompare(b.date));
  const ordinalOf = new Map(nights.map((fx, i) => [fx.id, i + 1]));
  const nightsInOrder = nights.map((fx, i) => ({
    night: i + 1,
    winners: w.winningTeams
      .filter((t) => t.fixtureId === fx.id)
      .map((t) => `${COLOUR[t.color]}${t.shared ? ' (level at the top)' : ''}: ${t.squad.join(', ')}`),
    events: parseEvents(fx.note).map((e) => e.text),
  }));

  const leaders = [
    ...w.topMatchWinners.map((p) => `${p.name}: ${p.wins} match wins this month`),
    ...w.topFixtureWinners.map((p) => `${p.name}: on the team that won ${p.nights} of the month's nights`),
    ...w.topMvps.map((p) => `${p.name}: player of the night ${p.count === 1 ? 'once' : `${p.count} times`}`),
    ...(w.perfectAttendance
      ? [`played every one of the ${w.perfectAttendance.nights} nights: ${w.perfectAttendance.names.join(', ')}`]
      : []),
  ];

  const awards: string[] = [];
  if (w.longestStreak) awards.push(`${w.longestStreak.name}'s team won ${w.longestStreak.nights} nights in a row`);
  if (w.longestWinless) {
    awards.push(`${w.longestWinless.name}'s team went ${w.longestWinless.nights} nights in a row without winning one`);
  }
  if (w.bottomScorer) {
    awards.push(`fewest match wins: ${w.bottomScorer.name}, ${w.bottomScorer.wins} from ${w.bottomScorer.nights} nights`);
  }
  if (w.teachersPet) {
    awards.push(`highest average mark: ${w.teachersPet.name}, ${mark(w.teachersPet.avg)} over ${w.teachersPet.nights} nights`);
  }
  if (w.punchingBag) {
    awards.push(`lowest average mark: ${w.punchingBag.name}, ${mark(w.punchingBag.avg)} over ${w.punchingBag.nights} nights`);
  }
  if (w.bestDuo) {
    awards.push(`best pair: ${w.bestDuo.aName} and ${w.bestDuo.bName} won ${w.bestDuo.won} of their ${w.bestDuo.together} nights together`);
  }
  if (w.worstDuo) {
    awards.push(`least lucky pair: ${w.worstDuo.aName} and ${w.worstDuo.bName} won ${w.worstDuo.won} of their ${w.worstDuo.together} nights together`);
  }
  if (w.bully) {
    awards.push(`${w.bully.aName} beat ${w.bully.bName} ${w.bully.aWon} times to ${w.bully.bWon} in ${w.bully.faced} meetings this month`);
  }
  if (w.benchwarmer) awards.push(`benched most: ${w.benchwarmer.name} sat out ${w.benchwarmer.matchesBenched} matches`);
  if (w.outOfGas) {
    awards.push(`ran out of gas: ${w.outOfGas.name} won ${pct(w.outOfGas.earlyRate)} of their early matches and ${pct(w.outOfGas.lateRate)} of their late ones`);
  }
  if (w.cursedShirt) {
    awards.push(`unluckiest shirt: ${COLOUR[w.cursedShirt.color]} won ${w.cursedShirt.nightsWon} of ${w.cursedShirt.nightsPlayed} nights`);
  }
  if (w.longestRun) {
    const at = ordinalOf.get(w.longestRun.fixtureId);
    awards.push(
      `longest run: ${COLOUR[w.longestRun.color]} won ${w.longestRun.length} matches in a row${at ? ` on the ${nth(at)} night` : ''} (${w.longestRun.squad.join(', ')})`,
    );
  }
  for (const r of w.reservists) awards.push(`reservist: ${r.name} came for ${r.nights} night${r.nights === 1 ? '' : 's'} and banked ${r.wins} match wins`);

  // The names in order, with the parts that earned each place when the month's
  // own count still agrees on who it was. A registered player the count no
  // longer picks (a correction since) still gets their place in the countdown,
  // named, just without the numbers.
  const parts = new Map(w.teamOfMonth.map((p) => [p.id, p]));
  const named =
    final && registered && registered.ids.length > 0
      ? registered
      : { ids: w.teamOfMonth.map((p) => p.id), names: w.teamOfMonth.map((p) => p.name) };
  const team = named.ids.map((id, i) => {
    const name = named.names[i] ?? parts.get(id)?.name ?? '?';
    const p = parts.get(id);
    if (!p) return name;
    const every = p.nights === p.monthLength ? ', played every night' : '';
    return `${name}: ${p.nights} of ${p.monthLength} nights, ${p.wins} match wins, ${p.nightsWon} nights won, ${p.mvps} player-of-the-night picks${every}`;
  });

  const [, m] = period.split('-').map(Number);
  return {
    month: HEBREW_MONTHS[m - 1],
    nights: w.nightsRecorded,
    matchWins: w.totalWins,
    nightsInOrder,
    leaders,
    awards,
    milestones: w.monthlyAchievements.map(milestoneLine),
    team,
    final,
  };
}
