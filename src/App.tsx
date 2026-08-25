import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppState,
  FixtureRecord,
  LiveFixture,
  MatchLogEntry,
  Player,
  Session,
  TeamWins,
} from './types';
import { ATTACK_DEFAULT, initialClock } from './types';
import { emptySession, loadState, saveState } from './storage';
import { mergePrivateFields, mergePublicRoster } from './rosterMerge';
import { preserveMvp } from './mvp';
import { mergeGuestIdentities } from './guests';
import { publishLive, useLiveFixture } from './live';
import LiveFixtureView from './components/LiveFixtureView';
import {
  fetchFullRoster,
  fetchFullHistory,
  fetchRemoteHistory,
  fetchRemoteRoster,
  localHistoryVersion,
  localRosterVersion,
  publishRemoteHistory,
  REMOTE_URL,
  setLocalHistoryVersion,
  setLocalRosterVersion,
} from './remote';
import Roster from './components/Roster';
import MatchDay from './components/MatchDay';
import History from './components/History';
import { useAdminUnlock } from './useAdminUnlock';
import { TEST_WORD, isTestMode } from './testMode';
import TestModeBanner from './components/TestModeBanner';

type Tab = 'live' | 'match' | 'roster' | 'club';

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [tab, setTab] = useState<Tab>('roster');
  // the secret word once unlocked — null means normal (read-only) mode
  // The sandbox is admin from the moment it opens (§2.32). Most of what it
  // exists to exercise — match day, the balancer, filing a night, the reporter
  // — is behind admin, and there is nothing here to protect: the data is
  // invented and there is no network to publish it to. The word itself is
  // never used, only its presence, and `verifyWord` would reject it anyway
  // because test mode has no Worker to ask.
  const [adminWord, setAdminWord] = useState<string | null>(isTestMode() ? TEST_WORD : null);
  // whether this device has confirmed the roster's private fields against the
  // server since unlocking — see the fetchFullRoster effect below
  const [rosterHydrated, setRosterHydrated] = useState(false);
  const isAdmin = adminWord !== null;
  const { unlockAdmin, unlocking } = useAdminUnlock(setAdminWord);

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
  const {
    fixture: liveFixture,
    setClock: setLiveClock,
    setMatchLog: setLiveLog,
    forget: forgetLive,
  } = useLiveFixture(true);
  const offeredLive = useRef(false);

  // Writing down a match, from whichever device did it. The clock going back to
  // the start is part of *recording a result*, not part of the fixture page
  // (§2.18) — so it lives here, where both the organiser's screen and the
  // spectator view reach it, rather than being implemented twice and drifting.
  // Only on a result being added: an undo is a correction, not a whistle.
  const shareLog = (log: MatchLogEntry[]) => {
    const recorded = log.length > (liveFixture?.matchLog?.length ?? 0);
    setLiveLog(log);
    if (recorded) setLiveClock(initialClock());
  };

  // An organiser tapping Live during their own night wants their own screen —
  // milestones, MVP, the result, End fixture — not the spectator cut of it. So
  // for them the Live tab *is* the fixture page, rather than a second, thinner
  // rendering of the same match they are standing in the middle of.
  //
  // This is a question of what can be *drawn*, never of what is allowed: the
  // fixture page needs teams, ratings and history that the deliberately-thin
  // live payload doesn't carry. An admin device that lacks them doesn't get
  // shown less — it goes and gets them, in adoptLive just below.
  const runningLocally = isAdmin && state.session.fixtureStarted && state.session.teams !== null;

  // Land on the live fixture the first time we hear about one — on a match
  // night that is the only thing anyone opened the app for. Only ever done
  // once, and never over a tab the user chose themselves.
  useEffect(() => {
    if (!liveFixture || offeredLive.current) return;
    offeredLive.current = true;
    setTab((t) => (t === 'roster' ? 'live' : t));
  }, [liveFixture]);

  // Rebuild a full local session from the live record, so an organiser on any
  // device can run the night — record the result, pick the MVP, end it — rather
  // than only the phone that happened to start it. Being admin is what confers
  // the right; which device you are holding was never supposed to.
  //
  // Done automatically rather than behind a "take over" button. Adoption is
  // purely local — it publishes nothing, so two admin devices doing it cannot
  // fight — and the only thing it can cost is a squad half-picked on this
  // device, which requires a match to be live, you to be admin on a second
  // phone, and that phone to be mid-selection, all at once. Weighed against
  // making every organiser learn an extra concept to get controls they already
  // had the right to, the button was the worse trade.
  //
  // Everything the fixture page needs is either in the live record (teams, who
  // is playing, the keeper, the clock) or already on this device (the roster,
  // with ratings, and the history the milestones are counted from). The one
  // genuine gap is guests, who exist only for tonight and are not in anybody's
  // roster: they come back with a name and an unknown rating, which affects the
  // team-average display and nothing that gets saved.
  const adoptLive = (fixture: LiveFixture) => {
    const known = new Map(state.players.map((p) => [p.id, p]));
    const availableIds: string[] = [];
    const guests: Player[] = [];
    for (const p of fixture.players) {
      if (known.has(p.id)) availableIds.push(p.id);
      else {
        guests.push({
          id: p.id,
          name: p.name,
          rating: 3.5,
          ratingUnknown: true,
          attack: ATTACK_DEFAULT,
          isGuest: true,
          chemistry: [],
        });
      }
    }
    setSession({
      ...emptySession(),
      availableIds,
      guests,
      gkIds: [...fixture.gkIds],
      teams: {
        black: [...fixture.teams.black],
        white: [...fixture.teams.white],
        blue: [...fixture.teams.blue],
      },
      fixtureStarted: true,
      liveStartedAt: fixture.startedAt,
      clock: fixture.clock,
      // the matches already written down tonight, by whoever wrote them —
      // without this an organiser adopting the night mid-fixture would file it
      // as if nothing had been played
      matchLog: fixture.matchLog ?? [],
    });
    // no tab change needed: this device is now running the night, so the Live
    // tab renders the full fixture page on the very next paint
  };

  // Adopt once per fixture, and only while actually looking at the Live tab —
  // an organiser glancing at the roster shouldn't have tonight quietly loaded
  // underneath them. Keyed on the fixture id so stepping back to the teams (or
  // ending and starting a new night) doesn't immediately re-adopt.
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    if (tab !== 'live' || !isAdmin || !liveFixture || runningLocally) return;
    if (adopted.current === liveFixture.id) return;
    adopted.current = liveFixture.id;
    adoptLive(liveFixture);
  });

  // The organiser has just ended their night, or stepped back to re-pick teams,
  // while standing on Live. That tab is about to be empty and everything they
  // would do next is on Match day, so take them there. Deliberately keyed on
  // *having been* the device running it rather than on being admin: an
  // organiser watching from a second phone should keep the read-only view they
  // asked for, not be thrown onto a Match day they aren't running.
  const wasRunningHere = useRef(false);
  useEffect(() => {
    if (wasRunningHere.current && !runningLocally && tab === 'live') setTab('match');
    wasRunningHere.current = runningLocally;
  }, [runningLocally, tab]);

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
    // the organiser doesn't need a poll to tell them their own night is over
    if (fixture === null) forgetLive();
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
  //
  // An organiser pulls the *full* copy, ratings included, and that is a
  // correctness requirement rather than a convenience: the public read no
  // longer carries what a player was rated on the night (§2.28), and this
  // device republishes the entire list every time a night is filed. Adopting
  // the stripped copy here would hand it back on the next save with the
  // ratings gone from the shared store for good. Re-run when the admin word
  // arrives, so unlocking mid-session upgrades what this device is holding.
  useEffect(() => {
    let cancelled = false;
    const pull = adminWord == null ? fetchRemoteHistory() : fetchFullHistory(adminWord);
    pull.then((remote) => {
      if (cancelled || !remote) return;
      // `<` rather than `<=` once unlocked: the same version can arrive twice,
      // first stripped and then whole, and the second one is worth taking.
      const seen = localHistoryVersion();
      if (adminWord == null ? remote.version <= seen : remote.version < seen) return;
      setState((s) => ({ ...s, history: remote.fixtures }));
      setLocalHistoryVersion(remote.version);
    });
    return () => {
      cancelled = true;
    };
  }, [adminWord]);

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

  // History as everything *reads* it: the same records, with a guest who has
  // turned up more than once counted as one person rather than as a new
  // stranger each night (§2.6). Derived rather than stored — `state.history`
  // keeps the ids it was filed with, so saving, editing and publishing all
  // still work on the untouched records, and a merge that turns out wrong is
  // undone by changing a function rather than by repairing data.
  const readHistory = useMemo(
    () => mergeGuestIdentities(state.history, new Set(state.players.map((p) => p.id))),
    [state.history, state.players],
  );

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
    // The MVP is picked afterwards, from History, so the fixture page never
    // supplies one — and a re-save (the night gets filed, then another match
    // is logged and it's filed again) must not drop a pick that was already
    // made. Everything else is genuinely re-derived from the session and is
    // meant to overwrite.
    const existing = state.history.find((f) => f.id === fixture.id);
    const record = preserveMvp(existing, fixture);
    const history = existing
      ? state.history.map((f) => (f.id === fixture.id ? record : f))
      : [...state.history, record];
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
    patch: { wins: TeamWins; date: string; mvpId?: string; note?: string },
  ) => {
    // mvpId and note are spread as-is, including when explicitly undefined —
    // that is how the edit form clears a wrong pick, and how it deletes a note.
    // JSON.stringify drops an undefined key either way.
    const history = state.history.map((f) => (f.id === id ? { ...f, ...patch } : f));
    setState((s) => ({
      ...s,
      history,
      // the MVP isn't mirrored here — the session doesn't hold one any more,
      // and saveFixture carries the filed pick across a re-save
      session:
        s.session.savedFixtureId === id ? { ...s.session, wins: patch.wins } : s.session,
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

  // Match day, which renders the organiser's fixture page once a night has
  // started. Held as an element because the Live tab shows the very same thing
  // for an admin running tonight — see runningLocally below.
  const matchDay = (
    <MatchDay
      players={state.players}
      session={state.session}
      history={readHistory}
      setSession={setSession}
      isAdmin={isAdmin}
      onSaveFixture={saveFixture}
      onShareLive={shareLive}
      liveClock={liveFixture?.clock ?? null}
      onShareClock={setLiveClock}
      liveLog={liveFixture?.matchLog ?? null}
      onShareLog={shareLog}
    />
  );

  return (
    <div className="mx-auto max-w-5xl px-3 pb-16 sm:px-6">
      {/* Above everything, on every tab, and not dismissible — see the note in
          TestModeBanner. Renders nothing at all outside the sandbox. */}
      <TestModeBanner />
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <h1 className="text-2xl font-black tracking-tight text-amber-950">
          <span className="mr-2">🦁</span>
          <span className="bg-gradient-to-r from-orange-600 to-amber-800 bg-clip-text text-transparent">
            Armonim FC
          </span>
          {isAdmin && (
            <span className="ml-2 rounded-full bg-orange-600 px-2 py-0.5 align-middle text-xs font-bold text-amber-50">
              ADMIN
            </span>
          )}
        </h1>
        <nav className="flex items-center gap-1 rounded-full border border-amber-900/20 bg-[#fffdf4]/70 p-1 shadow-sm">
          {(liveFixture || tab === 'live') && liveTabBtn}
          {isAdmin && tabBtn('match', 'Match day')}
          {tabBtn('roster', `Roster (${state.players.length})`)}
          {tabBtn('club', 'Club')}
          {/* Unlocking lives in the header rather than on the Roster tab
              because what it gates is spread across all of them — Match day,
              the rating column in History, ending a live fixture — and having
              to go and find the Roster page first was a step that taught
              nobody anything. It is one control in two states rather than two
              controls: the same place you went to get in is the place you
              press to get back out, and the open padlock says which you are. */}
          {REMOTE_URL && (
            <button
              onClick={isAdmin ? () => setAdminWord(null) : unlockAdmin}
              disabled={unlocking}
              title={isAdmin ? 'Log off admin' : 'Unlock admin mode'}
              className="rounded-full px-3 py-1.5 text-sm font-semibold text-amber-900/70 transition-colors hover:text-orange-700 disabled:opacity-50"
            >
              {unlocking ? '…' : isAdmin ? '🔓' : '🔒'}
            </button>
          )}
        </nav>
      </header>

      {tab === 'live' ? (
        runningLocally ? (
          matchDay
        ) : liveFixture ? (
          <LiveFixtureView
            fixture={liveFixture}
            history={readHistory}
            onChangeClock={setLiveClock}
            onChangeLog={shareLog}
            // an organiser looking at a night some other device started still
            // owns it, and must be able to stop it — see the note in the view
            onEndFixture={
              isAdmin
                ? () => {
                    void shareLive(null, true);
                    // a stale local flag would otherwise keep claiming this
                    // device is mid-fixture after the shared one is gone
                    setSession({
                      ...state.session,
                      fixtureStarted: false,
                      liveStartedAt: null,
                    });
                  }
                : undefined
            }
          />
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
          history={readHistory}
          onChange={setPlayers}
          adminWord={adminWord}
          setAdminWord={setAdminWord}
          rosterHydrated={rosterHydrated}
        />
      ) : tab === 'club' ? (
        <History
          history={readHistory}
          players={state.players}
          isAdmin={isAdmin}
          // the word itself, not just the flag: writing a recap is a server
          // call the worker authenticates, the same as publishing a roster
          adminWord={adminWord}
          onApplyRating={applyRating}
          onDeleteFixture={deleteFixture}
          onEditFixture={editFixture}
        />
      ) : (
        matchDay
      )}
    </div>
  );
}
