import { useMemo, useState } from 'react';
import type { Player, Playstyle, TeamColor, Teams } from '../types';
import {
  FULL_TEAM,
  TEAM_COLORS,
  glueViolations,
  planRotation,
  teamStats,
} from '../balancer';
import { Name, Stars, STYLE_META, TEAM_META } from './ui';

interface Props {
  teams: Teams;
  players: Player[];
  gkIds: string[];
  onTeamsChange: (teams: Teams) => void;
  onReroll?: () => void;
  rerollLabel?: string;
  onBack: () => void;
}

export default function TeamsBoard({
  teams,
  players,
  gkIds,
  onTeamsChange,
  onReroll,
  rerollLabel,
  onBack,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const gkSet = useMemo(() => new Set(gkIds), [gkIds]);

  const teamOf = (id: string): TeamColor =>
    TEAM_COLORS.find((c) => teams[c].includes(id))!;

  const stats = Object.fromEntries(
    TEAM_COLORS.map((c) => [c, teamStats(teams[c], byId, gkSet)]),
  ) as Record<TeamColor, ReturnType<typeof teamStats>>;

  const avgs = TEAM_COLORS.filter((c) => stats[c].size > 0).map((c) => stats[c].avg);
  const spread = avgs.length > 1 ? Math.max(...avgs) - Math.min(...avgs) : 0;

  const glued = glueViolations(teams, byId);
  const needsRotation = TEAM_COLORS.some(
    (c) => teams[c].length > 0 && teams[c].length < FULL_TEAM,
  );
  const rotation = needsRotation ? planRotation(teams, byId, gkSet) : null;

  const warnings: string[] = [];
  for (const c of TEAM_COLORS) {
    if (stats[c].gkCount > 1)
      warnings.push(
        `${TEAM_META[c].emoji} ${TEAM_META[c].label} has ${stats[c].gkCount} goalkeepers.`,
      );
  }
  for (const g of glued) {
    const inviter = g.invitedBy ? byId.get(g.invitedBy)?.name : '';
    warnings.push(`Guest ${g.name} is not on the same team as ${inviter}.`);
  }
  for (const p of players) {
    for (const otherId of p.avoid ?? []) {
      if (p.id < otherId && byId.has(otherId) && teamOf(p.id) === teamOf(otherId)) {
        warnings.push(`🥊 ${p.name} and ${byId.get(otherId)!.name} don't click — they're on the same team.`);
      }
    }
  }

  const swap = (a: string, b: string) => {
    const ta = teamOf(a);
    const tb = teamOf(b);
    if (ta === tb) return;
    onTeamsChange({
      ...teams,
      [ta]: teams[ta].map((x) => (x === a ? b : x)),
      [tb]: teams[tb].map((x) => (x === b ? a : x)),
    });
  };

  const move = (id: string, to: TeamColor) => {
    const from = teamOf(id);
    if (from === to) return;
    onTeamsChange({
      ...teams,
      [from]: teams[from].filter((x) => x !== id),
      [to]: [...teams[to], id],
    });
  };

  const clickPlayer = (id: string) => {
    if (!selected) return setSelected(id);
    if (selected === id) return setSelected(null);
    if (teamOf(selected) === teamOf(id)) return setSelected(id);
    swap(selected, id);
    setSelected(null);
  };

  const moveTo = (color: TeamColor) => {
    if (!selected) return;
    move(selected, color);
    setSelected(null);
  };

  // display order inside a team: today's keeper → defence → mixed → attacking
  const STYLE_ORDER: Record<Playstyle, number> = { gk: 0, defensive: 1, mixed: 2, attacking: 3 };
  const displayIds = (c: TeamColor) =>
    [...teams[c]].sort((a, b) => {
      const ka = gkSet.has(a) ? -1 : STYLE_ORDER[byId.get(a)?.playstyle ?? 'mixed'];
      const kb = gkSet.has(b) ? -1 : STYLE_ORDER[byId.get(b)?.playstyle ?? 'mixed'];
      if (ka !== kb) return ka - kb;
      return (byId.get(b)?.rating ?? 0) - (byId.get(a)?.rating ?? 0);
    });

  const shareText = () => {
    const HEB: Record<TeamColor, string> = { black: 'שחור', white: 'לבן', blue: 'כחול' };
    const lines: string[] = [
      `⚽ Armonim FC — ${new Date().toLocaleDateString('en-GB')}`,
      '',
    ];
    for (const c of TEAM_COLORS) {
      lines.push(`${TEAM_META[c].emoji} ${HEB[c]}:`);
      for (const id of displayIds(c)) {
        const p = byId.get(id);
        if (!p) continue;
        lines.push(`  • ${p.name}${gkSet.has(id) ? ' 🧤' : ''}`);
      }
      lines.push('');
    }
    if (rotation) {
      lines.push('🔁 Rotation (resting team completes the short side):');
      for (const m of rotation) {
        const base = `${TEAM_META[m.a].emoji} vs ${TEAM_META[m.b].emoji} — ${TEAM_META[m.resting].emoji} rests`;
        const loans = m.loans
          .map((l) => `${byId.get(l.id)?.name ?? '?'} joins ${HEB[l.to]}`)
          .join(', ');
        lines.push(loans ? `${base}; ${loans}` : base);
      }
    }
    return lines.join('\n');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt('Copy the teams:', shareText());
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onBack}
          className="rounded-xl border border-amber-900/30 px-4 py-2 text-sm font-semibold text-amber-900"
        >
          ← Setup
        </button>
        {onReroll && (
          <button
            onClick={onReroll}
            className="rounded-xl border border-amber-900/30 px-4 py-2 text-sm font-semibold text-amber-900 hover:border-orange-500"
          >
            🎲 {rerollLabel ?? 'Re-roll'}
          </button>
        )}
        <div className="flex-1" />
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            spread <= 0.35
              ? 'bg-green-600/15 text-green-800'
              : spread <= 0.7
                ? 'bg-amber-500/25 text-amber-900'
                : 'bg-red-600/15 text-red-800'
          }`}
          title="Difference between the strongest and weakest team's average rating"
        >
          Balance gap: {spread.toFixed(2)}
        </span>
        <button
          onClick={copy}
          className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-bold text-amber-50 shadow-sm transition-transform hover:scale-105"
        >
          {copied ? '✓ Copied!' : '📋 Copy for WhatsApp'}
        </button>
      </div>

      <p className="text-xs text-amber-900/60">
        <b>Drag</b> a player onto another player to swap, or onto a team card to move —
        or tap a player, then tap a player on another team (tap "move here" to move).
      </p>

      {warnings.length > 0 && (
        <div className="space-y-1 rounded-xl border border-amber-600/50 bg-amber-500/15 px-4 py-2.5 text-sm font-medium text-amber-900">
          {warnings.map((w, i) => (
            <div key={i}>⚠️ {w}</div>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {TEAM_COLORS.map((c) => {
          const m = TEAM_META[c];
          const s = stats[c];
          return (
            <div
              key={c}
              className={`pop-in rounded-2xl border p-3 shadow-lg ${m.card}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dragged = e.dataTransfer.getData('text/plain');
                if (dragged) move(dragged, c);
                setSelected(null);
              }}
            >
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h3 className={`text-lg font-black ${m.header}`}>
                  {m.emoji} {m.label}
                </h3>
                <span className={`text-xs font-semibold ${m.sub}`}>
                  {s.size} players · avg {s.avg.toFixed(1)}
                  {s.gkCount > 1 && ` · ${s.gkCount} 🧤`}
                </span>
              </div>
              <ul className="space-y-1">
                {displayIds(c).map((id) => {
                  const p = byId.get(id);
                  if (!p) return null;
                  const isSel = selected === id;
                  return (
                    <li key={id}>
                      <button
                        onClick={() => clickPlayer(id)}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const dragged = e.dataTransfer.getData('text/plain');
                          if (dragged && dragged !== id) swap(dragged, id);
                          setSelected(null);
                        }}
                        className={`flex w-full cursor-grab items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all active:cursor-grabbing ${m.row} ${
                          isSel ? `ring-2 ${m.ring} scale-[1.02]` : ''
                        }`}
                      >
                        {gkSet.has(id) && <span title="Goalkeeper today">🧤</span>}
                        <Name className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {p.name}
                        </Name>
                        {p.isGuest && (
                          <span
                            className={`text-[10px] font-bold uppercase ${m.sub}`}
                            title={`Guest of ${p.invitedBy ? byId.get(p.invitedBy)?.name : '?'}`}
                          >
                            guest
                          </span>
                        )}
                        <span title={STYLE_META[p.playstyle].label} className="text-xs">
                          {STYLE_META[p.playstyle].icon}
                        </span>
                        <Stars rating={p.rating} unknown={p.ratingUnknown} />
                      </button>
                    </li>
                  );
                })}
                {selected && !teams[c].includes(selected) && (
                  <li>
                    <button
                      onClick={() => moveTo(c)}
                      className={`w-full rounded-lg border border-dashed px-2.5 py-2 text-center text-xs font-bold uppercase tracking-wide opacity-70 hover:opacity-100 ${m.row}`}
                    >
                      ⤵ move here
                    </button>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>

      {rotation && (
        <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
          <h3 className="font-bold text-amber-950">🔁 Rotation plan</h3>
          <p className="mb-3 text-xs text-amber-900/60">
            Short teams are completed by players from the resting team, rotated so it's
            not always the same person.
          </p>
          <ul className="space-y-2">
            {rotation.map((match, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-900/10 bg-white/60 px-4 py-2.5 text-sm"
              >
                <span className="font-bold text-amber-950">
                  {TEAM_META[match.a].emoji} {TEAM_META[match.a].label} vs{' '}
                  {TEAM_META[match.b].emoji} {TEAM_META[match.b].label}
                </span>
                <span className="text-xs text-amber-900/50">
                  {TEAM_META[match.resting].emoji} {TEAM_META[match.resting].label} rests
                </span>
                {match.loans.length > 0 && (
                  <span className="text-orange-700">
                    {match.loans.map((l, j) => (
                      <span key={l.id}>
                        {j > 0 && ', '}
                        <Name className="font-semibold">
                          {byId.get(l.id)?.name ?? '?'}
                        </Name>{' '}
                        joins {TEAM_META[l.to].emoji}
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
