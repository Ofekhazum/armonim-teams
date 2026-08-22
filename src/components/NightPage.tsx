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

// One tile per match, coloured by who won it — and because the winner stays
// on, the pitch only changes hands when the colour changes. So a run reads as
// a solid block and a night nobody could hold reads as stripes, which is the
// whole shape of an evening in one line.
//
// This replaced three lanes (one per team, marking won / lost / sat out). That
// version was a presence chart rather than a flow: it took three rows to say
// what one says, and the white team's win tile was cream on a cream page, so
// half the night was invisible. Hence the deliberately un-subtle palette here
// rather than `TEAM_META.card` — a ribbon tile has to hold its own against the
// tile beside it, where a team card only has to sit on the page.
const RIBBON: Record<TeamColor, { tile: string }> = {
  black: { tile: 'bg-stone-800 text-stone-100' },
  white: { tile: 'bg-white text-amber-950 ring-1 ring-inset ring-amber-900/25' },
  blue: { tile: 'bg-blue-800 text-blue-50' },
};

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
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wide text-amber-900/45">
                {TEAM_COLORS.map((c) => (
                  <span key={c} className="flex items-center gap-1">
                    <span className={`h-2.5 w-2.5 rounded-sm ${RIBBON[c].tile}`} />
                    {TEAM_META[c].label}
                  </span>
                ))}
                <span className="text-amber-900/35">· thin bar = who they beat</span>
              </div>
              {/* The tiles share the width rather than being fixed, so a
                  night fits on a phone without a sideways scroll — the flow is
                  the point, and a flow you have to drag to see is not one.
                  Below ~1.1rem each they stop sharing and the row scrolls,
                  which only a very long night reaches. */}
              <div className="overflow-x-auto pb-1">
                <div className="flex w-full items-center">
                  {log.map((m, i) => {
                    const loser = m.winner === m.a ? m.b : m.a;
                    // a run is one block: no gap inside it, rounded at both
                    // ends, so holding the pitch *looks* like holding the pitch
                    const opens = i === 0 || log[i - 1].winner !== m.winner;
                    const closes = i === log.length - 1 || log[i + 1].winner !== m.winner;
                    return (
                      <span
                        key={i}
                        title={`Match ${i + 1}: ${TEAM_META[m.winner].label} beat ${
                          TEAM_META[loser].label
                        }${m.viaPenalties ? ' on penalties' : ''}`}
                        className={`relative grid h-9 min-w-[1.1rem] flex-1 basis-0 place-items-center overflow-hidden font-mono text-[9px] font-black ${
                          RIBBON[m.winner].tile
                        } ${opens ? (i === 0 ? 'rounded-l-lg' : 'ml-1.5 rounded-l-lg') : ''} ${
                          closes ? 'rounded-r-lg' : ''
                        }`}
                      >
                        {i + 1}
                        {m.viaPenalties && (
                          <span className="absolute right-0.5 top-0 text-[8px] opacity-70">½</span>
                        )}
                        {/* who lost it, in a bar along the bottom — the one
                            thing the winner's colour cannot say on its own */}
                        <span
                          className={`absolute inset-x-0 bottom-0 h-1 ${RIBBON[loser].tile}`}
                        />
                      </span>
                    );
                  })}
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
                      {/* Won of played — the pair a tally can never give you: a
                          team on two from two had a different night from one on
                          two from six. Written out rather than as `2/6`, which
                          reads as a score, a date or a fraction depending on
                          who is looking at it. */}
                      <span className={`text-[11px] font-semibold ${TEAM_META[c].sub}`}>
                        won {t.won} of {t.played}
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
