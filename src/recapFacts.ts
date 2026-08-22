// What the reporter is told about a night (§2.24).
//
// One pure function: a fixture record in, a small JSON object out. Everything
// in it is already computed by something else — `nightStory` for the sequence,
// `milestones` for what was reached, `duos`, the MVP — and this only gathers
// and flattens.
//
// **Facts, never the log.** The model is handed finished numbers and no raw
// match list, because a language model given eighteen results will do the
// arithmetic itself and get it wrong, and a recap that says Blue won seven when
// they won five is worse than no recap. Nothing here is a sentence either: the
// prose is the model's job, and giving it half-written lines is how every recap
// ends up sounding like the same recap.
//
// **It is deliberately small.** A few hundred bytes of counts rather than the
// whole record: no ratings, no attack values, no keep-apart lists, no ids. What
// leaves the app is roughly what is already on the night page — names, shirts
// and results — and the private half of a player never goes near it (§2.9).
//
// Pure and synchronous on purpose: the same call serves the organiser pressing
// a button today and, unchanged, a recap written the moment a night is filed.

import type { FixtureRecord, Player, TeamColor, TonightPlayer } from './types';
import { TEAM_COLORS } from './balancer';
import { duoFacts } from './duos';
import { tonightsMilestones } from './milestones';
import { nightStory, playerNight } from './nightStory';

export interface RecapTeam {
  team: string; // 'Black' | 'White' | 'Blue' — named, not coded, so the model reads it
  points: number;
  played: number;
  longestRun: number;
  players: string[];
}

export interface RecapPlayerLine {
  name: string;
  team: string;
  played: number;
  won: number;
}

export interface RecapFacts {
  date: string;
  matches: number;
  penalties: number;
  leadChanges: number;
  // 0–100, how often the winner differed from the match before
  chaos: number;
  flavour: string;
  winners: string[]; // team names on the top score; more than one is a tie
  mvp: string | null;
  teams: RecapTeam[];
  players: RecapPlayerLine[];
  // the detectors, already worded as short factual clauses — the *what*, with
  // the writing left alone
  moments: string[];
  // what the night meant for the people in it, as of that night
  milestones: string[];
  duos: string[];
}

// English team keys even though the recap is written in Hebrew: these are
// identifiers the prompt maps to Hebrew names, not copy. Keeping the facts in
// one stable language means a change of output language is a prompt edit rather
// than a change to what gets counted.
const LABEL: Record<TeamColor, string> = { black: 'Black', white: 'White', blue: 'Blue' };
const label = (c: TeamColor) => LABEL[c];

/**
 * Everything the reporter gets, or null for a night with no match log — there
 * is no sequence in three totals, and a recap of a night nobody wrote down
 * would be the model filling in the gaps, which is the one thing it must not do.
 */
export function recapFacts(
  fixture: FixtureRecord,
  history: FixtureRecord[],
  roster: Player[],
): RecapFacts | null {
  const story = nightStory(fixture);
  if (!story) return null;

  const nameOf = (id: string) => fixture.players.find((p) => p.id === id)?.name ?? '?';
  const top = Math.max(...TEAM_COLORS.map((c) => fixture.wins[c] ?? 0));

  // as of that night, never counting the ones that came after it — the same
  // rule the night page draws its milestone strip under
  const asOf = history.filter((fx) => fx.date <= fixture.date);
  const rosterIds = new Set(roster.map((p) => p.id));
  const tonight: TonightPlayer[] = fixture.players.map((p) => ({
    id: p.id,
    name: p.name,
    isGuest: !rosterIds.has(p.id),
  }));

  const moments = story.facts.map((f) => {
    switch (f.kind) {
      case 'streak-broken':
        return `${label(f.by)} ended ${label(f.over)}'s run of ${f.length} at match ${f.at}`;
      case 'break-and-run':
        return `${label(f.team)} started the night and stayed on the pitch for ${f.through} matches`;
      case 'perfect':
        return `${label(f.team)} won all ${f.played} matches they played`;
      case 'blanked':
        return `${label(f.team)} played ${f.played} matches and won none`;
      case 'heist':
        return `${label(f.team)} won ${f.early} of their first ${f.earlyOf} matches and ${f.late} of their last ${f.lateOf}`;
      case 'yo-yo':
        return `${label(f.team)} alternated win and loss ${f.run} matches deep`;
      case 'shootouts':
        return `${f.count} matches were decided on penalties`;
    }
  });

  const milestones = tonightsMilestones(tonight, asOf, fixture.id).map((m) => {
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
        return `${m.name}'s team has won ${m.nights} nights in a row`;
      case 'winless':
        return `${m.name}'s team has not won a night in ${m.nights}`;
    }
  });

  const duos = duoFacts(tonight, asOf, fixture.id).map(
    (d) => `${d.aName} and ${d.bName} have won ${d.won} of their ${d.together} nights together`,
  );

  const players: RecapPlayerLine[] = [];
  for (const p of fixture.players) {
    const n = playerNight(fixture, p.id);
    if (n) players.push({ name: p.name, team: label(n.team), played: n.played, won: n.won });
  }

  return {
    date: fixture.date,
    matches: story.matches,
    penalties: story.penalties,
    leadChanges: story.leadChanges,
    chaos: Math.round(story.alternation * 100),
    flavour: story.flavour,
    winners: TEAM_COLORS.filter((c) => (fixture.wins[c] ?? 0) === top && top > 0).map(label),
    mvp: fixture.mvpId ? nameOf(fixture.mvpId) : null,
    teams: TEAM_COLORS.map((c) => ({
      team: label(c),
      points: fixture.wins[c] ?? 0,
      played: story.teams[c].played,
      longestRun: story.teams[c].longestRun,
      players: fixture.teams[c].map(nameOf),
    })),
    players,
    moments,
    milestones,
    duos,
  };
}
