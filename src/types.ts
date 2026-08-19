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
  if (attack === ATTACK_DEFAULT) return 'even split';
  return attack > ATTACK_DEFAULT
    ? `${attack}% attacking`
    : `${100 - attack}% defensive`;
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
  mvpId: string | null; // tonight's MVP pick, before it's filed — see FixtureRecord.mvpId
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

// The same thing while it's still being typed in, before the night is filed.
export type DraftTeamWins = Record<TeamColor, number | null>;

// Who played, captured at the time. Guests are one-off and renames happen, so
// a fixture keeps its own copy of names/ratings rather than pointing at the
// live roster and going stale.
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
  // The organiser's pick for tonight's standout player — optional, and
  // unlike everything else here, a subjective call rather than something
  // derived from the win tally. Any id from `players` (guests included);
  // see src/mvp.ts for how it's tallied into a count.
  mvpId?: string;
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

export type ClockPeriod = 'regulation' | 'added';

// The house rules for a match, in milliseconds (see DESIGN.md §2.8). They live
// here rather than in MatchClock.tsx because the clock's *state* is now part
// of the session — persisted, and published to everyone watching — so the
// modules that build a fresh session need them without importing a component.
export const REGULATION_MS = 8 * 60 * 1000;
export const ADDED_MS = 2 * 60 * 1000;

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
}
