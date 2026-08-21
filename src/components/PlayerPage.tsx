import { useEffect, useMemo } from 'react';
import type { FixtureRecord, Player, TeamColor } from '../types';
import { roleBadge } from '../types';
import { TEAM_COLORS } from '../balancer';
import { playerAchievements } from '../achievements';
import { computeDuoRecords, MIN_TOGETHER } from '../duos';
import {
  MIN_PROFILE_NIGHTS,
  nightRungs,
  profileCounts,
  profileNights,
  shirtNights,
  shootoutRecord,
  toGo,
  winRungs,
} from '../playerProfile';
import { Name, STYLE_META, TEAM_META } from './ui';

// One player's page (§2.19). Everything on it is counted from history — the
// same nights the standings table and the badges are built from — so nothing
// here needed new data, only gathering.
//
// Deliberately has no organiser half. Ratings, the attack spectrum and the
// keep-apart list are the organiser's working notes about a person, and this
// is the most screenshot-able page in the app; they stay on the roster row and
// in the edit form, behind admin, where they already were. ✏️ Edit reaches
// them for an admin, so nothing was taken away.

interface Props {
  player: Player;
  history: FixtureRecord[];
  players: Player[];
  isAdmin: boolean;
  onEdit: () => void;
  onClose: () => void;
}

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
    <h3 className="mb-2 text-sm font-bold text-amber-950">{title}</h3>
    {children}
  </section>
);

