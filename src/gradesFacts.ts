// What the sentence-writer is told about a night's marks (§2.39).
//
// The counterpart of `recapFacts` (§2.24), built the same way and for the same
// reason: one pure function, a filed night in, a small JSON object out, and
// nothing in it that the app has not already worked out. The Worker turns this
// into a prompt; the app never writes prompt text.
//
// **Two identifiers per player, and only one of them is shown to the model.**
// `key` is a throwaway `p1`, `p2` — an ASCII handle the model can copy without
// risk, because the answer comes back as a JSON object keyed on it and a model
// that alters one character of a Hebrew name orphans that line silently. `id`
// is the real player id and never enters the prompt; it is what the Worker maps
// the answer back onto before storing it, so nothing downstream ever depends on
// a code that only existed for the length of one request.
//
// **Counts only, no ratings** (§2.28). A grade is a far more pointed thing to
// publish than a market value, so the payload is held to the same line the
// recap is: names, shirts, results, and what each player brought in with them.

import type { FixtureRecord, Player, TeamColor, TonightPlayer } from './types';
import { TEAM_COLORS } from './balancer';
import { derbyOnRecord, settleDerby } from './derby';
import { nightGrades, type Trend } from './grades';
import { tonightsMilestones } from './milestones';

/** One player's row: the mark, and the material the joke has to be built from. */
export interface GradeFactLine {
  key: string; // 'p1' … — prompt-local, see the header
  id: string; // never reaches the prompt
  name: string;
  grade: number;
  team: TeamColor;
  teamWins: number;
  place: 1 | 2 | 3;
  wonNight: boolean;
  isMvp: boolean;
  nightsBefore: number;
  trend: Trend | null;
  runBefore: number;
  droughtBefore: number;
}

/**
 * Tonight's announced rivalry, and what tonight did to it.
 *
 * Both players are named by `key`, which is the point: this is the one fact in
 * the payload that belongs to two specific people and to nobody else, and
 * keying it means the model can be told so in a way it can check.
 */
export interface DerbyFact {
  aKey: string;
  aName: string;
  bKey: string;
  bName: string;
  /** The record they came in on — level enough to have been announced at all. */
  aBefore: number;
  bBefore: number;
  faced: number;
  /** Tonight: how often the two shirts met, and who took what. */
  met: number;
  aTook: number;
  bTook: number;
  penalties: number;
}

export interface GradesFacts {
  date: string;
  matches: number;
  winners: TeamColor[];
  mvp: string | null;
  said: string | null;
  milestones: string[];
  derby: DerbyFact | null;
  players: GradeFactLine[];
}

/**
 * The payload for one filed night, or `null` when the night has no result.
 *
 * `roster` is only used to tell a guest from a member, which decides who can
 * hold a milestone or a derby — the same use `recapFacts` puts it to.
 */
export function gradesFacts(
  fixture: FixtureRecord,
  history: FixtureRecord[],
  roster: Player[],
): GradesFacts | null {
  const graded = nightGrades(history, fixture.id);
  if (!graded) return null;

  // Ordered by mark, which is the order `nightGrades` already returns and the
  // order the night will be read in. p1 is the best night of the evening.
  const players: GradeFactLine[] = graded.map((g, i) => ({
    key: `p${i + 1}`,
    id: g.id,
    name: g.name,
    grade: g.grade,
    team: g.context.shirt,
    teamWins: g.context.teamWins,
    place: g.context.place,
    wonNight: g.context.wonNight,
    isMvp: g.context.isMvp,
    nightsBefore: g.context.nightsBefore,
    trend: g.context.trend,
    runBefore: g.context.runBefore,
    droughtBefore: g.context.droughtBefore,
  }));
  const keyOf = new Map(players.map((p) => [p.id, p.key]));

  const rosterIds = new Set(roster.map((p) => p.id));
  // As of that night and no later, the same rule the night page's milestone
  // strip is drawn under — a mark written weeks afterwards still describes the
  // evening as it was.
  const asOf = history.filter((fx) => fx.date <= fixture.date);
  const todays: TonightPlayer[] = fixture.players.map((p) => ({
    id: p.id,
    name: p.name,
    isGuest: !rosterIds.has(p.id),
  }));

  const milestones = tonightsMilestones(todays, asOf, fixture.id)
    // The group debut is the one milestone that names nobody, and under the
    // attribution rule the prompt now carries it could only ever be a trap: a
    // line about "3 players" with no way to know which three. The individual
    // debut below says the same thing and says who.
    .filter((m) => m.kind !== 'debut-group')
    .map((m) => {
      switch (m.kind) {
        case 'debut':
          return `${m.name} played their first night`;
        case 'nth-night':
          return `${m.name} played their ${m.nights}th night`;
        case 'nth-win':
          return `${m.name} reached ${m.wins} career match wins`;
        case 'iron-man':
          return `${m.name} has not missed a night in ${m.nights}`;
        case 'win-streak':
          return `${m.name}'s team has won ${m.nights} nights in a row`;
        case 'winless':
          return `${m.name}'s team has not won a night in ${m.nights}`;
        default:
          return '';
      }
    })
    .filter(Boolean);

  const nameOf = (id: string) => fixture.players.find((p) => p.id === id)?.name ?? '?';
  const matches = TEAM_COLORS.reduce((s, c) => s + (fixture.wins[c] ?? 0), 0);

  // Nobody takes a night that ends level at the top (§2.6), so a shared lead is
  // an empty list rather than two winners. This is not a stylistic choice: each
  // player's own line already carries `wonNight`, which `nightGrades` computes
  // with the tie rule applied, so listing co-leaders here would have the
  // payload contradicting itself — a header congratulating two teams above
  // fifteen lines none of which say anybody won anything.
  const top = Math.max(...TEAM_COLORS.map((c) => fixture.wins[c] ?? 0));
  const atTop = TEAM_COLORS.filter((c) => (fixture.wins[c] ?? 0) === top);

  return {
    date: fixture.date,
    matches,
    winners: top > 0 && atTop.length === 1 ? atTop : [],
    mvp: fixture.mvpId ? nameOf(fixture.mvpId) : null,
    said: fixture.note?.trim() || null,
    milestones,
    derby: derbyFact(fixture, asOf, rosterIds, keyOf),
    players,
  };
}

/**
 * The derby, settled.
 *
 * Recovered rather than remembered: `derbyOnRecord` recomputes the pick the
 * group read before kick-off, and `settleDerby` counts what the two shirts did
 * to each other once they were on the pitch. Null unless the night was logged
 * match by match — a tally cannot say who beat whom (§2.17) — and null if
 * either player somehow fell out of the graded list, which would leave a fact
 * pointing at a key the prompt never defines.
 */
function derbyFact(
  fixture: FixtureRecord,
  asOf: FixtureRecord[],
  rosterIds: ReadonlySet<string>,
  keyOf: Map<string, string>,
): DerbyFact | null {
  const picked = derbyOnRecord(fixture, asOf, rosterIds);
  if (!picked) return null;
  const settled = settleDerby(fixture, picked);
  if (!settled) return null;

  const aKey = keyOf.get(settled.aId);
  const bKey = keyOf.get(settled.bId);
  if (!aKey || !bKey) return null;

  return {
    aKey,
    aName: settled.aName,
    bKey,
    bName: settled.bName,
    aBefore: settled.aWon,
    bBefore: settled.bWon,
    faced: settled.faced,
    met: settled.met,
    aTook: settled.aTook,
    bTook: settled.bTook,
    penalties: settled.penalties,
  };
}
