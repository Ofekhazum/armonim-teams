// The badge shown for a player — derived from their position on the attacking
// spectrum, never stored. See roleBadge() below.
export type RoleBadge = 'defensive' | 'balanced' | 'attacking' | 'gk';

// Where a player sits on the defence↔attack spectrum, in steps of 5:
//   0 = fully defensive · 50 = even split · 100 = fully attacking
export const ATTACK_STEP = 5;
export const ATTACK_DEFAULT = 50;

// A player leaning this far (or further) to one side wears that side's badge;
// anything less reads as balanced.
const BADGE_LEAN = 70;

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
}

export interface AppState {
  players: Player[];
  session: Session;
}
