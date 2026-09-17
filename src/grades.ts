// A mark out of ten for every player on a filed night (§2.39).
//
// **The number is arithmetic. Only the sentence is written by a model.** Same
// split as Market Value (§2.31): the app computes something defensible and the
// model is handed the finished figure and told to explain it. A model asked to
// invent the grade would be inventing the one thing the data cannot support —
// see below.
//
// **What a night actually knows about one player.** `MatchLogEntry` records
// `{a, b, winner, viaPenalties}` — team colours, not people. Every match, every
// shootout and every sequence is therefore *identical* for the five players on
// a shirt. On a single night exactly one thing distinguishes teammates: what
// the room said about them. Everything else that differs between them is
// history.
//
// Since §2.46 that is the whole vote rather than one name, which matters here
// more than anywhere else in the app: a tally is the only per-night input with
// any *resolution*, so it is the only one that can separate more than two
// teammates. A 3–2–1 sheet says three different things about three players on
// the same shirt; a single pick said one thing about one of them and nothing
// at all about the other four.
//
// So the grade is built from four terms, and only two of them can separate
// teammates at all:
//
//   night     the team's result, shared by all five, and dominant
//   close     a share of the winner's floor, for finishing near them (§2.48)
//   mvp       the one true per-night personal signal
//   career    where their record sits against the club's
//   momentum  where their last few nights sit against their own record
//
// **Why "did they beat their own baseline tonight" is not one of them.**
// Measured on the invented club, a single night swings a player's per-night
// figure by −2.0 to +2.4 (p10–p90) while the gap between the club's best and
// worst player is 1.61. One night is mostly luck. Worse, that term inverts:
// on an identical night the weakest player "overperforms" by more than the
// strongest, so over a season every player averages the same mark and the best
// players score lowest on ordinary wins. The personal-expectation angle is
// real and worth saying — it belongs in the *sentence*, where it can be
// qualitative, not in the number, where it would be backwards.
//
// **Momentum is safe for the opposite reason.** Averaged over several nights
// it is far less noisy, it is measured against each player's *own* baseline so
// it favours nobody, and it mean-reverts: per-player season averages land
// between −0.30 and +0.21 on the sandbox. It adds movement, not bias.
//
// **A fifth term, `tier`, is a permanent structural component and reads the
// organiser's private rating (§2.28)** — the one input every other feature in
// this app (Market Value, the recap, `PlayerCompare`) goes out of its way never
// to touch. It is here on the organiser's explicit and repeated instruction,
// and the reasoning behind it is theirs: a better player should mark higher
// than a weaker one on a comparable night, the ratings are actively maintained
// as players improve or decline, and a grade that ignored them would be
// fighting those updates rather than reflecting them.
//
// **The cost, stated plainly rather than buried.** `night`, `mvp`, `career` and
// `momentum` are all computable by anyone from `GET /history`, which needs no
// password. So the residual `grade − (those four)` is `tier` exactly, on every
// night a player has played — **a determined reader can recover which third of
// the club the organiser puts somebody in**, and since 2026-08-28 they can do it
// from a single night rather than by averaging a season.
//
// A zero-mean `jitter` used to sit in that residual. It never actually helped:
// averaging is what recovers `tier`, and averaging is precisely what removes a
// zero-mean hash, so it hid one night at a time against an attack that reads
// many. It was removed once it started cancelling the rating it was shading —
// see the note where it used to be defined. This was measured, argued and
// overruled deliberately, three times now; it is an accepted product trade,
// not an oversight.
//
// An earlier version faded this out by `FADE_NIGHTS`, which capped the exposure
// at a short window. That was removed on purpose: a fading bump means an
// improving player's updated rating stops reaching their marks precisely once
// they have played enough for the update to be based on something, which is
// backwards. `marketValue.ts` makes the same call — its `tier` never decays,
// and it buys its safety a different way, by withholding the whole feature
// until `MIN_HISTORY_FOR_VALUES` nights of real variance exist to hide inside.
//
// **What keeps this bounded** is no longer its size — the organiser has raised
// it three times and it is now the second-strongest term in the formula, at
// ±0.8 against `career`'s ±0.5 and `momentum`'s ±0.55. What bounds it is that
// `night` still spans 5.0 plus a `WIN_BONUS`, so **a top-tier player on a beaten
// team still marks below a bottom-tier player on the winning one.** That
// ordering is the line: it is what keeps these marks about the football rather
// than about the organiser's opinion of who is good, and it should not be
// crossed without them saying so in as many words.

import type { FixtureRecord, TeamColor } from './types';
import { hasResult } from './calibration';
// From its own module rather than from `marketValue.ts`, which `values.ts`
// deliberately loads lazily — a static import of it here would put the
// valuation formula and its ridge solver into everybody's main bundle.
import { ratingTier } from './ratingTier';
import { placeOf, profileNights, shirtOf, type Place } from './playerProfile';
import { totalVotes } from './mvp';
import { eventMarks } from './eventMarks';

