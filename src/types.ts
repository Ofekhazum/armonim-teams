// 'gk' = permanent goalkeeper — always counted as GK-capable on match day
export type Playstyle = 'defensive' | 'mixed' | 'attacking' | 'gk';

export interface Player {
  id: string;
  name: string;
  rating: number; // 1 (worst) – 5 (best)
  ratingUnknown?: boolean; // guests we know nothing about
  playstyle: Playstyle;
  isGuest?: boolean;
  invitedBy?: string; // player id — guests stick with their inviter
  chemistry: string[]; // ids of players they play well with
  avoid?: string[]; // ids of players they clash with — keep on different teams
}

export type TeamColor = 'black' | 'white' | 'blue';

export type Teams = Record<TeamColor, string[]>;

export interface Session {
  availableIds: string[];
  guests: Player[];
  gkIds: string[]; // who can play goalkeeper *today*
  teams: Teams | null;
}

export interface AppState {
  players: Player[];
  session: Session;
}
