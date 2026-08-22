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
import { MIN_FACED, matchups } from './playerProfile';

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
  // Individual stories the night produced, which nothing else on the page
  // says: who had the best of it, and — the one worth having — who ran into
  // the opponent who usually beats them and came out ahead.
  notes: string[];
}

// How far behind somebody has to be, over how many matches, before the player
// who keeps beating them counts as a bogey team rather than an opponent.
const BOGEY_BEHIND = 4;
// At most this many personal notes: the report is about a night, and fifteen
// individual sub-plots is a list rather than a story.
const MAX_NOTES = 8;

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

  // A club table was sent for one version and taken back out. Ranked on wins,
  // it put somebody who had turned up once above regulars who had played all
  // season, and the report repeated that as though it meant something. A
  // standing needs a minimum-nights rule to be worth quoting (§2.6 has one for
  // exactly this reason) — and the report is about a night, not a season.
  const notes = nightNotes(fixture, history);

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
    notes,
  };
}

/**
 * The personal stories in a night, counted from what came before it.
 *
 * The one this exists for: a player's **bogey** — the opponent whose team keeps
 * beating theirs — turning up on the other side and losing. That is a real
 * event with a real number behind it, and nothing else in the app would ever
 * mention it, because every other view is about one player or one night rather
 * than the two together.
 *
 * Strictly `date < fixture.date`, so the record quoted is the one they walked
 * in with. Quoting a career total that already includes tonight would have the
 * report say somebody overturned a record that had been overturned.
 */
function nightNotes(fixture: FixtureRecord, history: FixtureRecord[]): string[] {
  const log = fixture.matchLog ?? [];
  if (log.length === 0) return [];
  const before = history.filter((fx) => fx.date < fixture.date);
  const teamOf = (id: string) => TEAM_COLORS.find((c) => fixture.teams[c].includes(id)) ?? null;

  // tonight's head-to-head between each pair of teams
  const pair = new Map<string, { won: number; lost: number }>();
  const key = (a: TeamColor, b: TeamColor) => `${a}|${b}`;
  for (const m of log) {
    const loser = m.winner === m.a ? m.b : m.a;
    const w = pair.get(key(m.winner, loser)) ?? { won: 0, lost: 0 };
    w.won++;
    pair.set(key(m.winner, loser), w);
    const l = pair.get(key(loser, m.winner)) ?? { won: 0, lost: 0 };
    l.lost++;
    pair.set(key(loser, m.winner), l);
  }

  const notes: string[] = [];

  for (const p of fixture.players) {
    if (notes.length >= MAX_NOTES) break;
    const mine = teamOf(p.id);
    if (!mine) continue;

    // who, coming into tonight, had the clearest hold over them
    const bogey = matchups(before, p.id)
      .filter((m) => m.faced >= MIN_FACED && m.beatenBy - m.beat >= BOGEY_BEHIND)
      .sort((a, b) => b.beatenBy - b.beat - (a.beatenBy - a.beat))[0];
    if (!bogey) continue;

    const theirs = teamOf(bogey.id);
    if (!theirs || theirs === mine) continue;
    const tonight = pair.get(key(mine, theirs));
    if (!tonight || tonight.won <= tonight.lost) continue;

    // Said as a story rather than as a record. The first version read
    // "came into tonight 2-8 down against ירין across their careers, and
    // tonight ניב's team beat ירין's 3-1", which is four numbers for one joke
    // and buries the joke under them.
    notes.push(
      `${p.name} nearly always comes off worse against ${bogey.name} — and tonight ${p.name}'s team beat theirs`,
    );
  }

  // Who had the most of the night and who had the least of it. Both are in the
  // per-player list already, and both are buried in it — the model should not
  // have to sort fifteen rows to find the story, and if it has to, it won't.
  let best: { names: string[]; won: number } = { names: [], won: 0 };
  const rough: string[] = [];
  for (const p of fixture.players) {
    const n = playerNight(fixture, p.id);
    if (!n) continue;
    if (n.won > best.won) best = { names: [p.name], won: n.won };
    else if (n.won === best.won && best.won > 0) best.names.push(p.name);
    // a long evening with nothing to show for it, which is a fact about their
    // team's results and fair game — see the teasing rule in the prompt
    if (n.won === 0 && n.played >= 4) rough.push(p.name);
  }
  if (best.won > 0 && best.names.length <= 5) {
    notes.push(`Most matches won tonight: ${best.names.join(', ')} with ${best.won}`);
  }
  if (rough.length > 0 && rough.length <= 5) {
    notes.push(`Played at least 4 and won none of them: ${rough.join(', ')}`);
  }

  // A personal best, which the app has never told anybody about: the most
  // matches they have ever won in one evening.
  for (const p of fixture.players) {
    if (notes.length >= MAX_NOTES) break;
    const n = playerNight(fixture, p.id);
    if (!n || n.won < 3) continue;
    let bestEver = 0;
    for (const fx of before) {
      const had = playerNight(fx, p.id);
      if (had && had.won > bestEver) bestEver = had.won;
    }
    if (bestEver > 0 && n.won > bestEver) {
      notes.push(`${p.name} won more matches tonight than on any night they have played before`);
    }
  }

  return notes.slice(0, MAX_NOTES);
}