/**
 * Where an ordinary night lands.
 *
 * Six rather than the arithmetic midpoint of the scale. A 1–10 centred on 5.5
 * is technically balanced and reads as mean: most nights are unremarkable, so
 * most marks sat at 5 and below, and a group reading their own marks every week
 * would be told they were average-to-poor most of the time. Six leaves the same
 * spread and the same ordering — it moves where "nothing special happened"
 * sits, which is a judgement about tone, not about the football.
 */
export const BASE = 6;
export const GRADE_MIN = 1;
export const GRADE_MAX = 10;

/**
 * The night's result, relative to that night's own size.
 *
 * Relative on purpose: four wins on a nine-match night is not four wins on a
 * thirteen-match night, and the club plays both. A team taking exactly its
 * share of a night scores 0 here.
 */
const NIGHT_W = 2.6;
const NIGHT_CAP = 2.5;

/**
 * A night won outright is worth at least this, whatever else is true.
 *
 * **Asked for directly, after the first real night the club graded.** A team
 * took 7 of 12 while the other two took 2 and 3, and players on it still came
 * out at 7.5 — the personal terms (`career`, `momentum`, `tier`) span enough
 * between them, which is easily enough to drag somebody below the
 * mark their team's night deserved. The complaint was not that the ordering was
 * wrong, it was that the *floor* was: winning a night comfortably and being
 * told you were a 7.5 reads as a correction rather than a result.
 *
 * A floor rather than a bigger `night` term, because the two do different
 * things. Widening `night` lifts the winners and pushes the other two teams
 * down by the same move — it is one symmetric slider — and nobody complained
 * about the losing teams. This lifts only the team that actually took the
 * night, and leaves every other mark on the sheet exactly where it was.
 *
 * **What it costs, said plainly:** marks inside the winning team compress. Two
 * players who would have been 7 and 7.5 are now both 8, and the spread that
 * survives is only the part above the floor. That is the trade the floor *is* —
 * the alternative is a winner reading a 7. `NIGHT_W` was widened a little at
 * the same time (2.3 → 2.6) so a dominant win clears 8 on its own and the floor
 * stays what it is meant to be: a safety net for the narrow wins, not the thing
 * setting most of the winners' marks.
 *
 * Outright only. A night level at the top belongs to nobody (§2.6), so nobody
 * on it is floored for having won one.
 */
const WIN_FLOOR = 8;

/**
 * The most a player can score without being picked player of the night.
 *
 * **The top of the scale is reserved for the pick, deliberately.** Before this,
 * a top-tier player on a winning team started at 9.50 before any of their own
 * history was counted, and needed only `career + momentum >= +0.25` to reach a
 * 10 — on a 7-of-12 night that was not even a rout, with no pick. The
 * theoretical maximum without one was 11.10 raw, which the clamp was quietly
 * absorbing: when the ceiling is overshot by that much, the top of the scale
 * has stopped discriminating and a 10 means "good night on a good team".
 *
 * Now 9.5 and 10 exist only for the player the room voted for. That makes the
 * two best marks of the evening say something a scoreline cannot, which is the
 * whole reason the MVP is in this formula (§2.39: it is the one genuinely
 * personal signal a night produces).
 *
 * **It used not to hand the MVP the best mark**, on the reasoning that `night`
 * outweighs `MVP_BONUS` by some distance and a pick on a beaten team should
 * still mark below a winner. That was reversed on the organiser's ask: see
 * `MVP_CLEAR`. Reserving the top two rungs turned out not to be the same as
 * using them — on a night where the pick came from a beaten team, this cap
 * stopped everybody else reaching 9.5 without ever lifting the pick above the
 * winners at 9, so the room's own verdict finished level with or below a mark
 * the scoreline had already decided.
 *
 * Interaction with {@link WIN_FLOOR} is deliberate and worth reading together:
 * a non-MVP winner now lives in [8, 9], which on a half-point scale is three
 * rungs. That is enough for the three rating tiers to separate cleanly — as
 * they do on the night this was measured against — and it is the honest width
 * of "won the night, was not the best player on the pitch".
 */
const UNPICKED_CAP = 9;

/**
 * And nobody who turned up goes below this, whatever the scoreboard did.
 *
 * The same night that produced {@link WIN_FLOOR}: the two teams that did not
 * win were landing at 3 and 3.5, and the organiser raised both to 4. It is the
 * `BASE = 6` argument applied to the other end of the scale — the mark is read
 * every week by the person it is about, and there is no version of a Thursday
 * five-a-side night that is worth telling somebody they were a 3 out of 10 for.
 *
 * **What it is not.** Not a claim that every night was fine, and not a
 * flattening of the bottom third: the spread between a quiet night and a
 * hammering survives above the floor, and losing teams still mark clearly below
 * winning ones. It only sets where the bottom of the scale actually starts, the
 * way `BASE` sets where the middle sits.
 *
 * `GRADE_MIN` stays 1 as the definition of the scale rather than being raised
 * to match — the scale is 1–10 and that is what the chip renders against; this
 * is a floor applied within it, and conflating the two would hide that a
 * judgement is being made here.
 */
const PLAYED_FLOOR = 4;

