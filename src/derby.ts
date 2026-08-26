import type { FixtureRecord, TeamColor, Teams, TonightPlayer } from './types';
import { TEAM_COLORS } from './balancer';
import { BOGEY_RATE } from './playerProfile';

// Tonight's derby: the two players on opposing shirts with the most football
// between them that has actually gone both ways (§2.33).
//
// **A derby is not a bogey man, and the difference is the whole design.**
// `playerProfile.matchupPicks` already finds the player whose team has beaten
// yours most, and that is the right fact for a profile page you opened about
// yourself. It is the wrong fact for a banner the entire group reads before
// kick-off: "ניב has beaten אופק 12 times to 2" puts one named friend on a
// screen as the loser, every week, decided by an app. The symmetric version
// costs nothing and reads better anyway — a rivalry that is *level* is the one
// worth announcing, which is also what the word derby has always meant.
//
// **The pick is the closest record, over at least `MIN_MATCHES` matches** —
// smallest `gap = |beat − beatenBy|`, and the longer rivalry wins a tie. The
// same shape as the worthy opponent on a player's page (§2.18), which is the
// right family for this: a derby is two people who cannot put each other away.
//
// This replaced a first attempt that scored `contested = 2 × min(beat,
// beatenBy)` — "how many of their matches have gone each way" — and the reason
// is worth keeping. That metric is dominated by *volume*: measured against the
// invented club it crowned a 40–32 record over 72 matches, a 56% split that is
// not level at all, while a dead-level 27–27 over 54 came third. Worse, the
// two players it named are the two keenest attenders in the club, so the same
// pair would headline a large share of every night — and a banner that says
// the same thing every week stops being read. Ranking on the gap picks the
// rivalry rather than the fixture list.
//
// **The floor is on matches faced, not on the gap**, and it has to be. A gap
// of zero is trivially available: play someone once, lose, play again, win.
// Requiring ten matches first is what separates "cannot be separated" from
// "has barely been tried". It also rules out the shrinkage approach `duos.ts`
// uses — pulling a thin record toward even is the exact wrong correction when
// even is what you are looking for, and would rank 1–1 above 9–7.
//
// **Counted in matches, not nights.** A night is a blunt unit for a rivalry —
// two players can be opponents for two hours and the night records one winner
// between three teams. Only nights logged match by match can answer this at
// all (§2.17), the same constraint `Matchup.faced` carries.

export interface Derby {
  // Ordered by tonight's shirt (black, white, blue), so the banner reads in
  // the same order the team cards below it do.
  aId: string;
  aName: string;
  aShirt: TeamColor;
  aWon: number; // matches a's team took off b's
  bId: string;
  bName: string;
  bShirt: TeamColor;
  bWon: number;
  faced: number; // matches with the two of them on opposite sides
  gap: number; // |aWon − bWon| — the score, lower is a better derby
}

/**
 * Matches the two of them must have played before a pairing can be announced.
 *
 * **Ten**, which is roughly one and a half logged nights of being opposite
 * each other. The floor is doing the whole job here: with about seventy-five
 * cross-team pairs on any given sheet, several will be dead level at 1–1 or
 * 3–3 purely by accident, and without a floor the banner would crown one of
 * those every week over the pair who have genuinely been at it all season.
 *
 * A little higher than the worthy opponent's `MIN_FACED = 8` (§2.18) on
 * purpose. That card is one line on a page about you, among many, and can
 * afford a thinner record; this is the only thing on the screen and it is
 * addressed to everyone.
 */
export const MIN_MATCHES = 10;

