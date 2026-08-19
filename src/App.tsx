import { useEffect, useRef, useState } from 'react';
import type { AppState, FixtureRecord, LiveFixture, Player, Session, TeamWins } from './types';
import { loadState, saveState } from './storage';
import { mergePrivateFields, mergePublicRoster } from './rosterMerge';
import { publishLive, useLiveFixture } from './live';
import LiveFixtureView from './components/LiveFixtureView';
import {
  fetchFullRoster,
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

type Tab = 'live' | 'match' | 'roster' | 'history';

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [tab, setTab] = useState<Tab>('roster');
  // the secret word once unlocked — null means normal (read-only) mode
  const [adminWord, setAdminWord] = useState<string | null>(null);
  // whether this device has confirmed the roster's private fields against the
  // server since unlocking — see the fetchFullRoster effect below
  const [rosterHydrated, setRosterHydrated] = useState(false);
  const isAdmin = adminWord !== null;

  useEffect(() => saveState(state), [state]);

  // --- What this device is allowed to see ----------------------------------
  // Match day is the organiser's workbench — availability, guests, ratings,
  // the balancer, the result — and everyone else in the group gets the app to
  // find out who they're playing with, not to run the night. So it's gated,
  // and if admin is switched off while standing on it, the tab goes away
  // underneath and this puts the user somewhere that still exists.
  useEffect(() => {
    if (!isAdmin && tab === 'match') setTab('roster');
  }, [isAdmin, tab]);

  // The fixture being played right now, polled from the Worker (§2.14). This
  // is how a player finds out there's a game on and what team they're on,
  // given Match day is hidden from them.
  const liveFixture = useLiveFixture(true);
  const offeredLive = useRef(false);

  // Land on the live fixture the first time we hear about one — on a match
  // night that is the only thing anyone opened the app for. Only ever done
  // once, and never over a tab the user chose themselves.
  useEffect(() => {
    if (!liveFixture || offeredLive.current) return;
    offeredLive.current = true;
    setTab((t) => (t === 'roster' ? 'live' : t));
  }, [liveFixture]);

  // Publishing the live fixture is an admin write like any other, so it needs
  // the word. A failed clock update is deliberately quiet — the organiser's own
  // screen is already correct, and an alert every time a phone drops a bar of
  // signal would be worse than the group's clock being one poll behind.
  //
  // Starting and ending are not that. Those are the two moments the group's
  // whole view hinges on, and a silent failure there means the organiser
  // believes everyone can see tonight's teams when nobody can — so they say so.
  const shareLive = async (fixture: LiveFixture | null, critical = false) => {
    if (adminWord == null) return;
    const result = await publishLive(fixture, adminWord);
    if (result === 'ok' || !critical) return;
    alert(
      fixture
        ? "⚠️ Couldn't share this fixture with the group — they won't see tonight's teams.\n\nCheck your connection, then go back to the teams and press Start fixture again."
        : "⚠️ Couldn't tell the group the fixture is over — it may still show as live on their phones.\n\nIt clears itself within 12 hours either way.",
    );
  };

  // On load, pull the shared roster and adopt it if it's newer than what this
  // device last applied. Failures (offline, not set up) are silently ignored,
  // so the app keeps working from local/default data.
  useEffect(() => {
    let cancelled = false;
    fetchRemoteRoster().then((remote) => {
      if (cancelled || !remote || remote.version <= localRosterVersion()) return;
      setPlayers((prev) => mergePublicRoster(prev, remote.players));
      setLocalRosterVersion(remote.version);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The public roster no longer carries chemistry/avoid/aliases, so an admin
  // device that has never held them — a new phone, a cleared browser — would
  // otherwise balance teams without the keep-apart lists and, worse, publish
  // that emptiness back over everyone's copy. Unlocking admin is exactly the
  // moment we're entitled to ask for them, so that's when we fetch them.
  //
  // Whether that succeeded is tracked, because "no private fields" and "no
  // private fields *yet*" look identical from the roster screen and only one
  // of them is safe to publish — a worker too old to serve /roster/full is
  // exactly the case that would quietly erase them (see Roster's publish).
  useEffect(() => {
    if (adminWord == null) {
      setRosterHydrated(false);
      return;
    }
    let cancelled = false;
    fetchFullRoster(adminWord).then((full) => {
      if (cancelled) return;
      setRosterHydrated(full !== null);
      if (full) setPlayers((prev) => mergePrivateFields(prev, full.players));
    });
    return () => {
      cancelled = true;
    };
  }, [adminWord]);

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
  // chemistry links, stale generated teams) — clean those up here. Takes an
  // updater as well as a plain list, because the two remote merges below have
  // to read the players already on this device to do their job.
  const setPlayers = (next: Player[] | ((prev: Player[]) => Player[])) => {
    setState((s) => {
      const players = typeof next === 'function' ? next(s.players) : next;
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
    } else if (result === 'stale') {
      // someone else recorded a night since this device last looked. Sharing
      // now would replace their results with a list that never had them.
      alert(
        '⚠️ Someone else has updated the shared history since this device last loaded it.\n\nThis is saved here, but not shared — reload the page to pull their version first, then re-enter this change.',
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
  const editFixture = (
    id: string,
    patch: { wins: TeamWins; date: string; mvpId?: string },
  ) => {
    // mvpId is spread as-is, including when it's explicitly undefined (that's
    // how the edit form clears a wrong pick) — JSON.stringify drops it either way
    const history = state.history.map((f) => (f.id === id ? { ...f, ...patch } : f));
    setState((s) => ({
      ...s,
      history,
      session:
        s.session.savedFixtureId === id
          ? { ...s.session, wins: patch.wins, mvpId: patch.mvpId ?? null }
          : s.session,
    }));
    void syncHistory(history);
  };

  // Accepting a rating suggestion is a normal roster edit — it goes through
  // setPlayers so the session stays consistent, and still needs publishing to
  // reach anyone else.
  const applyRating = (playerId: string, rating: number) =>
    setPlayers(state.players.map((p) => (p.id === playerId ? { ...p, rating } : p)));

  const tabBtn = (t: Tab, label: string) => (
    <button
      key={t}
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

  // Only appears while a fixture is actually on, and leads with a pulsing dot
  // rather than the word "live" alone — on a phone in a car park the tab has
  // to read as "something is happening now" at a glance.
  const liveTabBtn = (
    <button
      key="live"
      onClick={() => setTab('live')}
      className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
        tab === 'live'
          ? 'bg-red-600 text-amber-50 shadow-sm'
          : 'text-red-700 hover:bg-red-500/10'
      }`}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
            tab === 'live' ? 'bg-amber-100' : 'bg-red-500'
          }`}
        />
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            tab === 'live' ? 'bg-amber-50' : 'bg-red-600'
          }`}
        />
      </span>
      Live
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
          {liveFixture && liveTabBtn}
          {isAdmin && tabBtn('match', 'Match day')}
          {tabBtn('roster', `Roster (${state.players.length})`)}
          {tabBtn('history', 'History')}
        </nav>
      </header>

      {tab === 'live' ? (
        liveFixture ? (
          <LiveFixtureView fixture={liveFixture} />
        ) : (
          // the night ended while this tab was open — say so rather than
          // leaving the last frame of a finished match on screen
          <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-6 text-center shadow-sm">
            <p className="text-lg font-bold text-amber-950">No fixture is live right now</p>
            <p className="mt-1 text-sm text-amber-900/60">
              This tab appears on its own the moment a night kicks off.
            </p>
          </div>
        )
      ) : tab === 'roster' ? (
        <Roster
          players={state.players}
          onChange={setPlayers}
          adminWord={adminWord}
          setAdminWord={setAdminWord}
          rosterHydrated={rosterHydrated}
        />
      ) : tab === 'history' ? (
        <History
          history={state.history}
          players={state.players}
          isAdmin={isAdmin}
          onApplyRating={applyRating}
          onDeleteFixture={deleteFixture}
          onEditFixture={editFixture}
        />
      ) : (
        <MatchDay
          players={state.players}
          session={state.session}
          history={state.history}
          setSession={setSession}
          isAdmin={isAdmin}
          setAdminWord={setAdminWord}
          onSaveFixture={saveFixture}
          onShareLive={shareLive}
        />
      )}
    </div>
  );
}