/**
 * And nobody who *lost* the night reaches the mark that means they won it.
 *
 * `WIN_FLOOR` is 8 because 8 is what taking the night is worth, so a player on
 * a beaten team arriving at 8 by another route erases the one distinction the
 * scale is built around. That is not hypothetical: on a 2.5 / 2.5 / 3.5 night
 * the organiser reported a losing player marked 8, and the arithmetic backs
 * them — a top-tier player with a strong career and a hot run lands on
 * `6 − 0.31 + 0.57 + 0.50 + 0.25 + 0.80 = 7.81`, which rounds to exactly 8.
 *
 * **The interesting part is which terms did it.** The complaint named momentum,
 * and momentum is the smallest of them at +0.25 — capped, and deliberately so
 * (see `MOMENTUM_CAP`). The mark was built by `tier` (+0.80), `close` (+0.57)
 * and `career` (+0.50). Trimming momentum would have fixed this one case by
 * rounding and left the next one untouched, because none of the three larger
 * terms know that the night was lost.
 *
 * So the fix is a ceiling rather than a reweighting: the terms keep their
 * meaning, the full spread below still separates players, and the top of a
 * losing team's range sits one rung under the bottom of a winning team's. What
 * a mark of 8 means is now unambiguous.
 *
 * **The MVP is exempt**, and has to be. The pick is the one genuinely personal
 * signal a night produces (§2.39), a beaten team can absolutely contain the
 * best player on the pitch, and `MVP_CLEAR` below would otherwise be fighting
 * this cap for the same number.
 */
const LOSER_CAP = WIN_FLOOR - 0.5;

/**
 * How far clear of everybody else the player of the night must finish.
 *
 * The pick is the room's own verdict and the only per-night fact the scoreboard
 * cannot supply, so a night where the MVP ties the best mark — or sits below it
 * — has buried the one thing it was asked to say out loud. `UNPICKED_CAP`
 * already reserves the top two rungs, but reserving them is not the same as
 * using them: on a night where the pick was on a beaten team, the cap stopped
 * others reaching 9.5 without ever lifting the pick above the winners at 9.
 *
 * **A ceiling on everybody else, never a lift on the pick.** The first version
 * did both — raise the pick to half a point clear of the best other mark, then
 * hold the others below it — and the lift is the half that had to go, because
 * of what it did once §2.57 let the organiser add markers. Praising somebody
 * else in the note raised *the pick's* mark: a `+` written about the goalkeeper
 * pushed the MVP up to stay ahead of them, so a player's grade moved for
 * something said about a different player. The organiser's words are supposed
 * to reach the person they name and nobody else.
 *
 * So the pick's mark is now whatever the formula and the pick's *own* markers
 * make it, and that number is the ceiling the rest of the night is held under.
 * The gap is guaranteed either way; this is the direction that keeps it from
 * inventing a number nobody earned.
 *
 * The cost is real and worth stating: on a night where the pick grades low, the
 * whole field is compressed under them — a player with several markers can be
 * pulled down to half a point below a pick who had a quiet game by the
 * scoreline. That is the same trade the rule was always making, only now it is
 * paid by the field instead of hidden in the pick's number.
 */
const MVP_CLEAR = 0.5;

/**
 * The only thing on this list that is about a person rather than a team.
 *
 * Trimmed 1.0 → 0.75 on 2026-08-28, together with `WIN_BONUS`, because the
 * constants had stacked up past the point where the night still mattered at the
 * top of the scale. A top-tier player who was picked on a winning team started
 * at `BASE + tier + WIN_BONUS + MVP_BONUS` = **8.55** before the margin was
 * counted at all, so a 10 needed only 1.2 more — an ordinary win. Measured over
 * every mark the club had recorded: three of the four MVP picks came out at 10,
 * one of them on a night their team took 7 of 14 with the runner-up on 5, and
 * **9.5 had never once been awarded**. A rung that never fires is the tell that
 * the scale has a gap rather than a top.
 *
 * **Since §2.46 this is the fallback rather than the rule** — what a pick is
 * worth on a night whose vote was never written down. Every night filed before
 * the sheet existed is a single name with no tally behind it, and that is not a
 * gap to be filled in: the room's margin on some Thursday in March is not
 * recoverable, and guessing at it would be inventing the one fact this formula
 * is least entitled to invent. Nights with a sheet use the two constants below.
 */
const MVP_BONUS = 0.75;

/**
 * Being the pick, once the room has been counted (§2.46).
 *
 * From 2026-09-11 a night can carry the whole vote rather than one name, and
 * the bonus splits along the two different things a vote says. This half is the
 * honour itself: you were the one, however narrowly. It is flat, because being
 * picked 3–2 and being picked 5–0 are equally *being picked*, and it is what
 * `UNPICKED_CAP` still keys off — the top two rungs belong to the pick alone,
 * not to whoever polled well.
 */
const PICK_BONUS = 0.4;

