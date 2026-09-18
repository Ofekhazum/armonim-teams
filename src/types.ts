import { t } from './i18n';

// The badge shown for a player — derived from their position on the attacking
// spectrum, never stored. See roleBadge() below.
export type RoleBadge = 'defensive' | 'balanced' | 'attacking' | 'gk';

// Where a player sits on the defence↔attack spectrum, in steps of 5:
//   0 = fully defensive · 50 = even split · 100 = fully attacking
export const ATTACK_STEP = 5;
export const ATTACK_DEFAULT = 50;

// A player leaning this far (or further) to one side wears that side's badge;
// anything less reads as balanced.
const BADGE_LEAN = 75;

export interface Player {
  id: string;
  name: string;
  aliases?: string[]; // other names people call this player, used to match imported lists
  rating: number; // 1 (worst) – 5 (best)
  ratingUnknown?: boolean; // guests we know nothing about
  isGk?: boolean; // permanent goalkeeper — always GK-capable on match day
  attack: number; // 0–100 along the defence↔attack spectrum (see ATTACK_STEP)
  isGuest?: boolean;
  invitedBy?: string; // player id — guests stick with their inviter
  chemistry: string[]; // ids of players they play well with
  avoid?: string[]; // ids of players they clash with — keep on different teams
  /**
   * Keep this player off a team that already has somebody in goal.
   *
   * Going in goal is how a tired player gets a rest without sitting out, and a
   * team that already has a keeper has nowhere to offer them — the gloves are
   * taken for the night. So this is a request for the *option*, not a request
   * to keep goal: it buys a team where stepping back is still available.
   *
   * **A preference, not a rule**, because it is not always satisfiable: three
   * keepers across three teams leaves nowhere keeper-free to put anybody, and
   * the answer then is the honest one rather than a redrawn night. Below three
   * it should win — see `W.noGkTeammate` for the weight and what it beats.
   *
   * One-sided, unlike chemistry and avoid: it is a fact about this player and
   * names nobody, so there is no mirror link to keep in step.
   */
  noGkTeammate?: boolean;
  // shirt number, purely cosmetic — shown only on the edit form and printed
  // onto the shirt-image export (see shirtImage.ts). Optional; duplicates
  // across players are fine, nothing depends on it being unique.
  number?: number;
}

export function badgeForAttack(attack: number): Exclude<RoleBadge, 'gk'> {
  if (attack >= BADGE_LEAN) return 'attacking';
  if (attack <= 100 - BADGE_LEAN) return 'defensive';
  return 'balanced';
}

export function roleBadge(p: Player): RoleBadge {
  return p.isGk ? 'gk' : badgeForAttack(p.attack);
}

// Human label for a spot on the spectrum, e.g. "70% defensive" / "even split".
export function attackLabel(attack: number): string {
  if (attack === ATTACK_DEFAULT) return t('roster.attack.even');
  return attack > ATTACK_DEFAULT
    ? t('roster.attack.attacking', { n: attack })
    : t('roster.attack.defensive', { n: 100 - attack });
}

// --- Legacy migration ------------------------------------------------------
// Rosters published before the spectrum stored a categorical `playstyle`.
// Old defensive/attacking players start pinned at their extreme, mixed in the
// middle — the intent is that they get tuned by hand afterwards.
type LegacyPlaystyle = 'defensive' | 'mixed' | 'attacking' | 'gk';

export function migratePlayer(p: Player & { playstyle?: LegacyPlaystyle }): Player {
  if (typeof p.attack === 'number' && p.playstyle === undefined) return p;
  const { playstyle, ...rest } = p;
  return {
    ...rest,
    isGk: p.isGk ?? playstyle === 'gk',
    attack:
      typeof p.attack === 'number'
        ? p.attack
        : playstyle === 'defensive'
          ? 0
          : playstyle === 'attacking'
            ? 100
            : ATTACK_DEFAULT,
  };
}

