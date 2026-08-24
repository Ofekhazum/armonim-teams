import type { FixtureRecord, TeamColor, Teams, TonightPlayer } from './types';
import { TEAM_COLORS } from './balancer';

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
// **The score is `contested = 2 × min(beat, beatenBy)`.** Read it as "how many
// of their matches have genuinely gone each way": a 7–7 record contests all
// fourteen, a 9–5 contests ten, a 12–2 contests four. It rewards volume and
// balance in one number without a tuning constant, and it falls out of the
// obvious identity — `faced − |beat − beatenBy|` is the same thing — so there
// is no weighting anybody has to be talked into.
//
// It also sidesteps the trap the other direction. Shrinking a win *share*
// toward even, the way `duos.ts` shrinks toward the base rate, would rank a
// 1–1 record above a 9–7 one: shrinkage pulls a thin record to exactly even,
// and "exactly even" is what this metric is hunting. Counting contested
// matches has the opposite bias, which is the correct one here.
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
  contested: number; // 2 × min(aWon, bWon) — the score, see above
}

/**
 * Contested matches before a pairing is worth announcing.
 *
 * Eight means at least four each way, which is two or three logged nights of
 * genuinely two-sided football. Below that the banner is describing an
 * evening rather than a rivalry, and with roughly seventy-five cross-team
 * pairs on any given sheet, *something* will always look level by accident —
 * the floor is what stops the most ordinary pair in the club being crowned
 * every week.
 *
 * Measured against the invented club (§2.32): at 6 this fires for a pair with
 * three wins each, which reads as thin next to the ones at 14 and 16. At 8 the
 * banner still appears on most sheets and every pair it names has a record
 * worth the word.
 */
export const MIN_CONTESTED = 8;

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
    const contested = 2 * Math.min(r.first, r.second);
    if (contested < MIN_CONTESTED) continue;

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
      contested,
    };

    // Most contested wins. A tie goes to the longer rivalry, then to the
    // name — never to whichever way the map happened to iterate.
    if (
      !best ||
      derby.contested > best.contested ||
      (derby.contested === best.contested &&
        (derby.faced > best.faced ||
          (derby.faced === best.faced && derby.aName.localeCompare(best.aName, 'he') < 0)))
    ) {
      best = derby;
    }
  }

  return best;
}