/**
 * And this half is how much of the room actually said your name.
 *
 * `ROOM_W × (your votes ÷ votes cast)`, for everybody on the sheet rather than
 * only the winner. Two things follow from that, both of them the point:
 *
 * **A landslide outmarks a squeaker.** A unanimous pick scores `0.4 + 0.7` =
 * **1.10**; one that shaded a 3–2 scores `0.4 + 0.42` = **0.82**. Under the old
 * flat bonus those were the same night. They are not the same night.
 *
 * **The runner-up stops being nobody — in the payload, and usually not in the
 * number.** Two votes of five is 0.28, and where that lands was measured rather
 * than assumed: on a night won outright it lands nowhere. `WIN_FLOOR` already
 * has the whole winning team pinned at 8, a typical runner-up's raw mark is
 * about 7.6, and the bonus is absorbed by the floor before it can move a rung.
 * It shows on a night that finished level (no outright winner, so the floor is
 * `PLAYED_FLOOR` and there is room), and on a winner already sitting above 8 on
 * their own terms.
 *
 * That is the floor's known cost, stated in `WIN_BONUS` before this existed:
 * marks inside a winning team compress, and only the part above 8 survives.
 * Widening `ROOM_W` would not fix it — the floor eats whatever is under it —
 * and lowering `WIN_FLOOR` is the organiser's call, not a side effect of adding
 * a vote. So the runner-up's real recognition is the tally beside their name
 * (`NightGrades`) and the line written about them, which say "two of five" at a
 * resolution a half-point scale does not have.
 *
 * What the term does guarantee is the ordering: it never moves a runner-up past
 * the pick. `PICK_BONUS` is a step they cannot climb by polling well, so no
 * arrangement of votes can have the second name marking above the first.
 *
 * **Calibrated so the ordinary night is where it was.** The term spans
 * [0.40, 1.10] and `MVP_BONUS` — what a night with no sheet still scores — sits
 * at 0.75, its exact midpoint. A club that never types a tally sees no change
 * at all, and one that does sees marks move up or down from the same middle
 * rather than off a new baseline.
 *
 * Nothing already filed re-scores, because nothing already filed has a sheet.
 */
const ROOM_W = 0.7;

/**
 * Taking the night outright, as a thing in itself rather than as a margin.
 *
 * **This exists to stop {@link WIN_FLOOR} doing the separating.** With the
 * floor alone, a winning team's shared starting point on a typical night was
 * 7.95 — a fraction under the floor — so essentially the whole team landed
 * *on* 8 and the floor was deciding most of their marks. Measured on the night
 * that prompted it: a 5-star earned exactly 8.0 while a 3-star earned 7.0 and
 * was lifted to 8 to meet him. The rating had been widened specifically so it
 * would show, and the floor was flattening it straight back out.
 *
 * A discrete bonus for winning, in the same shape as `MVP_BONUS`, lifts the
 * team's whole starting point clear of the floor instead — so the personal
 * terms spread people out *above* 8 rather than piling them on it, and the
 * floor goes back to being what it was meant to be: a backstop for the one
 * player whose form was bad enough to fall through, not the thing setting the
 * team's marks.
 *
 * Winning is also worth saying as its own fact. `night` measures the *margin*,
 * which is a different claim: taking a night 5–4–3 and taking it 9–2–1 are both
 * winning it, and only one of them is a rout.
 *
 * Trimmed 0.75 → 0.5 on 2026-08-28 alongside `MVP_BONUS` — see the note there.
 * It costs the winning team almost nothing in practice, because `UNPICKED_CAP`
 * already holds them at 9; what it buys is that the margin, rather than a stack
 * of constants, decides which of 9.5 and 10 a picked player gets.
 */
const WIN_BONUS = 0.5;

/**
 * How far behind the winner a team can be and still be carried up by the
 * floor that lifted them (§2.48).
 *
 * **The problem this fixes is one `WIN_FLOOR` creates, and it is backwards.**
 * On 4.5–4–2 the teams finish half a win apart and mark 8 and 6.5. Take the
 * floor away and the same night reads 7 and 6.5 — a half-rung gap for a
 * half-win margin, which is right. The whole 1.5 is the floor lifting the
 * winner and nothing lifting the side that nearly beat them.
 *
 * Worse, it is largest exactly where it is least deserved. The floor only
 * fires when the win was *narrow* — a team that ran away with the night clears
 * 8 on the margin alone and never touches it. So measured across real
 * scorelines, a night decided by half a win opened a 2.0 gap while a 9–2–1
 * rout opened 4.5: 44% of the punishment for 7% of the margin.
 *
 * **So the lift is shared rather than given to one team.** Whatever the floor
 * had to add to get the winner to 8 is offered to the teams behind them,
 * decaying with how far back they finished — full share at the winner's
 * shoulder, nothing at `CLOSE_SPAN × fairShare` behind. At 1 that is one whole
 * share of the night's matches, which is the same unit `night` is measured in
 * and reads as the natural meaning of "out of it": on a 10.5-match night a
 * team 3.5 wins off the pace gets none of it, and 4.5–4–2 lifts the runner-up
 * to 7 while leaving the beaten third team on 5.
 *
 * Three things keep it honest:
 *
 * **It is self-limiting.** A convincing winner clears 8 unaided, so the lift is
 * zero and the night grades exactly as it always did. This can only act where
 * the floor was already distorting the sheet — 7–3–2 and 9–2–1 are untouched.
 *
 * **Winning outright still wins.** As the gap closes the runner-up approaches
 * 7.5 against the winner's 8: the `WIN_BONUS` survives as a permanent half-rung
 * that no amount of closeness can erode. Taking the night is always worth more
 * than nearly taking it.
 *
 * **It adds rather than floors.** The obvious implementation is a second floor
 * under the runner-up, and it was rejected: a floor *flattens*, and all five on
 * that team would read one number regardless of their own form and rating —
 * the documented cost of `WIN_FLOOR` (see `WIN_BONUS`), doubled. Adding to the
 * raw mark leaves the personal terms spreading people out as they always did.
 */