/**
 * A ceiling as well as a floor, and the floor alone is not enough.
 *
 * Ranking on the smallest gap picks the *least* lopsided pair on the sheet,
 * which is not the same as picking a level one. On a night where nobody has a
 * close record, the closest available might still be 14–6 — and a banner
 * announcing that to the group is the bogey man this whole file was written to
 * avoid, arrived at by a different road. So a pair who cannot clear
 * `BOGEY_RATE` in either direction gets no banner at all.
 *
 * Deliberately the same constant the worthy opponent uses (§2.18), imported
 * rather than re-declared, which buys a property worth stating plainly: **a
 * derby is a pairing in which neither player is the other's bogey man.** Two
 * numbers 0.6 apart in two files would drift, and the sentence would quietly
 * stop being true.
 */
const levelEnough = (win: number, lose: number): boolean =>
  Math.max(win, lose) / (win + lose) < BOGEY_RATE;

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface Head {
  faced: number;
  // wins for whichever id sorts first in the key, and for the other one.
  // Keyed this way rather than by name so the arithmetic never depends on
  // which order a caller happened to hand them over in.
  first: number;
  second: number;
}

/**
 * The derby on tonight's sheet, or null when no pairing has enough history.
 *
 * `tonightId` is excluded the same way `duoFacts` and `tonightsMilestones`
 * exclude it: tonight's own result, if it has already been saved, is not part
 * of the record the two of them are bringing into tonight.
 */
export function derbyTonight(
  teams: Teams,
  todays: TonightPlayer[],
  history: FixtureRecord[],
  tonightId?: string | null,
): Derby | null {
  // Guests carry a fresh id every visit, so a pair involving one can never
  // accumulate a record — the same reasoning as milestones and duos, stated
  // here rather than left to MIN_CONTESTED to filter out by accident.
  const guests = new Set(todays.filter((p) => p.isGuest).map((p) => p.id));
  const nameOf = new Map(todays.map((p) => [p.id, p.name]));

  // Every pair that is on opposing shirts *tonight*, with the shirts they are
  // wearing. Built first so the history walk below can skip everything else —
  // there are about seventy-five of these against a few thousand pairs a
  // season's worth of matches would otherwise produce.
  const wanted = new Map<string, { x: string; xShirt: TeamColor; y: string; yShirt: TeamColor }>();
  for (let i = 0; i < TEAM_COLORS.length; i++) {
    for (let j = i + 1; j < TEAM_COLORS.length; j++) {
      for (const x of teams[TEAM_COLORS[i]]) {
        if (guests.has(x)) continue;
        for (const y of teams[TEAM_COLORS[j]]) {
          if (guests.has(y)) continue;
          wanted.set(key(x, y), {
            x,
            xShirt: TEAM_COLORS[i],
            y,
            yShirt: TEAM_COLORS[j],
          });
        }
      }
    }
  }
  if (wanted.size === 0) return null;

  const past = tonightId ? history.filter((f) => f.id !== tonightId) : history;
  const rec = new Map<string, Head>();

  for (const fx of past) {
    const log = fx.matchLog;
    if (!log?.length) continue;
    for (const m of log) {
      // Who was on the pitch for this match, and which side took it. A
      // shootout still decided the match, so it counts as a win here — the
      // half-point rule is about the night's tally, not about who beat whom.
      const loser = m.winner === m.a ? m.b : m.a;
      for (const w of fx.teams[m.winner] ?? []) {
        for (const l of fx.teams[loser] ?? []) {
          const k = key(w, l);
          if (!wanted.has(k)) continue;
          const r = rec.get(k) ?? { faced: 0, first: 0, second: 0 };
          r.faced++;
          if (w < l) r.first++;
          else r.second++;
          rec.set(k, r);
        }
      }
    }
  }

  let best: Derby | null = null;
  for (const [k, r] of rec) {
    if (r.faced < MIN_MATCHES) continue;
    if (!levelEnough(r.first, r.second)) continue;
    const gap = Math.abs(r.first - r.second);

    const pair = wanted.get(k)!;
    const [firstId] = k.split('|');
    // Re-express the key-ordered counts against tonight's shirt order.
    const xWon = pair.x === firstId ? r.first : r.second;
    const yWon = pair.y === firstId ? r.first : r.second;

    const derby: Derby = {
      aId: pair.x,
      aName: nameOf.get(pair.x) ?? '?',
      aShirt: pair.xShirt,
      aWon: xWon,
      bId: pair.y,
      bName: nameOf.get(pair.y) ?? '?',
      bShirt: pair.yShirt,
      bWon: yWon,
      faced: r.faced,
      gap,
    };

    // Closest record wins. A tie goes to the longer rivalry — dead level over
    // fifty matches is a better derby than dead level over ten, and this is
    // the only place volume gets a say — then to the name, so the answer never
    // depends on which way the map happened to iterate.
    if (
      !best ||
      derby.gap < best.gap ||
      (derby.gap === best.gap &&
        (derby.faced > best.faced ||
          (derby.faced === best.faced && derby.aName.localeCompare(best.aName, 'he') < 0)))
    ) {
      best = derby;
    }
  }

  return best;
}

