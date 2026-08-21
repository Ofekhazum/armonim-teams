import { useMemo } from 'react';
import type {
  ClockState,
  DraftTeamWins,
  FixtureRecord,
  MatchLogEntry,
  Player,
  TeamColor,
  Teams,
} from '../types';
import { roleBadge } from '../types';
import { TEAM_COLORS, lineupOrder, teamStats } from '../balancer';
import { STYLE_META } from './ui';
import MatchClock from './MatchClock';
import TeamCards from './TeamCards';
import TonightFacts from './TonightFacts';
import ResultsPanel from './ResultsPanel';
import MatchLog from './MatchLog';
import ScoreBar from './ScoreBar';

interface Props {
  teams: Teams;
  players: Player[];
  history: FixtureRecord[];
  gkIds: string[];
  wins: DraftTeamWins;
  onChangeWins: (wins: DraftTeamWins) => void;
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
  onSaveResults: () => void;
  saved: boolean;
  savedFixtureId: string | null;
  isAdmin: boolean;
  // unlocks admin without leaving for the Roster tab (see ResultsPanel)
  onUnlockAdmin?: () => void;
  unlocking?: boolean;
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
  onChangeWins,
  matchLog,
  onChangeLog,
  clock,
  onChangeClock,
  liveFixtureId,
  onSaveResults,
  saved,
  savedFixtureId,
  isAdmin,
  onUnlockAdmin,
  unlocking,
  onBack,
  onEndFixture,
}: Props) {
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const gkSet = useMemo(() => new Set(gkIds), [gkIds]);
  const stats = Object.fromEntries(
    TEAM_COLORS.map((c) => [c, teamStats(teams[c], byId, gkSet)]),
  ) as Record<TeamColor, ReturnType<typeof teamStats>>;
  // Ending the night throws away whatever hasn't been filed, so the warning
  // says so specifically rather than leaving it to be discovered afterwards.
  const unsavedResult = !saved && TEAM_COLORS.some((c) => wins[c] != null);
  const endFixture = () => {
    const warning = unsavedResult
      ? "Tonight's result hasn't been saved to history yet and will be lost. End the fixture anyway?"
      : "End tonight's fixture? This clears today's selections, guests and teams.";
    if (confirm(warning)) onEndFixture();
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
          onClick={endFixture}
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

      <TonightFacts players={players} history={history} tonightId={savedFixtureId} />

      <MatchClock state={clock} onChange={onChangeClock} fixtureId={liveFixtureId} />

      <MatchLog log={matchLog} onChange={onChangeLog} />

      {/* The MVP is not picked here. It's the one subjective call the app
          collects, and asking for it mid-fixture asks the wrong question at
          the wrong time — the standout of the night isn't known while the
          night is still going, and a page you touch every ten minutes with wet
          hands is a bad place to keep a decision you can only make once. It
          lives on the History tab now, on the night it belongs to (§2.13). */}
      <ResultsPanel
        fromLog={matchLog.length > 0}
        wins={wins}
        onChange={onChangeWins}
        onSave={onSaveResults}
        saved={saved}
        isAdmin={isAdmin}
        onUnlockAdmin={onUnlockAdmin}
        unlocking={unlocking}
      />
    </div>
  );
}
