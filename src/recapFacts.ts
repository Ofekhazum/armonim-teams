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
import { MIN_FACED, matchups, profileCounts, profileNights } from './playerProfile';
import { isWinMilestone } from './milestones';
import { derbyOnRecord, settleDerby } from './derby';
import { stripMarks } from './eventMarks';

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
  // Tonight's derby and how it actually went (§2.33). The one fact in here the
  // group was told to watch for *before* kick-off, which is why the report
  // leaving it out was so conspicuous. Absent on a night with no match log,
  // and on one where no pair had enough history to be picked.
  derby?: string;
  // What the organiser typed as they filed the night, if anything. Everything
  // else here was counted; this is the only line the app did not work out for
  // itself, and it is the only route by which something that happened off the
  // scoreboard — the ball over the fence, the shirt worn inside out — reaches
  // the report at all.
  said?: string;
}

// How far behind somebody has to be, over how many matches, before the player
// who keeps beating them counts as a bogey team rather than an opponent.
const BOGEY_BEHIND = 4;
// At most this many notes in total, and at most this many of any one kind.
//
// The cap is the point rather than a safety valve. A report is about 350 words;
// hand it twelve equally-weighted facts and it picks three at random and
// mentions none of them properly. Every detector below is gated so that it
// fires on a night when the thing actually happened, and the two of each rule
// stops one popular kind — a squad of fifteen all having worn three shirts —
// crowding out the rare one.
const MAX_NOTES = 10;
const MAX_PER_KIND = 2;

