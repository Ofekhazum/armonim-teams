import { useMemo } from 'react';
import type { ClockState, FixtureRecord, LiveFixture, MatchLogEntry } from '../types';
import { agoLabel, useKickedOff } from '../kickoff';
import KickoffCountdown from './KickoffCountdown';
import MatchClock from './MatchClock';
import MatchLog from './MatchLog';
import ScoreBar from './ScoreBar';
import TeamCards from './TeamCards';
import TonightFacts from './TonightFacts';

interface Props {
  fixture: LiveFixture;
  history: FixtureRecord[];
  onChangeClock: (clock: ClockState) => void;
  onChangeLog: (log: MatchLogEntry[]) => void;
  // Present for an organiser who is *not* running the night on this device —
  // see the note on the button below. Absent for everyone else.
  onEndFixture?: () => void;
  // Gates "Undo last match" only. Recording a result stays open to everybody
  // here on purpose — see the note above and `canUndo` in MatchLog.
  isAdmin?: boolean;
}

// What the rest of the group sees while a fixture is on (§2.14). The teams
// half is read-only by construction rather than by hiding buttons: the payload
// behind it (LivePlayer) has no ratings in it to leak and no result to edit,
// so there is nothing here an organiser's screen would have shown differently.
//
// The clock and the match log are the exceptions, and deliberately so — both
// are shared, and anyone can work them. A match ends and whoever is nearest a
// phone writes down who won; there is no reason that has to be the organiser,
// and every reason it shouldn't be (they are usually playing).
//
// Deliberately not the teams board. That one is a work surface — drag targets,
// rating averages, keep-apart warnings — and this is the answer to one
// question a player has while walking to the pitch: which shirt am I in, and
// how long is left.
//
// Everything else this page carries is what the organiser's fixture page
// carries, via TonightFacts (§2.21). The gap between the two was never a
// decision: the milestones and the radar are counts of who has turned up, the
// group's own record, and they were sitting behind an admin word purely because
// that is the page they were written on.
export default function LiveFixtureView({
  fixture,
  history,
  onChangeClock,
  onChangeLog,
  onEndFixture,
  isAdmin = false,
}: Props) {
  const byId = new Map(fixture.players.map((p) => [p.id, p]));
  const gkSet = new Set(fixture.gkIds);
  // absent on a fixture published by an older build, which is a night with
  // nothing written down rather than a broken one
  const matchLog = fixture.matchLog ?? [];

  // Derived, not stored (§2.7.2) — every phone reaches kickoff on its own
  // clock, and flips from the countdown below to the live scoreboard without
  // anyone having to be told.
  const kickedOff = useKickedOff(fixture.startedAt);

  // Tonight, excluded from its own arithmetic. The organiser's page has the
  // saved record's id to do this with; a viewer doesn't — the live fixture is
  // keyed by kick-off time and the history record by a uid — so the date does
  // the job. Taken from the *fixture's* kickoff, not today: a fixture
  // scheduled for tomorrow must not exclude a different, already-filed night
  // from today's arithmetic. It is the same date the record is filed under
  // (both UTC, both from toISOString), and two fixtures on one date has never
  // happened. Without it, a night whose result went in early would count
  // itself: everyone's tenth night would silently become their eleventh while
  // they were still playing.
  const past = useMemo(() => {
    const fixtureDate = new Date(fixture.startedAt).toISOString().slice(0, 10);
    return history.filter((fx) => fx.date !== fixtureDate);
  }, [history, fixture.startedAt]);

  // Ending a night must never depend on which phone the organiser happens to
  // be holding — without this, an organiser whose browser was cleared could see
  // a fixture they owned and have no way to stop it, which is exactly what
  // happened. Reached only in the moment before an admin device has rebuilt the
  // night locally (App's adoptLive), or when it can't: everything else on the
  // organiser's page needs teams and ratings this view doesn't carry, but
  // *ending* needs nothing but the admin word.
  const end = () => {
    const msg = kickedOff
      ? "End tonight's fixture for everyone?\n\nThe live view disappears from the group's phones. Nothing already saved to history is affected."
      : "Cancel this scheduled fixture?\n\nThe teams and countdown disappear from everyone's phones.";
    if (confirm(msg)) onEndFixture?.();
  };

  return (
    <div className="space-y-4">
      {kickedOff ? (
        <ScoreBar clock={fixture.clock} log={matchLog} />
      ) : (
        <KickoffCountdown startedAt={fixture.startedAt} fixtureId={fixture.id} />
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-lg font-black text-amber-950">
          <span className="relative flex h-2.5 w-2.5">
            {kickedOff && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${kickedOff ? 'bg-red-600' : 'bg-amber-500'}`}
            />
          </span>
          {kickedOff ? "Tonight's fixture" : "Tonight's teams"}
        </h2>
        <span className="text-sm text-amber-900/55">
          {kickedOff
            ? `kicked off ${agoLabel(fixture.startedAt)}`
            : `starts ${new Date(fixture.startedAt).toLocaleString([], {
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}`}
        </span>
        {onEndFixture && (
          <>
            <div className="flex-1" />
            <button
              onClick={end}
              className="rounded-xl border border-red-500/60 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              {kickedOff ? '⏹️ End fixture' : '✕ Cancel fixture'}
            </button>
          </>
        )}
      </div>

      {/* The same cards the organiser's page draws — no `aside`, so no rating
          average, and no `note`, because the tooltips are read off the private
          half of a Player that never travels here. */}
      <TeamCards teams={fixture.teams} byId={byId} gkSet={gkSet} />

      {/* Clock and log first, facts after — the same order the organiser's page
          uses, and for the same reason (§2.21). Anyone at the pitch with this
          open is here to see the time and write down who won. Neither has
          anything to show before the fixture has actually kicked off. */}
      {kickedOff && (
        <>
          <MatchClock state={fixture.clock} onChange={onChangeClock} fixtureId={fixture.id} />
          <MatchLog log={matchLog} onChange={onChangeLog} canUndo={isAdmin} />
        </>
      )}

      <TonightFacts
        players={fixture.players}
        history={past}
        teams={fixture.teams}
        fixtureId={fixture.id}
      />
    </div>
  );
}
