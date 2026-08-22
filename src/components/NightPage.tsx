import { useEffect, useMemo } from 'react';
import type { FixtureRecord, Player, TeamColor, TonightPlayer } from '../types';
import { TEAM_COLORS } from '../balancer';
import { tonightsMilestones } from '../milestones';
import { duoFacts } from '../duos';
import { nightStory } from '../nightStory';
import type { NightFact } from '../nightStory';
import { Name, TEAM_META } from './ui';
import { MilestoneStrip } from './TonightFacts';

// One night, read back (§2.22). Opened from a past night in History, the same
// way a roster row opens a player page — an overlay rather than a route,
// because this app has no router and never wanted one.
//
// Everything here is derived at read time from the record and the history
// around it. Nothing is stored: a night whose result is corrected next week
// should tell the corrected story, and a stored summary would quietly go on
// saying the old one.

interface Props {
  fixture: FixtureRecord;
  history: FixtureRecord[];
  players: Player[]; // the roster, only to tell a guest from a squad member
  onClose: () => void;
}

// The lanes read left to right, one column per match. A team's own matches are
// filled when they won and outlined when they lost; the matches they sat out
// are left as a gap, which is what makes the rotation visible — you can see a
// team hold the pitch for five columns, and see who was standing about.
//
// A won cell wears the team's own card palette rather than a colour invented
// here, so the timeline matches every other place the three shirts appear and
// stays contrast-checked with them.
const LOST_CELL = 'border border-amber-900/20 text-amber-900/30';

const factLine = (f: NightFact): string => {
  switch (f.kind) {
    case 'streak-broken':
      return `${TEAM_META[f.by].label} ended ${TEAM_META[f.over].label}'s run of ${f.length}`;
    case 'break-and-run':
      return `${TEAM_META[f.team].label} opened up and stayed on for ${f.through}`;
    case 'perfect':
      return `${TEAM_META[f.team].label} won all ${f.played} they played`;
    case 'blanked':
      return `${TEAM_META[f.team].label} played ${f.played} and won none`;
    case 'heist':
      return `${TEAM_META[f.team].label} won ${f.early} of their first ${f.earlyOf} and ${f.late} of their last ${f.lateOf}`;
    case 'yo-yo':
      return `${TEAM_META[f.team].label} won and lost alternately, ${f.run} deep`;
    case 'shootouts':
      return `${f.count} of them went to penalties`;
  }
};