// Shirt luck: nights in a colour before it is worth a superstition, and how far
// apart two colours have to be to be worth remarking on.
const MIN_SHIRT_NIGHTS = 4;
const SHIRT_GAP = 0.3;
// A player is "back" after this many club nights away.
const AWAY_NIGHTS = 3;
// A career win milestone this close is worth pointing at.
const NEAR_MILESTONE = 6;
// A team that played this share of the night or less spent it watching — and
// has to be at least BENCH_GAP matches behind the busiest team before that is
// worth saying at all. See the note at the detector.
const BENCH_SHARE = 0.6;
const BENCH_GAP = 3;

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

  // 🤝 The derby, settled (§2.33).
  //
  // The group reads the derby banner before kick-off — two players who cannot
  // put each other away, named to the whole club — and then the report never
  // mentioned how it went, because it was never in the payload. That is the
  // one thing in the night the audience was already told to watch for, so its
  // absence was the most conspicuous gap in the report.
  //
  // Recovered rather than remembered, exactly as `gradesFacts` does it:
  // `derbyOnRecord` recomputes the pick the group actually read, and
  // `settleDerby` counts what the two shirts did to each other. `met: 0` is
  // kept rather than dropped — a rivalry the night failed to stage is a better
  // line than most of what is here.
  const derby = (() => {
    const picked = derbyOnRecord(fixture, asOf, rosterIds);
    if (!picked) return null;
    const settled = settleDerby(fixture, picked);
    if (!settled) return null;
    const { aName, bName, met, aTook, bTook, faced, aWon, bWon, penalties } = settled;
    const history_ = `going in, ${aWon}-${bWon} to ${aName} across ${faced} matches — which is why they were picked`;
    if (met === 0) {
      return `${aName} and ${bName} were tonight's derby (${history_}) and their teams never met`;
    }
    const shootouts = penalties > 0 ? `, ${penalties} of them on penalties` : '';
    return `${aName} and ${bName} were tonight's derby (${history_}); their teams met ${met} times${shootouts} and it finished ${aTook}-${bTook}`;
  })();

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
    ...(derby ? { derby } : {}),
    // Markers taken off first (§2.57): a `+` is punctuation addressed to the
    // grade formula, and quoting one back at the group in a match report would
    // be the app talking to itself in public.
    ...(stripMarks(fixture.note) ? { said: stripMarks(fixture.note)! } : {}),
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
  const asOf = history.filter((fx) => fx.date <= fixture.date);
  const teamOf = (id: string) => TEAM_COLORS.find((c) => fixture.teams[c].includes(id)) ?? null;
  const rosterOf = new Set(before.flatMap((fx) => fx.players.map((p) => p.id)));

  // Notes are collected per kind and merged at the end, so one crowded kind
  // cannot eat the whole list before a rarer one is even looked at.
  const kinds = new Map<string, string[]>();
  const add = (kind: string, line: string) => {
    const got = kinds.get(kind) ?? [];
    if (got.length < MAX_PER_KIND) got.push(line);
    kinds.set(kind, got);
  };

  // tonight's head-to-head between each pair of teams, in order, so both the
  // rivalry note and the turnaround below can be read off it
  const meetings = new Map<string, TeamColor[]>();
  const pairKey = (a: TeamColor, b: TeamColor) => [a, b].sort().join('|');
  for (const m of log) {
    const loser = m.winner === m.a ? m.b : m.a;
    const k = pairKey(m.winner, loser);
    meetings.set(k, [...(meetings.get(k) ?? []), m.winner]);
  }

  // 🔁 Revenge inside the night — beaten twice by the same team early, and
  // beating them at least twice later. Two-and-two rather than one-and-one,
  // because with three teams sharing a pitch a single win back is just the
  // evening happening.
  for (const [k, winners] of meetings) {
    const [a, b] = k.split('|') as TeamColor[];
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as [TeamColor, TeamColor][]) {
      const lostEarly = winners.slice(0, 2).every((w) => w === y);
      const wonLate = winners.slice(2).filter((w) => w === x).length >= 2;
      if (winners.length >= 4 && lostEarly && wonLate) {
        add(
          'revenge',
          `${LABEL[x]} lost their first two meetings with ${LABEL[y]} tonight and then beat them twice`,
        );
      }
    }
  }

  // 🪑 Bench time — the team that spent the night watching.
  //
  // **Relative to the other two, not to the night.** The share test alone
  // called a team benched for playing 6 of 10 while the others played 7 — a
  // one-match difference, on an evening that swung so much all three were
  // barely off the pitch. The report duly announced that they "spent more time
  // watching than playing", which was both untrue and unkind to a team that
  // had just taken two and a half points from those six.
  //
  // Playing less is only a story when it is conspicuous, and conspicuous means
  // next to the others: a rest in this format is one match long, so a team has
  // to be several behind the busiest before anyone in the hall would notice.
  // Both tests now have to pass.
  const playedBy = (c: TeamColor) => log.filter((m) => m.a === c || m.b === c).length;
  const busiest = Math.max(...TEAM_COLORS.map(playedBy));
  for (const c of TEAM_COLORS) {
    const played = playedBy(c);
    if (played / log.length <= BENCH_SHARE && busiest - played >= BENCH_GAP) {
      add(
        'bench',
        `${LABEL[c]} were only on the pitch for ${played} of the ${log.length} matches — they watched more football than they played`,
      );
    }
  }

  for (const p of fixture.players) {
    const mine = teamOf(p.id);
    if (!mine) continue;
    const isGuest = !rosterOf.has(p.id);
    const mine_ = mine;

    // ⭐ Guest form — somebody's mate turning up and taking the night off the
    // regulars, which is the most enjoyable result in five-a-side.
    if (isGuest) {
      const top = Math.max(...TEAM_COLORS.map((c) => fixture.wins[c] ?? 0));
      if (top > 0 && (fixture.wins[mine_] ?? 0) === top) {
        add('guest', `${p.name} was a guest tonight and finished on the winning team`);
      }
      // everything below reads a career, and a guest does not have one
      continue;
    }

    const mine_nights = profileNights(asOf, p.id);
    const past = profileNights(before, p.id);

    // 👕 Shirt luck — the colour they win in against the one they do not.
    // Superstition, and said as superstition: three shirts is not a treatment
    // effect, it is a thing to blame.
    const byShirt = TEAM_COLORS.map((c) => {
      const inIt = mine_nights.filter((n) => n.shirt === c && n.won !== null);
      const won = inIt.filter((n) => n.won).length;
      return { c, played: inIt.length, rate: inIt.length ? won / inIt.length : 0, won };
    }).filter((x) => x.played >= MIN_SHIRT_NIGHTS);
    if (byShirt.length >= 2) {
      const best = [...byShirt].sort((x, y) => y.rate - x.rate)[0];
      const worst = [...byShirt].sort((x, y) => x.rate - y.rate)[0];
      if (best.c !== worst.c && best.rate - worst.rate >= SHIRT_GAP) {
        add(
          'shirt',
          `${p.name} has won ${best.won} of their ${best.played} nights in ${LABEL[best.c].toLowerCase()} and ${worst.won} of their ${worst.played} in ${LABEL[worst.c].toLowerCase()}${
            mine_ === best.c
              ? ` — and tonight they were in ${LABEL[best.c].toLowerCase()}`
              : mine_ === worst.c
                ? ` — and tonight they were in ${LABEL[worst.c].toLowerCase()}`
                : ''
          }`,
        );
      }
    }

    // 🕰️ First night since — how many club nights went by without them.
    const lastSeen = past[past.length - 1];
    if (lastSeen) {
      const missed = before.filter((fx) => fx.date > lastSeen.date).length;
      if (missed >= AWAY_NIGHTS) {
        // **No date here, deliberately.** This used to end "— their last one
        // was 2026-08-06", and the reporter printed that ISO string verbatim
        // into a Hebrew sentence, which is exactly what the rule two sections
        // up in the prompt tells it to do: every number comes from the record
        // unchanged. The count of nights missed is the fact worth having; the
        // calendar date is precision nobody in a WhatsApp group wants and the
        // one shape of number that cannot survive being copied.
        add('return', `${p.name} is back after missing ${missed} nights`);
      }
    }

    // 💤 The drought ended — nights on a losing side, and tonight not.
    const decided = past.filter((n) => n.won !== null);
    let drought = 0;
    for (let i = decided.length - 1; i >= 0 && decided[i].won === false; i--) drought++;
    const tonightWon = mine_nights[mine_nights.length - 1]?.won === true;
    if (tonightWon && drought >= 4) {
      add(
        'drought',
        `${p.name} had not been on a winning team for ${drought} nights, and tonight they were`,
      );
    }

    // 🎯 Now N from a milestone — said after the night rather than before it,
    // which is the difference between a promise and a countdown.
    const wins = Math.floor(profileCounts(mine_nights).wins);
    for (let w = wins + 1; w <= wins + NEAR_MILESTONE; w++) {
      if (isWinMilestone(w)) {
        add('milestone', `${p.name} is now ${w - wins} match wins short of ${w}`);
        break;
      }
    }

    // ⏳ The early/late split — `playerArcs` — is deliberately NOT a note.
    //
    // It was one, and the reports it produced are why it is not: "ירין ו-אופק
    // הראו סימני עייפות קשים לקראת הסוף כשהם קורסים לתוך הלילה". Nobody
    // collapsed into anything. Two players have a mild lean across a career's
    // worth of nights, and the reporter — correctly told to build a story out
    // of every fact it is handed — turned a statistical tendency into an event
    // that did not happen on the evening being reported.
    //
    // That is the tell for what belongs here at all: a note has to be
    // something that happened *tonight*, or a career fact tonight just
    // changed. A standing habit is neither, and there is no wording of it that
    // stops a sports reporter dramatising it, because dramatising is the job.
    // It stays on the player's own page, which is where a tendency reads as a
    // tendency. See §2.24.

    // who, coming into tonight, had the clearest hold over them
    const bogey = matchups(before, p.id)
      .filter((m) => m.faced >= MIN_FACED && m.beatenBy - m.beat >= BOGEY_BEHIND)
      .sort((a, b) => b.beatenBy - b.beat - (a.beatenBy - a.beat))[0];
    if (bogey) {
      const theirs = teamOf(bogey.id);
      const k = theirs && theirs !== mine_ ? pairKey(mine_, theirs) : null;
      const won = k ? (meetings.get(k) ?? []).filter((w) => w === mine_).length : 0;
      const lost = k ? (meetings.get(k) ?? []).length - won : 0;
      if (k && won > lost) {
        // Said as a story rather than as a record. The first version read
        // "came into tonight 2-8 down against ירין across their careers", which
        // is four numbers for one joke and buries the joke under them.
        add(
          'bogey',
          `${p.name} nearly always comes off worse against ${bogey.name} — and tonight ${p.name}'s team beat theirs`,
        );
      }
    }
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
    if (n.won === 0 && n.played >= 4) rough.push(p.name);
  }
  if (best.won > 0 && best.names.length <= 5) {
    add('best', `Most matches won tonight: ${best.names.join(', ')} with ${best.won}`);
  }
  if (rough.length > 0 && rough.length <= 5) {
    add('rough', `Played at least 4 and won none of them: ${rough.join(', ')}`);
  }

  // Rarest first, so the cap drops the ordinary end. A squad of fifteen
  // produces shirt records every week; a drought breaking is a season event.
  const ORDER = [
    'bogey',
    'drought',
    'revenge',
    'return',
    'guest',
    'milestone',
    'shirt',
    'halves',
    'bench',
    'best',
    'rough',
  ];
  return ORDER.flatMap((k) => kinds.get(k) ?? []).slice(0, MAX_NOTES);
}