const Stat = ({ n, label }: { n: string; label: string }) => (
  // a floor rather than min-w-0: five tiles that all shrink stay on one line
  // and squeeze the labels to nothing, where five that refuse to go below ~5rem
  // wrap to 3 + 2 on a phone and stay readable
  <div className="min-w-[4.75rem] flex-1 rounded-xl bg-white/60 px-2 py-2 text-center">
    <div className="font-mono text-xl font-black leading-none text-amber-950">{n}</div>
    <div className="mt-1 text-[11px] font-semibold leading-tight text-amber-900/60">{label}</div>
  </div>
);

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function PlayerPage({
  player,
  history,
  players,
  isAdmin,
  onEdit,
  onClose,
}: Props) {
  // same escape hatch as pitch mode — a full-screen panel that can only be
  // left by finding one small button is a panel people feel stuck in
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const nights = useMemo(() => profileNights(history, player.id), [history, player.id]);
  const counts = useMemo(() => profileCounts(nights), [nights]);
  const shirts = useMemo(() => shirtNights(nights), [nights]);
  const shootouts = useMemo(() => shootoutRecord(history, player.id), [history, player.id]);
  // one call, two answers: the badge row, and the MVP tally underneath it —
  // playerAchievements already counts the picks while deciding who tops that
  // column, and counting them twice is how two numbers end up disagreeing
  const record = useMemo(() => playerAchievements(history).get(player.id), [history, player.id]);
  const badges = record?.achievements ?? [];
  const mvps = record?.mvps ?? 0;

  // Best and worst teammate, from the shrunk duo records (§2.10) — so four
  // nights at 100% doesn't get printed as a fact about a friendship.
  const duos = useMemo(() => {
    const ids = new Set(players.map((p) => p.id));
    ids.add(player.id);
    const nameOf = new Map(players.map((p) => [p.id, p.name]));
    return computeDuoRecords(history, ids, nameOf, player.id);
  }, [history, players, player.id]);

  // whichever half of the pair isn't the player whose page this is
  const other = (d: { aId: string; aName: string; bName: string }) =>
    d.aId === player.id ? d.bName : d.aName;

  const nightLadder = nightRungs(counts.nights);
  const winLadder = winRungs(counts.wins);
  const nextNight = toGo(nightLadder, counts.nights);
  const nextWin = toGo(winLadder, counts.wins);

  const enoughLogged = shootouts.loggedNights >= MIN_PROFILE_NIGHTS;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-[#fdf6e3]">
      <div className="mx-auto max-w-3xl space-y-3 px-3 pb-16 pt-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-amber-900/25 px-3 py-1.5 text-sm font-bold text-amber-900 hover:border-orange-500"
          >
            ← Back
          </button>
          <div className="flex-1" />
          {isAdmin && (
            <button
              onClick={onEdit}
              className="rounded-lg border border-amber-900/25 px-3 py-1.5 text-sm font-bold text-amber-900 hover:border-orange-500"
            >
              ✏️ Edit
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-2xl font-black text-amber-950">
            <Name>{player.name}</Name>
          </h2>
          {player.number !== undefined && (
            <span className="font-mono text-lg font-bold text-amber-900/40">#{player.number}</span>
          )}
          <span title={STYLE_META[roleBadge(player)].label} className="text-lg">
            {STYLE_META[roleBadge(player)].icon}
          </span>
          {player.isGuest && <span className="text-xs font-bold text-amber-900/50">guest</span>}
        </div>

        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {badges.map((b) => (
              <span
                key={b.kind}
                title={b.label}
                className="rounded-full border border-amber-900/15 bg-white/70 px-2.5 py-1 text-xs font-semibold text-amber-900"
              >
                {b.icon} {b.label}
              </span>
            ))}
          </div>
        )}

        {counts.onSheet === 0 ? (
          <Card title="No football yet">
            <p className="text-sm text-amber-900/60">
              Nothing to count — this player hasn't been on a recorded team sheet.
            </p>
          </Card>
        ) : (
          <>
            {/* Four tiles have to survive a narrow phone, so the labels stay
                one or two short words and the "not enough football yet" case is
                a dash plus a line underneath — not a label long enough to
                reflow the whole row. */}
            <div className="flex flex-wrap gap-2">
              <Stat n={String(counts.nights)} label="nights" />
              <Stat n={String(counts.nightsWon)} label="nights won" />
              <Stat n={fmt(counts.wins)} label="match wins" />
              <Stat
                n={counts.perNight === null ? '–' : counts.perNight.toFixed(1)}
                label="per night"
              />
              {/* No threshold on this one, unlike the rate beside it: a pick is
                  a thing that either happened or didn't, and "0" is the true
                  answer rather than a small sample of one. Shown for everybody
                  so a zero is legible as none rather than as untracked. */}
              <Stat n={String(mvps)} label={mvps === 1 ? 'MVP night' : 'MVP nights'} />
            </div>
            {counts.perNight === null && (
              <p className="-mt-1 text-xs text-amber-900/50">
                Wins per night appears after {MIN_PROFILE_NIGHTS} nights — fewer than that, the
                number moves too much to mean anything.
              </p>
            )}

            <Card title="🗓️ Every night">
              {/* Turning up is half of what this ribbon is a picture of, so a
                  night with no result recorded is drawn as its own thing
                  rather than folded in with the losses. */}
              <div className="flex flex-wrap gap-1">
                {nights.map((n) => (
                  <span
                    key={n.fixtureId}
                    title={`${n.date} — ${TEAM_META[n.shirt].label}${
                      n.won === null
                        ? ', no result recorded'
                        : n.won
                          ? `, won the night (${fmt(n.wins)})`
                          : `, ${fmt(n.wins)} wins`
                    }`}
                    className={`grid h-7 w-7 place-items-center rounded-md text-[11px] font-black ${
                      n.won === null
                        ? 'bg-amber-900/[0.06] text-amber-900/35'
                        : n.won
                          ? 'bg-orange-500/20 text-orange-800 ring-1 ring-orange-500/40'
                          : 'bg-amber-900/[0.06] text-amber-900/50'
                    }`}
                  >
                    {n.won === null ? '·' : n.won ? 'W' : '–'}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-amber-900/50">
                Oldest first. <b>W</b> is a night their team finished top.
                {counts.bestRun >= 2 && (
                  <>
                    {' '}
                    Longest run of winning nights: <b>{counts.bestRun}</b>
                    {counts.currentRun >= 2 && <> · on <b>{counts.currentRun}</b> right now</>}.
                  </>
                )}
              </p>
            </Card>

            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="🪜 Milestones">
                <div className="space-y-2 text-sm">
                  <Ladder
                    rungs={nightLadder}
                    unit="nights"
                    next={nextNight}
                    count={counts.nights}
                  />
                  <Ladder rungs={winLadder} unit="wins" next={nextWin} count={counts.wins} />
                </div>
              </Card>

              <Card title="👕 Shirts worn">
                <div className="space-y-1.5">
                  {TEAM_COLORS.map((c: TeamColor) => (
                    <div key={c} className="flex items-center gap-2 text-sm">
                      <span className="w-24 shrink-0 font-semibold text-amber-950">
                        {TEAM_META[c].emoji} {TEAM_META[c].label}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-amber-900/10">
                        <div
                          className="h-full rounded-full bg-orange-500/60"
                          style={{
                            width: `${counts.onSheet ? (shirts[c] / counts.onSheet) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span className="w-6 text-right font-mono text-xs font-bold text-amber-900/60">
                        {shirts[c]}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="🤝 Teammates">
                {duos.best || duos.worst ? (
                  <div className="space-y-1.5 text-sm text-amber-950">
                    {duos.best && (
                      <div>
                        Best with <Name className="font-bold">{other(duos.best)}</Name> —{' '}
                        <b>{duos.best.won}</b> of <b>{duos.best.together}</b> nights together
                      </div>
                    )}
                    {duos.worst && (
                      <div className="text-amber-900/70">
                        Leanest with <Name className="font-bold">{other(duos.worst)}</Name> —{' '}
                        <b>{duos.worst.won}</b> of <b>{duos.worst.together}</b>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-amber-900/60">
                    Needs {MIN_TOGETHER} nights alongside the same player before a pair says
                    anything.
                  </p>
                )}
              </Card>

              <Card title="🎯 Shootouts">
                {enoughLogged ? (
                  <div className="text-sm text-amber-950">
                    Their teams won <b>{shootouts.taken}</b> on penalties and{' '}
                    <b>{shootouts.wonInPlay}</b> before it got that far.
                    <p className="mt-1 text-xs text-amber-900/50">
                      From the {shootouts.loggedNights} nights logged match by match.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-amber-900/60">
                    Only nights logged match by match can answer this —{' '}
                    {shootouts.loggedNights} so far, {MIN_PROFILE_NIGHTS} needed.
                  </p>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Ladder({
  rungs,
  unit,
  next,
  count,
}: {
  rungs: { target: number; reached: boolean }[];
  unit: string;
  next: { target: number; away: number } | null;
  count: number;
}) {
  const reached = rungs.filter((r) => r.reached);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        {reached.map((r) => (
          <span
            key={r.target}
            className="rounded-full bg-orange-500/15 px-2 py-0.5 text-xs font-bold text-orange-800"
          >
            {r.target} {unit}
          </span>
        ))}
        {reached.length === 0 && (
          <span className="text-xs text-amber-900/50">no {unit} milestone yet</span>
        )}
      </div>
      {next && (
        <p className="mt-1 text-xs text-amber-900/60">
          <b>{next.away}</b> to go until {next.target} {unit} — at {Math.floor(count)} now.
        </p>
      )}
    </div>
  );
}