/**
 * The derby that was announced before a night that has since been filed.
 *
 * Nothing is stored when the banner goes up, and nothing needs to be: the pick
 * is a pure function of that night's teams and the archive before it, so it can
 * be recovered exactly. That matters for the grades (§2.39), which are written
 * days later and have to be talking about the rivalry the group actually read
 * on the night rather than a fresh one computed against newer history.
 *
 * `rosterIds` is how a guest is recognised after the fact — a filed
 * `FixturePlayer` carries no `isGuest` flag, only an id, and an id that is not
 * on the roster is a guest. Optional because it barely matters: a guest's id is
 * minted fresh each visit (§2.6), so a pair involving one cannot reach
 * `MIN_MATCHES` anyway. Passing it makes the intent explicit rather than
 * leaving it to a floor to catch by accident.
 */
export function derbyOnRecord(
  fx: FixtureRecord,
  history: FixtureRecord[],
  rosterIds?: ReadonlySet<string>,
): Derby | null {
  const todays: TonightPlayer[] = fx.players.map((p) => ({
    id: p.id,
    name: p.name,
    isGuest: rosterIds ? !rosterIds.has(p.id) : false,
  }));
  return derbyTonight(fx.teams, todays, history, fx.id);
}

/** A derby with tonight's answer to it attached. */
export interface DerbySettled extends Derby {
  /** Matches the two shirts played against each other tonight. */
  met: number;
  /** Of those, how many each side took. */
  aTook: number;
  bTook: number;
  /** How many of the meetings needed a shootout — good material, nothing more. */
  penalties: number;
}

/**
 * How the announced derby actually went, or `null` if the night cannot say.
 *
 * Null has two causes and they are the same answer to the reader: a night with
 * no `matchLog` was only ever a tally, so who beat whom is unanswerable
 * (§2.17); and a night where the two shirts never met leaves the rivalry
 * genuinely unresolved. The second is reported rather than hidden — `met: 0` is
 * a fact about the evening and a better line than most — so only the first
 * returns null.
 *
 * **A shootout counts as a win here**, exactly as it does in the record the
 * pairing was picked from above. The half-point rule is about the night's
 * tally, not about who beat whom, and a derby settled on penalties that scored
 * half a win for each side would be no settlement at all.
 */
export function settleDerby(fx: FixtureRecord, derby: Derby): DerbySettled | null {
  const log = fx.matchLog;
  if (!log?.length) return null;

  let met = 0;
  let aTook = 0;
  let bTook = 0;
  let penalties = 0;
  for (const m of log) {
    const pair = (m.a === derby.aShirt && m.b === derby.bShirt) ||
      (m.a === derby.bShirt && m.b === derby.aShirt);
    if (!pair) continue;
    met++;
    if (m.viaPenalties) penalties++;
    if (m.winner === derby.aShirt) aTook++;
    else bTook++;
  }

  return { ...derby, met, aTook, bTook, penalties };
}
