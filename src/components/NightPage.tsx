import { useEffect, useMemo, useRef, useState } from 'react';
import type { FixtureRecord, Player, TeamColor, TonightPlayer } from '../types';
import { TEAM_COLORS } from '../balancer';
import { tonightsMilestones } from '../milestones';
import { duoFacts } from '../duos';
import { nightStory } from '../nightStory';
import type { NightFact } from '../nightStory';
import { recapFacts } from '../recapFacts';
import type { StoredRecap } from '../recap';
import { clearRecap, draftRecap, fetchRecap, saveRecap } from '../recap';
import { Name, TEAM_META, fmtWins } from './ui';
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
  // The organiser writes the recap; everyone else reads whatever was written.
  // `adminWord` is absent for everyone else, which is the whole of the gate.
  adminWord?: string | null;
  // The nights either side of this one, already in date order by the caller.
  // Null at the ends of the archive, which is what greys the arrow out.
  older: FixtureRecord | null;
  newer: FixtureRecord | null;
  onGo: (fixtureId: string) => void;
  onClose: () => void;
}

// One step through the archive. Rendered even when there is nowhere to go, so
// the row does not reflow as you reach either end of the season.
function Step({
  to,
  onGo,
  label,
}: {
  to: FixtureRecord | null;
  onGo: (id: string) => void;
  label: string;
}) {
  return (
    <button
      disabled={!to}
      onClick={() => to && onGo(to.id)}
      title={to ? to.date : 'nothing recorded that way'}
      className="rounded-lg border border-amber-900/25 px-2.5 py-1.5 text-xs font-bold text-amber-900 transition-colors hover:border-orange-500 disabled:opacity-30 disabled:hover:border-amber-900/25"
    >
      {label}
      {to && <span className="ml-1.5 font-mono font-normal text-amber-900/50">{to.date}</span>}
    </button>
  );
}

// One tile per match, coloured by who won it — and because the winner stays
// on, the pitch only changes hands when the colour changes. So a run reads as
// a solid block and a night nobody could hold reads as stripes, which is the
// whole shape of an evening in one line.
//
// This replaced three lanes (one per team, marking won / lost / sat out). That
// version was a presence chart rather than a flow: it took three rows to say
// what one says, and the white team's win tile was cream on a cream page, so
// half the night was invisible. The palette that fixed it is `TEAM_META.tile`
// (see ui.tsx), shared with the fingerprint History draws on every night card.

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

