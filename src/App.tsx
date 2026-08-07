import { useEffect, useState } from 'react';
import type { AppState, FixtureRecord, Player, Session, TeamWins } from './types';
import { migratePlayer } from './types';
import { loadState, saveState } from './storage';
import { fetchRemoteRoster, localRosterVersion, setLocalRosterVersion } from './remote';
import Roster from './components/Roster';
import MatchDay from './components/MatchDay';
import History from './components/History';

type Tab = 'match' | 'roster' | 'history';

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [tab, setTab] = useState<Tab>('roster');
  // the secret word once unlocked — null means normal (read-only) mode
  const [adminWord, setAdminWord] = useState<string | null>(null);

  useEffect(() => saveState(state), [state]);

  // On load, pull the shared roster and adopt it if it's newer than what this
  // device last applied. Failures (offline, not set up) are silently ignored,
  // so the app keeps working from local/default data.
  useEffect(() => {
    let cancelled = false;
    fetchRemoteRoster().then((remote) => {
      if (cancelled || !remote || remote.version <= localRosterVersion()) return;
      const normalized = remote.players.map((p) => ({
        ...migratePlayer(p),
        chemistry: p.chemistry ?? [],
        avoid: p.avoid ?? [],
      }));
      setPlayers(normalized);
      setLocalRosterVersion(remote.version);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      return { ...s, players: clean, session };
    });
  };

  const setSession = (session: Session) => setState((s) => ({ ...s, session }));

  // Saving the same night twice replaces the record rather than appending, so
  // fixing a score doesn't leave a duplicate behind.
  const saveFixture = (fixture: FixtureRecord) =>
    setState((s) => ({
      ...s,
      history: s.history.some((f) => f.id === fixture.id)
        ? s.history.map((f) => (f.id === fixture.id ? fixture : f))
        : [...s.history, fixture],
    }));

  const deleteFixture = (id: string) =>
    setState((s) => ({
      ...s,
      history: s.history.filter((f) => f.id !== id),
      // if tonight's own record was the one deleted, forget that it was ever
      // filed — otherwise "Save to history" would still read as an update
      session:
        s.session.savedFixtureId === id ? { ...s.session, savedFixtureId: null } : s.session,
    }));

  // Correcting a night after the fact. If it happens to be the night still
  // open on Match Day, the in-progress tally is corrected with it — otherwise
  // saving again from there would quietly undo the edit.
  const editFixture = (id: string, patch: { wins: TeamWins; date: string }) =>
    setState((s) => ({
      ...s,
      history: s.history.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      session:
        s.session.savedFixtureId === id ? { ...s.session, wins: patch.wins } : s.session,
    }));

  // Accepting a rating suggestion is a normal roster edit — it goes through
  // setPlayers so the session stays consistent, and still needs publishing to
  // reach anyone else.
  const applyRating = (playerId: string, rating: number) =>
    setPlayers(state.players.map((p) => (p.id === playerId ? { ...p, rating } : p)));

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
          {adminWord && (
            <span className="ml-2 rounded-full bg-orange-600 px-2 py-0.5 align-middle text-xs font-bold text-amber-50">
              ADMIN
            </span>
          )}
        </h1>
        <nav className="flex gap-1 rounded-full border border-amber-900/20 bg-[#fffdf4]/70 p-1 shadow-sm">
          {tabBtn('match', 'Match day')}
          {tabBtn('roster', `Roster (${state.players.length})`)}
          {tabBtn('history', 'History')}
        </nav>
      </header>

      {tab === 'roster' ? (
        <Roster
          players={state.players}
          onChange={setPlayers}
          adminWord={adminWord}
          setAdminWord={setAdminWord}
        />
      ) : tab === 'history' ? (
        <History
          history={state.history}
          players={state.players}
          isAdmin={adminWord !== null}
          onApplyRating={applyRating}
          onDeleteFixture={deleteFixture}
          onEditFixture={editFixture}
        />
      ) : (
        <MatchDay
          players={state.players}
          session={state.session}
          setSession={setSession}
          isAdmin={adminWord !== null}
          onSaveFixture={saveFixture}
        />
      )}
    </div>
  );
}