const CLOSE_SPAN = 1;

// Both historical terms are shrunk toward the club mean, the same move
// `duos.ts` and `marketValue.ts` make: a player three nights into their career
// should sit near the middle rather than at whichever extreme those three
// nights happened to produce.
const SHRINK_K = 6;

// Raw spread measured on the invented club: career sits within about ±0.65
// wins/night of the club mean, momentum within about ±1.1 of a player's own
// baseline. The weights below turn those into grade points, and the caps stop
// one freak run from swamping the night itself.
// CAREER_W trimmed 0.75 -> 0.6 on 2026-08-28, alongside the momentum trim
// below and for the same reason: on a heavily beaten team `night` has already
// taken the mark down to about 4.7, and a player's record and form then pile on
// top of a fact those two largely *restate* — somebody on a losing team is
// usually somebody whose recent record is losing. Two beaten teammates were
// coming out below the floor and being flattened together by it.
const CAREER_W = 0.6;
const CAREER_CAP = 0.5;
// Trimmed 0.7 → 0.55 → 0.25 across 2026-08-28, so the organiser's rating clearly
// outranks it (see TIER_BUMP). Momentum is the noisiest real signal here — it
// reads five nights, which on a young club is often three, and one evening moves
// it a long way.
//
// The final trim came from a measured case rather than a preference. On a team
// that took 2 of 12, `night` alone puts everybody at about 4.7; a cold run then
// pushed a player under `PLAYED_FLOOR`, where the floor flattened them together
// with a teammate the organiser rates lower. **Form was being counted twice** —
// a beaten team is usually made of players whose recent results are losses, so
// `night` and `momentum` were both charging for the same fact.
//
// At ±0.25 the whole hot-to-cold swing is 0.5, which is exactly one rung on a
// half-point scale: enough to be visible and to be argued about, not enough to
// decide a mark on its own.
const MOMENTUM_W = 0.65;
const MOMENTUM_CAP = 0.25;

/** How many nights back "recent form" looks, and the fewest it will answer on. */
export const RECENT_NIGHTS = 5;
export const MIN_RECENT = 3;

/** How far from their own baseline a run has to be before it is worth a word. */
const TREND_EDGE = 0.4;

export type Trend = 'hot' | 'cold' | 'steady';

/**
 * The organiser's rating, coarsened to a third of the club and turned into a
 * permanent shade on every mark (see the file header for why this term exists
 * and what it costs).
 *
 * **Widened from ±0.25 to ±0.6 and then to ±0.8 on 2026-08-28**, which the file
 * header said must not happen without the organiser asking for it in as many
 * words. They asked, and the diagnosis backed them: at ±0.25 this was the
 * *weakest* term in the formula, and the jitter — noise carrying no information
 * whatsoever — had a wider span than it did. Measured on the real
 * night that prompted the complaint: a 5-star and a 2.5-star on the same shirt
 * came out on the identical mark, because the 0.5 the rating opened between
 * them was cancelled almost exactly by jitter and career. The organiser's own
 * judgement was being outvoted by a hash function.
 *
 * **Raised again to ±0.8 the same day**, on the organiser's follow-up: they
 * want the rating to be more decisive than form. At a span of 1.6 it now
 * outranks `momentum` (1.1 after its own trim), `career` (1.0) and the MVP
 * bonus — making it the second-strongest term in the formula, behind only the
 * night's result. That is a deliberate statement about what a mark is for in
 * this club: the organiser's read of a player is meant to show through a single
 * bad Thursday, and only the team's result outweighs it.
 *
 * What it still cannot do is rescue a bad night on its own. `night` spans 5.0
 * plus a `WIN_BONUS`, so a top-tier player on a beaten team stays below a
 * bottom-tier player on the winning one — which is the ordering that keeps
 * these marks about football rather than about the organiser's opinion.
 *
 * **The privacy cost, which is real and got worse.** The file header explains
 * that averaging a player's residual over many nights recovers their tier.
 * A wider bump makes that recovery both faster and sharper — fewer nights are
 * needed and the answer is less ambiguous. It stays a three-way bucket rather
 * than the raw 1–5 precisely to bound what is recoverable to "which third",
 * which is why this was widened rather than made continuous.
 */
const TIER_BUMP: Record<ReturnType<typeof ratingTier>, number> = {
  bottom: -0.8,
  middle: 0,
  top: 0.8,
};

