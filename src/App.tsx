import { useEffect, useState } from 'react';
import type { AppState, FixtureRecord, Player, Session, TeamWins } from './types';
import { migratePlayer } from './types';
import { loadState, saveState } from './storage';
import {
  fetchRemoteHistory,
  fetchRemoteRoster,
  localHistoryVersion,
  localRosterVersion,
  publishRemoteHistory,
  setLocalHistoryVersion,
  setLocalRosterVersion,
} from './remote';
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

  // Same pull-on-load as the roster above, for the shared results history.
  // Only pulled once at mount — an admin actively recording results mid-session
  // won't have their own in-progress edits overwritten by a stale fetch.
  useEffect(() => {
    let cancelled = false;
    fetchRemoteHistory().then((remote) => {
      if (cancelled || !remote || remote.version <= localHistoryVersion()) return;
      setState((s) => ({ ...s, history: remote.fixtures }));
      setLocalHistoryVersion(remote.version);
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

  // History is shared, like the roster — but unlike the roster's manual
  // "📢 Publish" button, every admin write here pushes immediately, since
  // asking someone to separately publish after recording every night's scores
  // would be one more step nobody remembers. Only admin writes sync at all:
  // an unlocked-word write is already required to save/edit/delete a fixture
  // (see the isAdmin checks in MatchDay/History), so this never runs
  // unauthenticated. Failures are surfaced — the local change already stuck,
  // but silently failing to *share* it would look like data loss to anyone
  // else expecting to see it.
  const syncHistory = async (history: FixtureRecord[]) => {
    if (adminWord == null) return;
    const { result, version } = await publishRemoteHistory(history, adminWord);
    if (result === 'ok') {
      if (version) setLocalHistoryVersion(version);
    } else if (result === 'wrong-word') {
      alert(
        '❌ The password is no longer valid — this is saved on this device but not shared yet. Unlock admin again and re-save.',
      );
      setAdminWord(null);
    } else if (result === 'rate-limited') {
      alert(
        '❌ Too many failed attempts recently — this is saved on this device, but sharing is paused for a few minutes.',
      );
    } else if (result !== 'not-configured') {
      alert("Could not share this — it's saved on this device, but others won't see it yet.");
    }
  };

  // Saving the same night twice replaces the record rather than appending, so
  // fixing a score doesn't leave a duplicate behind.
  const saveFixture = (fixture: FixtureRecord) => {
    const history = state.history.some((f) => f.id === fixture.id)
      ? state.history.map((f) => (f.id === fixture.id ? fixture : f))
      : [...state.history, fixture];
    setState((s) => ({ ...s, history }));
    void syncHistory(history);
  };

  const deleteFixture = (id: string) => {
    const history = state.history.filter((f) => f.id !== id);
    setState((s) => ({
      ...s,
      history,
      // if tonight's own record was the one deleted, forget that it was ever
      // filed — otherwise "Save to history" would still read as an update
      session:
        s.session.savedFixtureId === id ? { ...s.session, savedFixtureId: null } : s.session,
    }));
    void syncHistory(history);
  };

  // Correcting a night after the fact. If it happens to be the night still
  // open on Match Day, the in-progress tally is corrected with it — otherwise
  // saving again from there would quietly undo the edit.
  const editFixture = (id: string, patch: { wins: TeamWins; date: string }) => {
    const history = state.history.map((f) => (f.id === id ? { ...f, ...patch } : f));
    setState((s) => ({
      ...s,
      history,
      session:
        s.session.savedFixtureId === id ? { ...s.session, wins: patch.wins } : s.session,
    }));
    void syncHistory(history);
  };

  // Attaching/removing a night's keepsake photo — same admin-gated shared
  // write as any other history correction (see editFixture above).
  const setFixturePhoto = (id: string, photo: string | null) => {
    const history = state.history.map((f) =>
      f.id === id ? { ...f, photo: photo ?? undefined } : f,
    );
    setState((s) => ({ ...s, history }));
    void syncHistory(history);
  };

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
          onSetPhoto={setFixturePhoto}
        />
      ) : (
        <MatchDay
          players={state.players}
          session={state.session}
          history={state.history}
          setSession={setSession}
          isAdmin={adminWord !== null}
          setAdminWord={setAdminWord}
          onSaveFixture={saveFixture}
        />
      )}
    </div>
  );
}
