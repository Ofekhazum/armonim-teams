import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Player, TeamColor, Teams } from '../types';
import { roleBadge } from '../types';
import {
  FULL_TEAM,
  TEAM_COLORS,
  glueViolations,
  lineupOrder,
  planRotation,
  teamStats,
} from '../balancer';
import { Name, STYLE_ICON, styleLabel, TEAM_META, teamLabel } from './ui';
import { getLang, t } from '../i18n';
import { shareTeamsShirtImages } from '../shirtImage';

interface Props {
  teams: Teams;
  players: Player[];
  gkIds: string[];
  onTeamsChange: (teams: Teams) => void;
  onReroll?: () => void;
  rerollLabel?: string;
  // omitted entirely for the read/drag-only guest view of a live room
  onBack?: () => void;
  onNewFixture?: () => void;
  onStartFixture?: () => void;
  // live room only: briefly rings the row(s) a remote change just moved, in
  // the mover's identity color
  highlight?: { ids: string[]; color: string } | null;
  // admin-only extras (who prefers to be kept apart). Off by default so the
  // guest view of a live room can never leak them.
  showPrivateNotes?: boolean;
}

export default function TeamsBoard({
  teams,
  players,
  gkIds,
  onTeamsChange,
  onReroll,
  rerollLabel,
  onBack,
  onNewFixture,
  onStartFixture,
  highlight,
  showPrivateNotes = false,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sharingImages, setSharingImages] = useState(false);

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
        t('board.warn.keepers', {
          emoji: TEAM_META[c].emoji,
          team: teamLabel(c),
          n: stats[c].gkCount,
        }),
      );
  }
  for (const g of glued) {
    const inviter = g.invitedBy ? byId.get(g.invitedBy)?.name : '';
    warnings.push(t('board.warn.guest', { name: g.name, inviter: inviter ?? '' }));
  }
  // Who'd rather not be paired up is private — never surfaced on a board that
  // guests can see (a shared live room renders this same component).
  if (showPrivateNotes) {
    for (const p of players) {
      for (const otherId of p.avoid ?? []) {
        if (p.id < otherId && byId.has(otherId) && teamOf(p.id) === teamOf(otherId)) {
          warnings.push(t('board.warn.avoid', { a: p.name, b: byId.get(otherId)!.name }));
        }
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
  const displayIds = (c: TeamColor) => lineupOrder(teams[c], byId, gkSet);

  const shareText = () => {
    const NAMED: Record<TeamColor, string> = {
      black: t('board.share.team.black'),
      white: t('board.share.team.white'),
      blue: t('board.share.team.blue'),
    };
    const HEART: Record<TeamColor, string> = { black: '🖤', white: '🤍', blue: '💙' };
    // Forces RTL rendering per line when pasted as plain text (e.g. WhatsApp).
    // Only in Hebrew: prefixed to an English line it flips the paragraph the
    // wrong way, which is the very bug it exists to fix.
    const RLM = getLang() === 'he' ? '‏' : '';
    const lines: string[] = [];
    for (const c of TEAM_COLORS) {
      lines.push(`${HEART[c]} ${NAMED[c]} ${HEART[c]}`);
      for (const id of displayIds(c)) {
        const p = byId.get(id);
        if (!p) continue;
        lines.push(`  • ${p.name}`);
      }
      lines.push('');
    }
    const totalAssigned = TEAM_COLORS.reduce((sum, c) => sum + teams[c].length, 0);
    if (rotation && totalAssigned >= 15) {
      lines.push(t('board.share.rotation'));
      for (const m of rotation) {
        const base = t('board.share.rotation.line', {
          a: HEART[m.a],
          b: HEART[m.b],
          resting: HEART[m.resting],
        });
        const loans = m.loans
          .map((l) =>
            t('board.share.rotation.joins', {
              name: byId.get(l.id)?.name ?? '?',
              team: NAMED[l.to],
            }),
          )
          .join(', ');
        lines.push(loans ? `${base}; ${loans}` : base);
      }
      lines.push('');
    }
    return lines.map((line) => (line ? RLM + line : line)).join('\n');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt(t('board.copy.prompt'), shareText());
    }
  };

  const shareImages = async () => {
    setSharingImages(true);
    const result = await shareTeamsShirtImages({
      teams,
      byId,
      gkIds: gkSet,
      date: new Date().toISOString().slice(0, 10),
    });
    setSharingImages(false);
    if (result === 'failed') alert(t('board.shareImages.failed'));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {onBack && (
          <button
            onClick={onBack}
            className="rounded-xl border border-amber-900/30 px-4 py-2 text-sm font-semibold text-amber-900"
          >
            {t('board.back')}
          </button>
        )}
        {onReroll && (
          <button
            onClick={onReroll}
            className="rounded-xl border border-amber-900/30 px-4 py-2 text-sm font-semibold text-amber-900 hover:border-orange-500"
          >
            🎲 {rerollLabel ?? t('board.reroll')}
          </button>
        )}
        {onNewFixture && (
          <button
            onClick={() => {
              if (confirm(t('board.newFixture.confirm'))) {
                onNewFixture();
              }
            }}
            className="rounded-xl border border-amber-900/30 px-4 py-2 text-sm font-semibold text-amber-900 hover:border-orange-500"
          >
            {t('board.newFixture')}
          </button>
        )}
        <div className="flex-1" />
        {/* The balance gap is the difference between those same averages, so it
            hides with them — a guest told the gap is 0.60 has been told what
            the ratings say, just arithmetically. */}
        {showPrivateNotes && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              spread <= 0.35
                ? 'bg-green-600/15 text-green-800'
                : spread <= 0.7
                  ? 'bg-amber-500/25 text-amber-900'
                  : 'bg-red-600/15 text-red-800'
            }`}
            title={t('board.balance.title')}
          >
            {t('board.balance', { n: spread.toFixed(2) })}
          </span>
        )}
        <button
          onClick={shareImages}
          disabled={sharingImages}
          className="rounded-xl border border-amber-900/30 px-4 py-2 text-sm font-semibold text-amber-900 hover:border-orange-500 disabled:opacity-50"
          title={t('board.shareImages.title')}
        >
          {sharingImages ? '…' : t('board.shareImages')}
        </button>
        <button
          onClick={copy}
          className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-bold text-amber-50 shadow-sm transition-transform hover:scale-105"
        >
          {copied ? t('board.copied') : t('board.copy')}
        </button>
        {onStartFixture && (
          <button
            onClick={onStartFixture}
            className="rounded-xl bg-green-700 px-4 py-2 text-sm font-bold text-amber-50 shadow-sm transition-transform hover:scale-105"
          >
            {t('board.start')}
          </button>
        )}
      </div>

      <p className="text-xs text-amber-900/60">{t('board.help')}</p>

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
              <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 px-1">
                <h3 className={`flex items-center gap-1 text-lg font-black ${m.header}`}>
                  {m.emoji} {teamLabel(c)}
                  <select
                    value=""
                    onChange={(e) => {
                      const target = e.target.value as TeamColor;
                      if (!target) return;
                      onTeamsChange({ ...teams, [c]: teams[target], [target]: teams[c] });
                    }}
                    title={t('board.swapColor.title')}
                    className="rounded bg-black/10 px-1 py-0.5 text-xs font-bold"
                  >
                    <option value="">🔀</option>
                    {TEAM_COLORS.filter((x) => x !== c).map((x) => (
                      <option key={x} value={x}>
                        ⇄ {TEAM_META[x].emoji} {teamLabel(x)}
                      </option>
                    ))}
                  </select>
                </h3>
                {/* The average is a rating average, and ratings are the
                    organiser's private opinion of people (§2.9) — so it goes
                    behind the same flag the keep-apart notes are behind. A
                    live-room guest renders this same board and gets the count
                    only, which is the part that is a fact about tonight. */}
                <span className={`text-xs font-semibold ${m.sub}`}>
                  {t('board.size', { n: s.size })}
                  {showPrivateNotes && t('board.avg', { n: s.avg.toFixed(1) })}
                  {s.gkCount > 1 && t('board.gkCount', { n: s.gkCount })}
                </span>
              </div>
              <ul className="space-y-1">
                {displayIds(c).map((id) => {
                  const p = byId.get(id);
                  if (!p) return null;
                  const isSel = selected === id;
                  const isMoved = !!highlight?.ids.includes(id);
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
                        dir="rtl"
                        style={isMoved ? ({ '--flash-color': highlight!.color } as CSSProperties) : undefined}
                        className={`flex w-full cursor-grab items-center gap-2 rounded-lg border px-2.5 py-2 transition-all active:cursor-grabbing ${m.row} ${
                          isSel ? `ring-2 ${m.ring} scale-[1.02]` : ''
                        } ${isMoved ? 'flash-ring' : ''}`}
                      >
                        {gkSet.has(id) && <span title={t('board.gkToday')}>🧤</span>}
                        <Name className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {p.name}
                        </Name>
                        {p.isGuest && (
                          <span
                            className={`text-[10px] font-bold uppercase ${m.sub}`}
                            title={t('board.guestOf', {
                              name: (p.invitedBy ? byId.get(p.invitedBy)?.name : '?') ?? '?',
                            })}
                          >
                            {t('board.guest')}
                          </span>
                        )}
                        <span title={styleLabel(roleBadge(p))} className="text-xs">
                          {STYLE_ICON[roleBadge(p)]}
                        </span>
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
                      {t('board.moveHere')}
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
          <h3 className="font-bold text-amber-950">{t('board.rotation.title')}</h3>
          <p className="mb-3 text-xs text-amber-900/60">{t('board.rotation.hint')}</p>
          <ul className="space-y-2">
            {rotation.map((match, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-900/10 bg-white/60 px-4 py-2.5 text-sm"
              >
                <span className="font-bold text-amber-950">
                  {TEAM_META[match.a].emoji} {teamLabel(match.a)} {t('board.rotation.vs')}{' '}
                  {TEAM_META[match.b].emoji} {teamLabel(match.b)}
                </span>
                <span className="text-xs text-amber-900/50">
                  {t('board.rotation.rests', {
                    emoji: TEAM_META[match.resting].emoji,
                    team: teamLabel(match.resting),
                  })}
                </span>
                {match.loans.length > 0 && (
                  <span className="text-orange-700">
                    {match.loans.map((l, j) => (
                      <span key={l.id}>
                        {j > 0 && ', '}
                        <Name className="font-semibold">
                          {byId.get(l.id)?.name ?? '?'}
                        </Name>{' '}
                        {t('board.rotation.joins', { emoji: TEAM_META[l.to].emoji })}
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