// **There is deliberately no jitter term any more (removed 2026-08-28).**
//
// There was: a stable per-player-per-night hash worth ±0.35, later ±0.2. Its
// stated job was to stop a single night's mark being a bare readout of which
// tier it came from. Three things retired it, in order of how much they matter:
//
//  1. **It never did that job.** The term it was hiding is recovered by
//     *averaging* a player's residual (see the file header), and a zero-mean
//     hash is exactly what averaging removes. It obscured one night at a time
//     against an attack that reads many.
//  2. **It was cancelling the signal it was meant to shade.** Measured on a
//     real night while `tier` was ±0.25: a 5-star and a 2.5-star on the same
//     shirt came out on the identical mark, the rating between them wiped out
//     by two hash values pointing opposite ways. Noise was outvoting the
//     organiser's own judgement.
//  3. **Marks round to the nearest half.** So its whole remaining effect was to
//     flip players sitting near a rounding boundary, arbitrarily. That is not
//     variety, it is a coin toss on somebody's mark, and it is unanswerable
//     when they ask why they got a 6 and their teammate a 6.5.
//
// What replaces it is nothing, and that is the point: **every difference
// between two players' marks now traces back to a fact about them.** Two
// teammates the app genuinely knows nothing to separate — two debutants on the
// same shirt, say — read the same number, which is the honest answer rather
// than a manufactured one.

export interface GradeParts {
  night: number;
  /**
   * The share of the winner's floor this team was carried up by, for finishing
   * close to them (§2.48, and see CLOSE_SPAN). Always 0 for the winner, who
   * gets the floor itself, and 0 on any night the floor did not have to fire.
   *
   * Its own term rather than folded into `night` because it answers a different
   * question — `night` is what this team did, this is what the team *above*
   * them needed the floor for — and a mark that moved for this reason should
   * say so when somebody asks why.
   */
  close: number;
  mvp: number;
  career: number;
  momentum: number;
  /** The organiser's rating, coarsened — see TIER_BUMP and the file header. */
  tier: number;
  /**
   * What the organiser marked in the night's own note (§2.57): half a point per
   * `+`, netted against any `−`, for every event that named this player.
   *
   * Absent rather than 0 on the ordinary night, because unlike every other term
   * here this one is not always in play — a note with no markers in it should
   * leave no trace in the breakdown at all, rather than a row of zeroes
   * inviting the reader to wonder what they missed.
   *
   * It sits outside the sum that produces the raw mark, and is added after the
   * floors and caps, so it is the one term that can carry a player past a
   * ceiling the scoreline set. See `nightGrades`.
   */
  events?: number;
}

/**
 * Everything the sentence-writer is allowed to know about this player.
 *
 * Counts only, and every one of them is either tonight's result or something
 * that happened *before* tonight — never a rating, and never a verdict. The
 * model's job is to phrase these, not to add to them.
 */
export interface GradeContext {
  shirt: TeamColor;
  teamWins: number;
  place: Place;
  /** Whether their team took the night outright — level at the top is nobody. */
  wonNight: boolean;
  isMvp: boolean;
  /**
   * Votes this player got, and how many were cast in all — or null on a night
   * with no sheet, which is every night before §2.46 and any night the
   * organiser did not tally.
   *
   * Null rather than 0 on purpose: "nobody voted for you" and "nobody counted"
   * are different sentences, and the one thing worse than a reporter ignoring
   * the vote is one inventing a shut-out from its absence.
   */
  votes: number | null;
  votesCast: number | null;
  /** Nights on record *before* tonight. 0 means this was a debut. */
  nightsBefore: number;
  /** Their own wins per night coming in, or null on a debut. */
  baseline: number | null;
  /** Mean wins per night over the last few, or null below MIN_RECENT. */
  recent: number | null;
  trend: Trend | null;
  /** Winning nights in a row coming into tonight. */
  runBefore: number;
  /** Nights since their team last took one, coming in. */
  droughtBefore: number;
  /**
   * How many of *their own* nights ago they were last picked player of the
   * night — 1 being the last time they played — or null if never.
   *
   * **Here because the sentence-writer was being cruel with a straight face.**
   * A player picked MVP a fortnight earlier had two bad nights after it, which
   * is enough to set `trend: 'cold'`, and the line called it a free-fall. Every
   * word of that was true of the last two nights and false about the player,
   * and the model had no way to know: the payload said "declining form" and
   * carried nothing at all about the pick. The MVP is the one genuinely
   * personal thing a night produces (§2.39), and it was being thrown away the
   * moment the night after it went badly.
   *
   * Counted in nights *they played* rather than in calendar weeks or in
   * fixtures, so somebody who missed a month does not have their pick aged out
   * by nights they were not at.
   */
  lastMvpAgo: number | null;
}

