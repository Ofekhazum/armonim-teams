import { useMemo, useState } from 'react';
import type {
  ClockState,
  DraftTeamWins,
  FixtureRecord,
  MatchLogEntry,
  Player,
  TeamColor,
  Teams,
} from '../types';
import { NOTE_MAX, roleBadge } from '../types';
import { TEAM_COLORS, lineupOrder, teamStats } from '../balancer';
import { STYLE_META } from './ui';
import MatchClock from './MatchClock';
import TeamCards from './TeamCards';
import TonightFacts from './TonightFacts';
import MatchLog from './MatchLog';
import ScoreBar from './ScoreBar';
import { useScrollLock } from '../scrollLock';

interface Props {
  teams: Teams;
  players: Player[];
  history: FixtureRecord[];
  gkIds: string[];
  // Still needed to know whether there is anything to file, even though the
  // fixture page no longer has anywhere to type one in.
  wins: DraftTeamWins;
  // the night as it is played; empty means this one is being tallied the old
  // way at the end (§2.18)
  matchLog: MatchLogEntry[];
  onChangeLog: (log: MatchLogEntry[]) => void;
  // lifted out of MatchClock so the organiser's clock is what everyone
  // watching sees (§2.14)
  clock: ClockState;
  onChangeClock: (clock: ClockState) => void;
  // the live fixture this page is running, if it has been published — what the
  // alerts toggle attaches an opt-in to
  liveFixtureId: string | null;
  onSaveResults: (note?: string) => void;
  saved: boolean;
  savedFixtureId: string | null;
  isAdmin: boolean;
  // lets the organizer undo a mistaken "Start fixture" and go on editing teams
  onBack: () => void;
  // wipes the night and starts over from availability — the same action as the
  // teams board's "New Fixture", offered from the page you're actually on when
  // the night finishes
  onEndFixture: () => void;
}

