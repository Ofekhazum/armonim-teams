import type { AppState, Session } from './types';
import { DEFAULT_PLAYERS } from './defaultRoster';

const KEY = 'armonim-teams-v1';

export const emptySession = (): Session => ({
  availableIds: [],
  guests: [],
  gkIds: [],
  teams: null,
});

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      // an empty saved roster (e.g. the site was opened before the published
      // roster existed) falls through to the published default below
      if (Array.isArray(parsed.players) && parsed.players.length > 0) {
        // chemistry/avoid are mutual — repair any one-way links from older versions
        const players = parsed.players.map((p) => ({
          ...p,
          chemistry: p.chemistry ?? [],
          avoid: p.avoid ?? [],
        }));
        const byId = new Map(players.map((p) => [p.id, p]));
        for (const p of players) {
          for (const other of p.chemistry) {
            const o = byId.get(other);
            if (o && !o.chemistry.includes(p.id)) o.chemistry.push(p.id);
          }
          for (const other of p.avoid!) {
            const o = byId.get(other);
            if (o && !o.avoid!.includes(p.id)) o.avoid!.push(p.id);
          }
        }
        return {
          players,
          session: { ...emptySession(), ...parsed.session },
        };
      }
    }
  } catch {
    // corrupted state — start fresh
  }
  // nothing saved on this device yet — start from the published roster
  return {
    players: DEFAULT_PLAYERS.map((p) => ({ ...p, chemistry: [...p.chemistry], avoid: [...(p.avoid ?? [])] })),
    session: emptySession(),
  };
}

export function saveState(state: AppState) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
