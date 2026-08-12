import { useMemo } from 'react';
import type { DraftTeamWins, Player, TeamColor, Teams } from '../types';
import { roleBadge } from '../types';
import { TEAM_COLORS, lineupOrder, teamStats } from '../balancer';
import { Name, STYLE_META, TEAM_META } from './ui';
import ResultsPanel from './ResultsPanel';

interface Props {
  teams: Teams;
  players: Player[];
  gkIds: string[];
  wins: DraftTeamWins;
  onChangeWins: (wins: DraftTeamWins) => void;
  onSaveResults: () => void;
  saved: boolean;
  isAdmin: boolean;
  // unlocks admin without leaving for the Roster tab (see ResultsPanel)
  onUnlockAdmin?: () => void;
  unlocking?: boolean;
  // lets the organizer undo a mistaken "Start fixture" and go on editing teams
  onBack: () => void;
}

// The fixture in progress: tonight's teams, locked in and shown read-only, plus
// whatever the organizer needs while the match is actually happening — for now
// just recording the result, with more to come here later.
export default function FixturePage({
  teams,
  players,
  gkIds,
  wins,
  onChangeWins,
  onSaveResults,
  saved,
  isAdmin,
  onUnlockAdmin,
  unlocking,
  onBack,
}: Props) {
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const gkSet = useMemo(() => new Set(gkIds), [gkIds]);
  const stats = Object.fromEntries(
    TEAM_COLORS.map((c) => [c, teamStats(teams[c], byId, gkSet)]),
  ) as Record<TeamColor, ReturnType<typeof teamStats>>;

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="rounded-xl border border-amber-900/30 px-4 py-2 text-sm font-semibold text-amber-900"
      >
        ← Back to teams
      </button>

      {/* Deliberately compact: on this page the teams are a reference you glance
          at, not something you work on, so names go in wrapped chips (~3 lines a
          team) instead of the board's one-tall-row-per-player. */}
      <div className="grid gap-2 sm:grid-cols-3">
        {TEAM_COLORS.map((c) => {
          const m = TEAM_META[c];
          const s = stats[c];
          return (
            <div key={c} className={`pop-in rounded-xl border p-2.5 shadow-md ${m.card}`}>
              <div className="mb-1.5 flex items-baseline justify-between gap-x-2 px-0.5">
                <h3 className={`text-sm font-black ${m.header}`}>
                  {m.emoji} {m.label}
                </h3>
                <span className={`text-[11px] font-semibold ${m.sub}`}>
                  {s.size} · avg {s.avg.toFixed(1)}
                </span>
              </div>
              <ul dir="rtl" className="flex flex-wrap gap-1">
                {lineupOrder(teams[c], byId, gkSet).map((id) => {
                  const p = byId.get(id);
                  if (!p) return null;
                  return (
                    <li
                      key={id}
                      title={
                        p.isGuest
                          ? `Guest of ${p.invitedBy ? byId.get(p.invitedBy)?.name : '?'}`
                          : STYLE_META[roleBadge(p)].label
                      }
                      className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${m.row}`}
                    >
                      {gkSet.has(id) && <span title="Goalkeeper today">🧤</span>}
                      <Name>{p.name}</Name>
                      {p.isGuest && <span className={`text-[9px] ${m.sub}`}>★</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <ResultsPanel
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