export type TeamColor = 'black' | 'white' | 'blue';

export type Teams = Record<TeamColor, string[]>;

export interface Session {
  availableIds: string[];
  guests: Player[];
  gkIds: string[]; // who can play goalkeeper *today*
  teams: Teams | null;
  teamAlts: Teams[]; // balanced variations generated alongside `teams`, for re-roll
  altIndex: number; // which variation is currently shown
  // true once "Start fixture" is clicked: locks the teams in and switches from
  // the editable teams board to the read-only fixture page (see FixturePage.tsx).
  // Reversible — going back just flips this off, teams/wins are untouched.
  fixtureStarted: boolean;
  wins: DraftTeamWins; // tonight's win tally as entered, before it's filed
  // Matches recorded as they finish. When this has anything in it, it is the
  // source of truth for the night and `wins` is derived from it; an empty log
  // leaves the old end-of-night tally in charge, so nights run either way.
  matchLog: MatchLogEntry[];
  // No mvpId here. The pick is made after the night, on the History tab, and
  // so belongs to the filed record rather than to the session — see
  // FixtureRecord.mvpId.
  savedFixtureId: string | null; // set once tonight is saved, so re-saving updates
  // The match clock, lifted out of the component that draws it so the
  // organiser's clock can be published to everyone watching (§2.14) and so a
  // page refresh mid-match doesn't reset it.
  clock: ClockState;
  // epoch ms of the "Start fixture" press that made this night live, or null
  // when nothing is live. Doubles as the live fixture's stable identity.
  liveStartedAt: number | null;
}

// --- Results & history -----------------------------------------------------

// How many matches each team won over the night. Half-steps are real: the
// house rule is that taking a shootout is worth half a win, so "3.5" is an
// ordinary entry, not a rounding error.
//
// Deliberately the whole result: the organiser tallies wins per team at the
// end of the night rather than logging each match as it happens. That costs
// some analytical power — there is no head-to-head record, and no count of how
// much football it took to collect those wins — but it's what actually gets
// written down, and a model fed real numbers beats one fed nothing.
export type TeamWins = Record<TeamColor, number>;

// One match, written down when it finishes (§2.18). The house rules guarantee
// a winner — level at full time goes to golden goal, still level goes to
// penalties — so there is no draw to represent, only *how* it was won.
export interface MatchLogEntry {
  a: TeamColor;
  b: TeamColor;
  winner: TeamColor;
  // taking it on penalties is worth half a win, which is the rule the tally
  // already used; logging just stops it being remembered wrong an hour later
  viaPenalties: boolean;
}

// The same thing while it's still being typed in, before the night is filed.
export type DraftTeamWins = Record<TeamColor, number | null>;

// Nothing entered yet. Lived in ResultsPanel until that panel was removed from
// the fixture page — a session still starts with an empty tally, whether or not
// there is anywhere on screen to type one in.
export const emptyWins = (): DraftTeamWins => ({ black: null, white: null, blue: null });

// Who played, captured at the time. Guests are one-off and renames happen, so
// a fixture keeps its own copy of names/ratings rather than pointing at the
// live roster and going stale.
// How much room one event gets. A sentence or two of "what happened that the
// scoreboard missed" — the point of the note has never been to compete with
// the report, only to hand it the thing nobody could count.
//
// **Per event, not per note, and that is the whole fix.** This used to be one
// number for the entire note, from when the note was one free-text box. Once
// §2.58 made it a list the shared budget started behaving badly: four events
// split 280 characters between them, so a long first event silently shortened
// the fourth, and the box stopped accepting letters mid-word for a reason
// nothing on screen could explain. A budget you can spend somewhere else is
// not a limit an organiser can plan around.
export const EVENT_MAX = 220;

// How many events one night may carry. Six is past the point where the report
// can still say something about each of them — the Worker's word budget grows
// by 40 words an event (§2.24), so this is already a 500-word write-up — and a
// seventh is a sign the note is being used as a match log.
//
// A cap on the *button*, like the stepper's: a note that already holds more,
// however it got there, is read back whole rather than truncated.
export const EVENTS_MAX = 6;