export default function NightPage({ fixture, history, players, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const story = useMemo(() => nightStory(fixture), [fixture]);
  const log = fixture.matchLog ?? [];
  const nameOf = (id: string) => fixture.players.find((p) => p.id === id)?.name ?? '?';

  // Milestones as they stood *that* night: history up to and including this
  // date, never the nights that came after it. A page about April that counts
  // May is telling you about a tenth night that was already a fifteenth.
  const asOf = useMemo(
    () => history.filter((fx) => fx.date <= fixture.date),
    [history, fixture.date],
  );
  // A fixture record keeps a name and a rating but never a guest flag, so
  // guest-ness is inferred the way guests.ts infers it everywhere else: an id
  // the roster has never heard of. Without it a returning guest would be
  // making their debut on every single night page.
  const tonight: TonightPlayer[] = useMemo(() => {
    const roster = new Set(players.map((p) => p.id));
    return fixture.players.map((p) => ({ id: p.id, name: p.name, isGuest: !roster.has(p.id) }));
  }, [fixture.players, players]);
  const milestones = useMemo(
    () => tonightsMilestones(tonight, asOf, fixture.id),
    [tonight, asOf, fixture.id],
  );
  const duos = useMemo(() => duoFacts(tonight, asOf, fixture.id), [tonight, asOf, fixture.id]);

  const top = Math.max(...TEAM_COLORS.map((c) => fixture.wins[c] ?? 0));
  const winners = TEAM_COLORS.filter((c) => (fixture.wins[c] ?? 0) === top && top > 0);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-[#fdf6e3]">
      <div className="mx-auto max-w-3xl space-y-3 px-3 pb-16 pt-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-amber-900/25 px-3 py-1.5 text-sm font-bold text-amber-900 transition-colors hover:border-orange-500"
          >
            ← Back
          </button>
          <span className="text-sm text-amber-900/50">{fixture.date}</span>
        </div>

        <div className="rounded-2xl border border-amber-900/15 bg-gradient-to-br from-amber-100/70 via-[#fffdf4] to-[#fffdf4] p-4 shadow-sm">
          <h2 className="text-2xl font-black tracking-tight text-amber-950">
            {story ? story.headline : 'The night'}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {winners.length > 0 && (
              <span className="flex items-center gap-1 font-bold text-amber-900">
                🏆
                {winners.map((c) => (
                  <span key={c} className={`rounded-full border px-2 py-0.5 ${TEAM_META[c].card}`}>
                    {TEAM_META[c].label}
                  </span>
                ))}
              </span>
            )}
            {fixture.mvpId && nameOf(fixture.mvpId) !== '?' && (
              <span className="text-amber-900/70">
                🌟 <Name className="font-bold text-amber-950">{nameOf(fixture.mvpId)}</Name>
              </span>
            )}
            <span className="text-amber-900/55">{fixture.players.length} played</span>
          </div>
        </div>

        {/* A night that was tallied from memory has no sequence in it, and the
            page says so rather than rendering empty boxes — the same honesty
            the head-to-head card practises. */}
        {!story ? (
          <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4">
            <p className="text-sm text-amber-900/60">
              This night was tallied at the end rather than logged match by match, so there is no
              sequence to read: the record is three totals. Nights logged as they happen get a
              timeline, a shape and the moments in them.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {TEAM_COLORS.map((c) => (
                <div key={c} className={`rounded-xl border p-2.5 text-xs ${TEAM_META[c].card}`}>
                  <div className={`font-black ${TEAM_META[c].header}`}>
                    {TEAM_META[c].emoji} {TEAM_META[c].label} — {fixture.wins[c] ?? 0}
                  </div>
                  <div className={TEAM_META[c].sub}>
                    {fixture.teams[c].map((id) => nameOf(id)).join(', ') || '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
              <h3 className="mb-2 text-[11px] font-black uppercase tracking-wide text-amber-900/45">
                How it went, match by match
              </h3>
              <div className="overflow-x-auto pb-1">
                <div className="min-w-max space-y-1">
                  {TEAM_COLORS.map((c) => (
                    <div key={c} className="flex items-center gap-1">
                      <span className="w-6 shrink-0 text-sm">{TEAM_META[c].emoji}</span>
                      {log.map((m, i) => {
                        const inIt = m.a === c || m.b === c;
                        const won = m.winner === c;
                        return (
                          <span
                            key={i}
                            title={`Match ${i + 1}: ${TEAM_META[m.winner].label} beat ${
                              TEAM_META[m.winner === m.a ? m.b : m.a].label
                            }${m.viaPenalties ? ' on penalties' : ''}`}
                            className={`grid h-6 w-6 shrink-0 place-items-center rounded font-mono text-[10px] font-black ${
                              !inIt
                                ? 'text-amber-900/15'
                                : won
                                  ? `border ${TEAM_META[c].card}`
                                  : LOST_CELL
                            }`}
                          >
                            {!inIt ? '·' : won ? (m.viaPenalties ? '½' : '✓') : ''}
                          </span>
                        );
                      })}
                    </div>
                  ))}
                  <div className="flex items-center gap-1 pt-0.5">
                    <span className="w-6 shrink-0" />
                    {log.map((_, i) => (
                      <span
                        key={i}
                        className="w-6 shrink-0 text-center font-mono text-[9px] text-amber-900/30"
                      >
                        {(i + 1) % 5 === 0 || i === 0 ? i + 1 : ''}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              {/* The numbers the shape is read from, said plainly. The facts
                  under them are the detectors' output, not a list of moments —
                  one line, the rarest thing that happened. */}
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-amber-900/10 pt-2 text-xs text-amber-900/60">
                <span>
                  <b className="text-amber-900">{story.matches}</b> matches
                </span>
                {story.longest && (
                  <span>
                    longest run <b className="text-amber-900">{story.longest.length}</b>{' '}
                    {TEAM_META[story.longest.team].emoji}
                  </span>
                )}
                <span>
                  lead changed <b className="text-amber-900">{story.leadChanges}</b>×
                </span>
                {story.penalties > 0 && (
                  <span>
                    <b className="text-amber-900">{story.penalties}</b> on penalties
                  </span>
                )}
              </p>
              {story.facts.length > 0 && (
                <p className="mt-1 text-xs font-semibold text-amber-900/75">
                  {factLine(story.facts[0])}
                </p>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {TEAM_COLORS.map((c) => {
                const t = story.teams[c];
                return (
                  <div key={c} className={`rounded-xl border p-2.5 shadow-sm ${TEAM_META[c].card}`}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-x-2 px-0.5">
                      <h3 className={`text-sm font-black ${TEAM_META[c].header}`}>
                        {TEAM_META[c].emoji} {TEAM_META[c].label}
                      </h3>
                      {/* won of played — the pair a tally can never give you: a
                          team on two from two had a different night from one on
                          two from six */}
                      <span className={`text-[11px] font-semibold ${TEAM_META[c].sub}`}>
                        {t.won}/{t.played}
                      </span>
                    </div>
                    <ul dir="rtl" className="flex flex-wrap gap-1">
                      {fixture.teams[c].map((id) => (
                        <li
                          key={id}
                          className={`rounded-md border px-1.5 py-0.5 text-xs font-semibold ${TEAM_META[c].row}`}
                        >
                          <Name>{nameOf(id)}</Name>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* What that night turned out to be for the people in it — the same
            strip the fixture page shows before kick-off, counted as of then. */}
        <MilestoneStrip milestones={milestones} duos={duos} />
      </div>
    </div>
  );
}