export default function NightPage({
  fixture,
  history,
  players,
  adminWord = null,
  older,
  newer,
  onGo,
  onClose,
}: Props) {
  // Left goes back in time, right comes forward — the arrows point the way the
  // dates run, not the way the list is sorted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && older) onGo(older.id);
      if (e.key === 'ArrowRight' && newer) onGo(newer.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onGo, older, newer]);

  // Stepping to another night must start at the top of it. Without this the
  // overlay keeps the scroll position from the night before, so a short night
  // after a long one opens somewhere in the middle of itself — or, worse, below
  // its own content.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [fixture.id]);

  // The recap belongs to the night rather than to this session, so it is asked
  // for when the page opens and dropped when it closes — including when the
  // page stays open and steps to another night.
  const [saved, setSaved] = useState<StoredRecap | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<'writing' | 'saving' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSaved(null);
    setDraft(null);
    setFailed(null);
    fetchRecap(fixture.id).then((r) => {
      if (!cancelled) setSaved(r);
    });
    return () => {
      cancelled = true;
    };
  }, [fixture.id]);

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

  // Every number the reporter is given, gathered from the same functions this
  // page draws itself from — so the recap can only ever say what the page says.
  const facts = useMemo(
    () => recapFacts(fixture, history, players),
    [fixture, history, players],
  );

  // The reason, verbatim where there is one. A message that covers four
  // different causes with one sentence is a message that costs an evening.
  const say = (error: string, detail?: string) =>
    setFailed(
      error === 'not-configured'
        ? 'No reporter on this deployment: the worker has no GEMINI_KEY set.'
        : error === 'wrong-word'
          ? 'That admin word was refused.'
          : error === 'rate-limited'
            ? 'Too many attempts from here. Give it ten minutes.'
            : error === 'too-many-recaps'
              ? 'That is a dozen reports in an hour. The reporter has gone for a lie down — try again later.'
                : error === 'unavailable'
                  ? `Gemini turned it down${detail ? ` — ${detail}` : ''}`
                  : 'Could not reach the reporter.',
    );

  const write = async () => {
    if (!facts || !adminWord) return;
    setBusy('writing');
    setFailed(null);
    const out = await draftRecap(fixture.id, facts, adminWord);
    setBusy(null);
    if ('error' in out) say(out.error, out.detail);
    else setDraft(out.text);
  };

  const keep = async () => {
    if (!draft || !adminWord) return;
    setBusy('saving');
    const out = await saveRecap(fixture.id, draft, adminWord);
    setBusy(null);
    if ('error' in out) return say(out.error, out.detail);
    setSaved({ text: draft, at: Date.now() });
    setDraft(null);
  };

  const forget = async () => {
    if (!adminWord || !confirm('Delete this recap for everyone?')) return;
    const out = await clearRecap(fixture.id, adminWord);
    if ('error' in out) return say(out.error, out.detail);
    setSaved(null);
  };

  const share = () => {
    const text = `${fixture.date}\n\n${saved?.text ?? draft ?? ''}`;
    if (navigator.share) void navigator.share({ text }).catch(() => {});
    else void navigator.clipboard?.writeText(text);
  };

  const top = Math.max(...TEAM_COLORS.map((c) => fixture.wins[c] ?? 0));
  const winners = TEAM_COLORS.filter((c) => (fixture.wins[c] ?? 0) === top && top > 0);

  return (
    <div ref={scroller} className="fixed inset-0 z-40 overflow-y-auto bg-[#fdf6e3]">
      <div className="mx-auto max-w-3xl space-y-3 px-3 pb-16 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-amber-900/25 px-3 py-1.5 text-sm font-bold text-amber-900 transition-colors hover:border-orange-500"
          >
            ✕ Close
          </button>
          <div className="flex-1" />
          {/* The neighbouring dates are on the buttons rather than under them:
              an arrow that says where it goes needs no explaining, and reading
              a season is mostly checking you have not already seen this one. */}
          <Step to={older} onGo={onGo} label="← older" />
          <Step to={newer} onGo={onGo} label="newer →" />
        </div>

        <div className="rounded-2xl border border-amber-900/15 bg-gradient-to-br from-amber-100/70 via-[#fffdf4] to-[#fffdf4] p-4 shadow-sm">
          {/* The date belongs on the night rather than up in the toolbar: the
              arrows carry their own dates now, and with three of them in one
              row the one you are actually reading was the easiest to lose. */}
          <div className="text-[11px] font-bold uppercase tracking-wide text-amber-900/40">
            {fixture.date}
          </div>
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
                    {TEAM_META[c].emoji} {TEAM_META[c].label}
                    {winners.includes(c) && <span title="Won the night"> 👑</span>} —{' '}
                    {fmtWins(fixture.wins[c] ?? 0)}
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
              {/* No colour key. A black tile is the black team on a page whose
                  own team cards are those three colours — spelling it out was
                  three words explaining something already looked at. The bar
                  is the one mark here that cannot say itself. */}
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-amber-900/35">
                thin bar = who they beat
              </div>
              {/* Sized to be read rather than to fit. These used to share the
                  width so a night never scrolled, and on a phone an 18-match
                  night came out at ~19px a tile: the numbers were unreadable
                  and the runs were slivers. The row scrolls anyway past a
                  dozen matches, so the choice was never scroll-or-not — it was
                  legible-and-scrolling versus tiny-and-scrolling. */}
              {/* Bleeds through the card's padding so a long night scrolls
                  edge to edge instead of inside a narrower window. */}
              <div className="-mx-4 overflow-x-auto px-4 pb-1">
                <div className="flex w-max items-center">
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
                        className={`relative grid h-14 w-11 shrink-0 place-items-center overflow-hidden font-mono text-base font-black ${
                          TEAM_META[m.winner].tile
                        } ${opens ? (i === 0 ? 'rounded-l-xl' : 'ml-2 rounded-l-xl') : ''} ${
                          closes ? 'rounded-r-xl' : ''
                        }`}
                      >
                        {i + 1}
                        {m.viaPenalties && (
                          <span className="absolute right-1 top-0.5 text-[10px] opacity-70">½</span>
                        )}
                        {/* who lost it, in a bar along the bottom — the one
                            thing the winner's colour cannot say on its own */}
                        <span
                          className={`absolute inset-x-0 bottom-0 h-1.5 ${TEAM_META[loser].tile}`}
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
                        {/* who took the night, said on the card as well as in
                            the header — the points are right there beside it,
                            but a crown is read without arithmetic */}
                        {winners.includes(c) && <span title="Won the night"> 👑</span>}
                      </h3>
                      {/* Points, and nothing else. Not wins, so this agrees
                          with the result at the top of the page — a match taken
                          on penalties is worth half (§2.8) — and not `4.5 from
                          12`, because the number beside a team's name on the
                          night they played is the one thing nobody has to be
                          told the meaning of. How many they played is still in
                          the ribbon above, one tile per match. */}
                      <span className={`text-[11px] font-semibold ${TEAM_META[c].sub}`}>
                        {fmtWins(t.points)}
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

        {/* The report. It lives here rather than in a share sheet: the night
            page is where a night is read, and a recap that only exists in
            WhatsApp is gone by Thursday. Sharing is the extra, not the point. */}
        {(saved || draft || (adminWord && facts)) && (
          <section className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h3 className="text-[11px] font-black uppercase tracking-wide text-amber-900/45">
                📰 The report
              </h3>
              {saved && !draft && (
                <span className="text-[10px] text-amber-900/35">
                  written {new Date(saved.at).toLocaleDateString()}
                </span>
              )}
              {draft && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-orange-700/70">
                  draft — nobody else can see this yet
                </span>
              )}
            </div>

            {/* Hebrew, so the block is right-to-left and the paragraphs keep
                their own breaks. `whitespace-pre-wrap` rather than splitting on
                newlines: the model's paragraphing is part of what was written. */}
            {(draft ?? saved?.text) && (
              <p
                dir="rtl"
                className="whitespace-pre-wrap text-[15px] leading-relaxed text-amber-950"
              >
                {draft ?? saved?.text}
              </p>
            )}

            {!draft && !saved && (
              <p className="text-sm text-amber-900/55">
                Nothing written for this night yet.
              </p>
            )}

            {failed && (
              <p className="mt-2 whitespace-pre-wrap break-words text-xs text-red-700">{failed}</p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {(saved || draft) && (
                <button
                  onClick={share}
                  className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                >
                  📤 Share
                </button>
              )}
              {adminWord && facts && (
                <>
                  <button
                    onClick={write}
                    disabled={busy !== null}
                    className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-bold text-amber-50 hover:scale-105 disabled:opacity-50"
                  >
                    {busy === 'writing'
                      ? 'writing…'
                      : saved || draft
                        ? '↻ Write another'
                        : '✍️ Write the report'}
                  </button>
                  {draft && (
                    <>
                      <button
                        onClick={keep}
                        disabled={busy !== null}
                        className="rounded-lg border border-emerald-600/50 px-3 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        {busy === 'saving' ? 'saving…' : '✓ Publish this one'}
                      </button>
                      <button
                        onClick={() => setDraft(null)}
                        className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                      >
                        Discard
                      </button>
                    </>
                  )}
                  {saved && !draft && (
                    <button
                      onClick={forget}
                      className="rounded-lg border border-red-500/50 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                    >
                      🗑️ Delete
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