// What the stored string may come to, delimiters and markers included — the
// structural consequence of the two caps above rather than a budget of its
// own. It exists because it is the number the Worker validates and the number
// a paste is cut against.
//
// **Deliberately loose rather than exactly the sum.** A full note serialises
// to `EVENTS_MAX * (EVENT_MAX + 2)` plus the spaces between, and sizing this to
// that would make the two constraints bind at the same instant — so the last
// character of the last event would be refused by the *total*, which is the
// one with no counter beside it. The slack is what keeps the limit an
// organiser actually meets the same one the screen is explaining.
export const NOTE_MAX = EVENTS_MAX * (EVENT_MAX + 2) + 100;

// The most votes one player can be given on a night. A five-a-side club votes
// with the hands in the room, so this is generous by an order of magnitude —
// it is here to bound a typo and the Worker's validator, not to express a rule.
export const VOTES_MAX = 99;

export interface FixturePlayer {
  id: string;
  name: string;
  rating: number;
}

export interface FixtureRecord {
  id: string;
  date: string; // ISO 'YYYY-MM-DD', absolute so it reads correctly forever
  teams: Teams;
  players: FixturePlayer[];
  wins: TeamWins;
  // Present on nights that were logged match by match. Optional because every
  // night before this feature existed was only ever a tally, and those records
  // are not going to be invented after the fact.
  matchLog?: MatchLogEntry[];
  // Who was in goal that night — the same list the balancer was handed when it
  // built these teams (`Session.gkIds`), stored so the post-mortem (§2.54) can
  // reconstruct the sheet *exactly as scored* rather than approximately.
  //
  // It matters more than it looks: `teamStats` leaves an outfield player who is
  // keeping goal out of the team's rating average entirely, so a night with a
  // stand-in keeper has a paper balance that cannot be recovered from the
  // ratings alone. Without this the tool would quietly grade the balancer
  // against a sheet it never saw.
  //
  // Optional, and absent on every night filed before it was stored — those
  // nights fall back to a plain average, and the post-mortem says so rather
  // than pretending the reconstruction is exact.
  gkIds?: string[];
  // The organiser's pick for the night's standout player — optional, and
  // unlike everything else here, a subjective call rather than something
  // derived from the win tally. Added from the History tab once the night is
  // over, which is the only point at which the question can be answered. Any
  // id from `players` (guests included); see src/mvp.ts for how it's tallied
  // into a count.
  mvpId?: string;
  // How many votes each player got, keyed by id — the room's tally rather than
  // one name (§2.46). `mvpId` stays the pick and is what every other feature in
  // the app counts; this is the margin behind it, and only the marks out of ten
  // read it.
  //
  // Optional, and absent on every night filed before the sheet existed. Those
  // nights are a single pick and always will be: `grades.ts` keeps the old flat
  // bonus for them rather than inventing a tally they never had.
  //
  // Only players with at least one vote appear. A zero is the same fact as not
  // being listed, and storing it would make an empty sheet look like a filed one.
  mvpVotes?: Record<string, number>;
  // Whatever the organiser thought was worth remembering, typed as the night
  // was filed — "Tom put it over the fence five times". The one thing on a
  // fixture that is neither counted nor derived, and the only route by which
  // something the app cannot see gets into the night's report (§2.24).
  //
  // Kept on the record rather than alongside it because a report is usually
  // written days later, off a page that reads the night back: a note that
  // lived in the session would be gone by then.
  note?: string;
}

export interface AppState {
  players: Player[];
  session: Session;
  history: FixtureRecord[]; // past fixtures, oldest first
}

// --- The fixture currently being played, as everyone else sees it -----------
// Published by the organiser when they start a fixture and cleared when they
// end it, so the rest of the group sees tonight's teams and the clock without
// anyone having to send a link (§2.14). One key on the Worker, so exactly one
// fixture can be live at a time.