// The fixture in progress: tonight's teams, locked in and shown read-only, plus
// whatever the organizer needs while the match is actually happening — for now
// just recording the result, with more to come here later.
export default function FixturePage({
  teams,
  players,
  history,
  gkIds,
  wins,
  matchLog,
  onChangeLog,
  clock,
  onChangeClock,
  liveFixtureId,
  onSaveResults,
  saved,
  savedFixtureId,
  isAdmin,
  onBack,
  onEndFixture,
}: Props) {
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const gkSet = useMemo(() => new Set(gkIds), [gkIds]);
  const stats = Object.fromEntries(
    TEAM_COLORS.map((c) => [c, teamStats(teams[c], byId, gkSet)]),
  ) as Record<TeamColor, ReturnType<typeof teamStats>>;
  // Ending the night is where it gets filed, because that is the moment it is
  // actually over. A `confirm()` asking "are you sure" was the wrong shape for
  // it: the real question is not whether to end but what to do with the result
  // first, and a browser dialog can only offer yes and no.
  const [ending, setEnding] = useState(false);
  // The second step, and only for somebody who chose to file: a night that is
  // being thrown away has nothing to remember about it.
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  // Only while the dialog is up. A modal is a `fixed inset-0` panel like any
  // other, and the page behind it scrolling — or rubber-banding out from under
  // it on iOS — is the same bug (see scrollLock.ts).
  useScrollLock(ending || noting);
  const anyResult = matchLog.length > 0 || TEAM_COLORS.some((c) => (wins[c] ?? 0) > 0);
  const finish = (fileIt: boolean) => {
    // Filed first, then ended: `onSaveResults` reads the session that
    // `onEndFixture` is about to clear.
    if (fileIt) onSaveResults(note.trim() || undefined);
    setEnding(false);
    setNoting(false);
    setNote('');
    onEndFixture();
  };

  return (
    <div className="space-y-4">
      {/* Above everything, and stays there — see ScoreBar. */}
      <ScoreBar clock={clock} log={matchLog} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onBack}
          className="rounded-xl border border-amber-900/30 px-4 py-2 text-sm font-semibold text-amber-900"
        >
          ← Back to teams
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setEnding(true)}
          className="rounded-xl border border-red-500/60 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
        >
          ⏹️ End fixture
        </button>
      </div>

      <TeamCards
        teams={teams}
        byId={byId}
        gkSet={gkSet}
        order={(c) => lineupOrder(teams[c], byId, gkSet)}
        note={(p) =>
          p.isGuest
            ? `Guest of ${p.invitedBy ? byId.get(p.invitedBy)?.name : '?'}`
            : STYLE_META[roleBadge(p)].label
        }
        // the only rating on this page, and only when an organiser is holding
        // the phone (§2.9)
        aside={isAdmin ? (c) => ` · avg ${stats[c].avg.toFixed(1)}` : undefined}
      />

      {/* The clock and the log come before the facts, because this page is
          used standing up. The facts are read once, before kick-off; the clock
          and the log are touched every few minutes for two hours, with wet
          hands, by somebody who is not looking for long. Ordering by how
          interesting a panel is put three panels of reading between the
          organiser and the two controls they actually came for. */}
      <MatchClock state={clock} onChange={onChangeClock} fixtureId={liveFixtureId} />

      <MatchLog log={matchLog} onChange={onChangeLog} />

      <TonightFacts
        players={players}
        history={history}
        teams={teams}
        tonightId={savedFixtureId}
        fixtureId={liveFixtureId ?? savedFixtureId}
      />

      {/* The MVP is not picked here. It's the one subjective call the app
          collects, and asking for it mid-fixture asks the wrong question at
          the wrong time — the standout of the night isn't known while the
          night is still going, and a page you touch every ten minutes with wet
          hands is a bad place to keep a decision you can only make once. It
          lives on the History tab now, on the night it belongs to (§2.13). */}

      {/* One question after filing, and the only free text anywhere in a
          fixture record. Everything else the reporter is handed is counted —
          who beat whom, in what order — which is exactly why a night full of
          things that happened reads as a night of arithmetic. The ball over
          the fence is not in the match log and never will be.

          A second step rather than a box on the panel before it, because it
          only applies to a night being kept: one being thrown away has nothing
          to remember about it. Empty is the normal answer and costs one tap. */}
      {noting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-amber-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-900/20 bg-[#fffdf4] p-5 shadow-xl">
            <h3 className="text-lg font-black text-amber-950">Anything worth remembering?</h3>
            <p className="mt-2 text-sm text-amber-900/70">
              Optional, and it goes to the reporter — the one thing in the night's write-up that
              can't be worked out from the results. Skip it and nothing changes.
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              rows={3}
              autoFocus
              placeholder="טום העיף את הכדור מעבר לגדר 5 פעמים"
              className="mt-3 w-full rounded-xl border border-amber-900/25 bg-white px-3 py-2 text-sm text-amber-950 outline-none focus:border-orange-500"
            />
            <div className="mt-1 text-right text-[11px] text-amber-900/35">
              {note.trim().length}/{NOTE_MAX}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <button
                onClick={() => finish(true)}
                className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-amber-50 shadow-sm transition-transform hover:scale-[1.02]"
              >
                🗂️ {note.trim() ? 'Save with the note & end' : 'Save to history & end'}
              </button>
              <button
                onClick={() => {
                  setNote('');
                  setNoting(false);
                  setEnding(true);
                }}
                className="rounded-xl border border-amber-900/25 px-4 py-2 text-sm font-bold text-amber-900 hover:border-orange-500"
              >
                ← Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The end of the night, asked properly. Three answers rather than two:
          the result is filed and the night ends, the night ends and the result
          is thrown away, or neither yet. */}
      {ending && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-amber-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-900/20 bg-[#fffdf4] p-5 shadow-xl">
            <h3 className="text-lg font-black text-amber-950">That's the night?</h3>
            <p className="mt-2 text-sm text-amber-900/70">
              Ending clears tonight's players, guests and teams, and the live view disappears from
              everyone's phones.{' '}
              {saved
                ? 'Tonight is already in history — filing again updates that same record with anything recorded since.'
                : matchLog.length > 0
                  ? `The ${matchLog.length} matches written down tonight are not in history yet.`
                  : anyResult
                    ? "Tonight's tally is not in history yet."
                    : 'Nothing was written down tonight. Filing it anyway keeps who played and which teams they were in, and the tally can be typed in afterwards on the History tab.'}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {isAdmin ? (
                <button
                  onClick={() => {
                    setEnding(false);
                    setNoting(true);
                  }}
                  className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-amber-50 shadow-sm transition-transform hover:scale-[1.02]"
                >
                  🗂️ {saved ? 'Update history & end' : 'Save to history & end'}
                </button>
              ) : (
                <p className="rounded-xl bg-amber-900/[0.06] px-3 py-2 text-xs text-amber-900/60">
                  🔒 Unlock admin to file tonight into history. Ending now keeps the night off the
                  record entirely.
                </p>
              )}
              <button
                onClick={() => finish(false)}
                className={
                  isAdmin
                    ? 'rounded-xl border border-red-500/50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50'
                    : 'rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-amber-50 shadow-sm transition-transform hover:scale-[1.02]'
                }
              >
                {!anyResult
                  ? '⏹️ End without saving'
                  : saved
                    ? '⏹️ End without updating'
                    : '🗑️ End and lose the result'}
              </button>
              <button
                onClick={() => setEnding(false)}
                className="rounded-xl border border-amber-900/25 px-4 py-2 text-sm font-bold text-amber-900 hover:border-orange-500"
              >
                ← Not yet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