export interface Grade {
  id: string;
  name: string;
  /** 1–10, to the nearest half. */
  grade: number;
  parts: GradeParts;
  context: GradeContext;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** To the nearest half — a mark out of ten is not a measurement to two places. */
const round = (n: number) => Math.round(n * 2) / 2;

/**
 * Grades for one filed night, or `null` when the night has no result.
 *
 * Every historical term is read from the nights *before* this one. Tonight is
 * already the `night` term; letting it into the baseline as well would mean a
 * good night quietly raising the bar it is being measured against.
 */
export function nightGrades(history: FixtureRecord[], fixtureId: string): Grade[] | null {
  const byDate = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const fx = byDate.find((f) => f.id === fixtureId);
  if (!fx || !hasResult(fx.wins)) return null;

  const past = byDate.filter((f) => f.date < fx.date || (f.date === fx.date && f.id !== fx.id));

  // The club's own wins-per-night, over every player-night before tonight.
  let totalWins = 0;
  let totalNights = 0;
  const everyone = new Set<string>();
  for (const f of past) for (const c of ['black', 'white', 'blue'] as TeamColor[]) for (const id of f.teams[c]) everyone.add(id);
  for (const id of everyone) {
    for (const n of profileNights(past, id)) {
      totalWins += n.wins;
      totalNights++;
    }
  }
  const clubMean = totalNights > 0 ? totalWins / totalNights : 0;

  // The night's own size, so a short evening is not graded as a bad one.
  const matches = (['black', 'white', 'blue'] as TeamColor[]).reduce((s, c) => s + (fx.wins[c] ?? 0), 0);
  const fairShare = matches / 3;

  // The room's vote, if it was written down (§2.46). Zero means no sheet —
  // either the night predates the feature or nobody tallied it — and the pick
  // falls back to the flat `MVP_BONUS` it has always been worth.
  const votesCast = totalVotes(fx.mvpVotes);
  const tallied = votesCast > 0;

  // Relative to the night's own average, then capped. Lifted out of the team
  // loop because the winner's figure is needed before any team is graded — see
  // `floorLift` below.
  const nightTerm = (wins: number) =>
    clamp(fairShare > 0 ? NIGHT_W * ((wins - fairShare) / fairShare) : 0, -NIGHT_CAP, NIGHT_CAP);

  // How much work `WIN_FLOOR` has to do to get tonight's winner to 8, measured
  // on the shared part of their mark only — this is a fact about the scoreline,
  // not about any one player, so their career and rating stay out of it.
  //
  // Zero when the night was shared at the top (nobody is floored, so there is
  // nothing to share) or when the margin already cleared 8 on its own. See
  // CLOSE_SPAN for the whole argument.
  const topWins = Math.max(...(['black', 'white', 'blue'] as TeamColor[]).map((c) => fx.wins[c] ?? 0));
  const soleWinner =
    (['black', 'white', 'blue'] as TeamColor[]).filter((c) => (fx.wins[c] ?? 0) === topWins).length === 1;
  const floorLift = soleWinner
    ? Math.max(0, WIN_FLOOR - (BASE + nightTerm(topWins) + WIN_BONUS))
    : 0;

  // What the organiser wrote on the night, read once (§2.57). Empty on every
  // note that carries no markers, which is most of them.
  const marks = eventMarks(fx);

  const out: Grade[] = [];
  for (const c of ['black', 'white', 'blue'] as TeamColor[]) {
    const teamWins = fx.wins[c] ?? 0;
    const place = placeOf(fx.wins, c);
    const night = nightTerm(teamWins);

    for (const id of fx.teams[c]) {
      const before = profileNights(past, id);
      const nightsBefore = before.length;

      let career = 0;
      let momentum = 0;
      let baseline: number | null = null;
      let recent: number | null = null;
      let trend: Trend | null = null;

      if (nightsBefore > 0) {
        const sum = before.reduce((s, n) => s + n.wins, 0);
        const shrunk = (sum + SHRINK_K * clubMean) / (nightsBefore + SHRINK_K);
        baseline = sum / nightsBefore;
        career = clamp(CAREER_W * (shrunk - clubMean), -CAREER_CAP, CAREER_CAP);

        if (nightsBefore >= MIN_RECENT) {
          const window = before.slice(-RECENT_NIGHTS);
          recent = window.reduce((s, n) => s + n.wins, 0) / window.length;
          const raw = recent - shrunk;
          momentum = clamp(MOMENTUM_W * raw, -MOMENTUM_CAP, MOMENTUM_CAP);
          trend = raw > TREND_EDGE ? 'hot' : raw < -TREND_EDGE ? 'cold' : 'steady';
        }
      }

      const isMvp = fx.mvpId === id;
      const votes = tallied ? (fx.mvpVotes?.[id] ?? 0) : null;
      // The rating as it stood *on that night*, off the fixture's own snapshot
      // rather than off today's roster — the same rule every other term here
      // follows. A player the organiser has since re-rated keeps the marks
      // their old nights were actually given, instead of having a season
      // silently re-scored underneath them.
      const rating = fx.players.find((p) => p.id === id)?.rating ?? 3;
      const tier = TIER_BUMP[ratingTier(rating)];
      // Outright winners only — see WIN_BONUS, WIN_FLOOR and §2.6.
      const wonNight = place === 1 && !hasTie(fx, teamWins);
      const parts: GradeParts = {
        night: night + (wonNight ? WIN_BONUS : 0),
        // A share of whatever the floor gave the winner, decaying with how far
        // back this team finished (§2.48). The winner is excluded because they
        // get the floor itself — adding it here as well would put their mark
        // above 8 on the strength of a floor that exists to stop it dropping
        // below it.
        close:
          wonNight || floorLift === 0 || fairShare <= 0
            ? 0
            : floorLift * Math.max(0, 1 - (topWins - teamWins) / (CLOSE_SPAN * fairShare)),
        // The pick, plus however much of the room said so — see PICK_BONUS and
        // ROOM_W. Untallied nights keep the flat bonus, so a mark filed before
        // the sheet existed reads today exactly as it did then.
        mvp: tallied
          ? (isMvp ? PICK_BONUS : 0) + ROOM_W * ((votes ?? 0) / votesCast)
          : isMvp
            ? MVP_BONUS
            : 0,
        career,
        momentum,
        tier,
      };
      // Rounded before the floor rather than after, so the floor is exactly the
      // number it says it is: flooring a rounded 7.5 cannot leave anybody below
      // the mark, where rounding a floored 7.9 could.
      const raw = round(
        BASE + parts.night + parts.close + parts.mvp + parts.career + parts.momentum + parts.tier,
      );
      // Floor first, then the ceiling. `UNPICKED_CAP` is inclusive — 9 is an
      // ordinary mark anybody can earn, and only the two rungs above it are
      // reserved for the pick.
      const floored = Math.max(raw, wonNight ? WIN_FLOOR : PLAYED_FLOOR);
      // Two ceilings, and the lower one only applies to a beaten team: a mark
      // of 8 means the night was won, so nobody who lost it arrives there by
      // another route (see LOSER_CAP). The pick is exempt from both.
      const capped = isMvp
        ? floored
        : Math.min(floored, UNPICKED_CAP, wonNight ? UNPICKED_CAP : LOSER_CAP);
      const grade = clamp(capped, GRADE_MIN, GRADE_MAX);

      // Coming in: a live winning run, or nights since their team last took one.
      let runBefore = 0;
      for (let i = before.length - 1; i >= 0 && before[i].won; i--) runBefore++;
      let droughtBefore = 0;
      for (let i = before.length - 1; i >= 0 && before[i].won === false; i--) droughtBefore++;

      // The most recent night of their own that they were picked on, counted
      // back from tonight — see `lastMvpAgo`.
      let lastMvpAgo: number | null = null;
      for (let i = before.length - 1; i >= 0; i--) {
        if (byDate.find((f) => f.id === before[i].fixtureId)?.mvpId === id) {
          lastMvpAgo = before.length - i;
          break;
        }
      }

      out.push({
        id,
        name: fx.players.find((p) => p.id === id)?.name ?? '?',
        grade,
        parts,
        context: {
          shirt: c,
          teamWins,
          place,
          wonNight,
          isMvp,
          votes,
          votesCast: tallied ? votesCast : null,
          nightsBefore,
          baseline,
          recent,
          trend,
          runBefore,
          droughtBefore,
          lastMvpAgo,
        },
      });
    }
  }

  // What the organiser said they saw (§2.57). Applied *after* every floor and
  // cap, which is the whole point of it: the night's own ceilings are built
  // from the scoreline, and this is the one input that knows something the
  // scoreline does not. A player who scored four on a beaten team has to be
  // able to pass `LOSER_CAP`, or the feature does not do the job it was asked
  // for.
  for (const g of out) {
    const mark = marks.get(g.id) ?? 0;
    if (mark === 0) continue;
    g.parts.events = mark;
    g.grade = clamp(g.grade + mark, GRADE_MIN, GRADE_MAX);
  }

  // The pick's own mark is the field's ceiling (see MVP_CLEAR). Last, because
  // it is the only rule here that reads other players' finished marks rather
  // than one player's own inputs.
  const pick = out.find((g) => g.context.isMvp);
  if (pick) {
    const ceiling = pick.grade - MVP_CLEAR;
    for (const g of out) if (!g.context.isMvp) g.grade = Math.min(g.grade, ceiling);
  }

  return out.sort((a, b) => b.grade - a.grade || a.name.localeCompare(b.name, 'he'));
}

// Level at the top means nobody took the night (§2.6), so nobody on it gets to
// be told they won one.
const hasTie = (fx: FixtureRecord, teamWins: number): boolean =>
  (['black', 'white', 'blue'] as TeamColor[]).filter((c) => (fx.wins[c] ?? 0) === teamWins).length > 1;

/** Exported for the calibration pass and the tests; never shown to a player. */
export const gradeConstants = {
  BASE,
  NIGHT_W,
  NIGHT_CAP,
  MVP_BONUS,
  PICK_BONUS,
  ROOM_W,
  CLOSE_SPAN,
  WIN_BONUS,
  UNPICKED_CAP,
  WIN_FLOOR,
  PLAYED_FLOOR,
  LOSER_CAP,
  MVP_CLEAR,
  CAREER_W,
  CAREER_CAP,
  MOMENTUM_W,
  MOMENTUM_CAP,
  SHRINK_K,
  RECENT_NIGHTS,
  MIN_RECENT,
  TIER_BUMP,
};