// Deliberately far less than a `Player`. This is the one payload in the app
// that is read by people who are not the organiser, and a name and which
// shirt they're wearing is the whole point of it — rating, attack spectrum,
// chemistry and keep-apart lists are the organiser's working notes and none
// of anyone else's business (same line the public roster read draws).
export interface LivePlayer {
  id: string;
  name: string;
  isGk?: boolean; // wearing the gloves tonight, not the permanent flag
  isGuest?: boolean;
}

// Everything that counts what tonight means — milestones.ts, radar.ts, duos.ts
// — reads exactly three fields, and none of them is a rating. Typing them this
// way rather than `Player[]` is what lets a viewer's phone run the same
// arithmetic from a `LivePlayer`: the facts about who has turned up are the
// group's, and the roster's private opinions never had to travel to produce
// them (§2.14).
export interface TonightPlayer {
  id: string;
  name: string;
  isGuest?: boolean;
}

export type ClockPeriod = 'regulation' | 'added';

// The house rules for a match, in milliseconds (see DESIGN.md §2.8). They live
// here rather than in MatchClock.tsx because the clock's *state* is now part
// of the session — persisted, and published to everyone watching — so the
// modules that build a fresh session need them without importing a component.
export const REGULATION_MS = 8 * 60 * 1000;
export const ADDED_MS = 2 * 60 * 1000;

// For the copy that has to say the number out loud.
export const REGULATION_MIN = REGULATION_MS / 60_000;
export const ADDED_MIN = ADDED_MS / 60_000;

// The match clock as a *fact about time*, not a ticking counter: `endsAt` is
// an absolute epoch ms, so a viewer who receives this ten seconds late still
// renders the correct number rather than one that's ten seconds behind. When
// paused or not yet started, `endsAt` is null and `remaining` holds the value.
export interface ClockState {
  period: ClockPeriod;
  endsAt: number | null;
  remaining: number;
  ended: boolean;
}

// Half a minute back for a stoppage the clock knew nothing about. Pure and
// exported so it can be tested without a component: which field is
// authoritative depends on whether the clock is moving, and getting that wrong
// is the difference between adding time and silently discarding it.
//
// A running clock is defined by `endsAt`, so the end moves. Anything else —
// paused, not yet kicked off, or already run out — is defined by `remaining`,
// so that grows. A clock that had ended un-ends, but stays stopped: giving the
// time back is one decision and restarting is another, and merging them would
// have the match resume in somebody's pocket.
export function withAddedTime(clock: ClockState, ms: number, now: number): ClockState {
  const running = clock.endsAt !== null && !clock.ended && clock.endsAt > now;
  if (running) return { ...clock, endsAt: clock.endsAt! + ms };
  const left = clock.endsAt !== null ? Math.max(0, clock.endsAt - now) : Math.max(0, clock.remaining);
  return { period: clock.period, endsAt: null, remaining: left + ms, ended: false };
}

// A live fixture is identified by the moment it kicked off, which every device
// running the night already knows. Derived rather than random so the organiser
// can name tonight before a poll has told them what it is called.
export const liveFixtureId = (startedAt: number): string => `live-${startedAt}`;

export const initialClock = (): ClockState => ({
  period: 'regulation',
  endsAt: null,
  remaining: REGULATION_MS,
  ended: false,
});

export interface LiveFixture {
  id: string;
  startedAt: number; // epoch ms, for "kicked off 42 minutes ago"
  players: LivePlayer[];
  teams: Teams;
  gkIds: string[];
  clock: ClockState;
  // The night's results as they happen, shared and writable by anyone at the
  // pitch for the same reason the clock is: whoever is nearest the phone when a
  // match ends is who writes it down. Optional because a fixture published by
  // an older build won't carry one — read it as `?? []`.
  matchLog?: MatchLogEntry[];
}
