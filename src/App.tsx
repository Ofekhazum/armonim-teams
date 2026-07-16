import { useEffect, useState } from 'react';
import type { AppState, Player, Session } from './types';
import { loadState, saveState } from './storage';
import Roster from './components/Roster';
import MatchDay from './components/MatchDay';

type Tab = 'match' | 'roster';

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [tab, setTab] = useState<Tab>('roster');

  useEffect(() => saveState(state), [state]);

  // Roster edits can invalidate parts of the session (deleted players, broken
  // chemistry links, stale generated teams) — clean those up here.
  const setPlayers = (players: Player[]) => {
    setState((s) => {
      const ids = new Set(players.map((p) => p.id));
      const clean = players.map((p) => ({
        ...p,
        chemistry: p.chemistry.filter((c) => ids.has(c)),
        avoid: (p.avoid ?? []).filter((c) => ids.has(c)),
      }));
      const guests = s.session.guests.filter((g) => !g.invitedBy || ids.has(g.invitedBy));
      const knownIds = new Set([...ids, ...guests.map((g) => g.id)]);
      const session: Session = {
        ...s.session,
        availableIds: s.session.availableIds.filter((id) => ids.has(id)),
        guests,
        gkIds: s.session.gkIds.filter((id) => knownIds.has(id)),
      };
      if (session.teams && Object.values(session.teams).flat().some((id) => !knownIds.has(id))) {
        session.teams = null;
      }
      return { players: clean, session };
    });
  };

  const setSession = (session: Session) => setState((s) => ({ ...s, session }));

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
        tab === t
          ? 'bg-orange-600 text-amber-50 shadow-sm'
          : 'text-amber-900 hover:bg-amber-200/70'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-5xl px-3 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <h1 className="text-2xl font-black tracking-tight text-amber-950">
          <span className="mr-2">🦁</span>
          <span className="bg-gradient-to-r from-orange-600 to-amber-800 bg-clip-text text-transparent">
            Armonim FC
          </span>
        </h1>
        <nav className="flex gap-1 rounded-full border border-amber-900/20 bg-[#fffdf4]/70 p-1 shadow-sm">
          {tabBtn('match', 'Match day')}
          {tabBtn('roster', `Roster (${state.players.length})`)}
        </nav>
      </header>

      {tab === 'roster' ? (
        <Roster players={state.players} onChange={setPlayers} />
      ) : (
        <MatchDay players={state.players} session={state.session} setSession={setSession} />
      )}
    </div>
  );
}
