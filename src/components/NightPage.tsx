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
import { fmtWins, Name, TEAM_META, teamLabel } from './ui';
import { MilestoneStrip } from './TonightFacts';
import NightGrades from './NightGrades';
import { useScrollLock } from '../scrollLock';
import { fmtDate, getLang, t } from '../i18n';

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
      title={to ? to.date : t('np.nothingThatWay')}
      className="rounded-lg border border-amber-900/25 px-2.5 py-1.5 text-xs font-bold text-amber-900 transition-colors hover:border-orange-500 disabled:opacity-30 disabled:hover:border-amber-900/25"
    >
      {label}
      {to && <span className="ms-1.5 font-mono font-normal text-amber-900/50">{to.date}</span>}
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
      return t('np.fact.streakBroken', {
        by: teamLabel(f.by),
        over: teamLabel(f.over),
        n: f.length,
      });
    case 'break-and-run':
      return t('np.fact.breakAndRun', { team: teamLabel(f.team), n: f.through });
    case 'perfect':
      return t('np.fact.perfect', { team: teamLabel(f.team), n: f.played });
    case 'blanked':
      return t('np.fact.blanked', { team: teamLabel(f.team), n: f.played });
    case 'heist':
      return t('np.fact.heist', {
        team: teamLabel(f.team),
        early: f.early,
        earlyOf: f.earlyOf,
        late: f.late,
        lateOf: f.lateOf,
      });
    case 'yo-yo':
      return t('np.fact.yoYo', { team: teamLabel(f.team), n: f.run });
    case 'shootouts':
      return t('np.fact.shootouts', { n: f.count });
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

  // The page behind stays put while this is open — see scrollLock.ts for what
  // happens on a phone when it doesn't.
  useScrollLock();

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
        ? t('np.report.err.notConfigured')
        : error === 'wrong-word'
          ? t('marks.err.wrongWord')
          : error === 'rate-limited'
            ? t('marks.err.rateLimited')
            : error === 'too-many-recaps'
              ? t('np.report.err.tooMany')
              : error === 'unavailable'
                ? `${t('marks.err.unavailable')}${detail ? ` — ${detail}` : ''}`
                : t('np.report.err.unreachable'),
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
    if (!adminWord || !confirm(t('np.report.deleteConfirm'))) return;
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
    <div ref={scroller} className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-[#fdf6e3]">
      <div className="mx-auto max-w-3xl space-y-3 px-3 pb-16 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-amber-900/25 px-3 py-1.5 text-sm font-bold text-amber-900 transition-colors hover:border-orange-500"
          >
            {t('np.close')}
          </button>
          <div className="flex-1" />
          {/* The neighbouring dates are on the buttons rather than under them:
              an arrow that says where it goes needs no explaining, and reading
              a season is mostly checking you have not already seen this one. */}
          <Step to={older} onGo={onGo} label={t('np.older')} />
          <Step to={newer} onGo={onGo} label={t('np.newer')} />
        </div>

        <div className="rounded-2xl border border-amber-900/15 bg-gradient-to-br from-amber-100/70 via-[#fffdf4] to-[#fffdf4] p-4 shadow-sm">
          {/* The date belongs on the night rather than up in the toolbar: the
              arrows carry their own dates now, and with three of them in one
              row the one you are actually reading was the easiest to lose. */}
          <div className="text-[11px] font-bold uppercase tracking-wide text-amber-900/40">
            {fixture.date}
          </div>
          <h2 className="text-2xl font-black tracking-tight text-amber-950">
            {story ? t(story.headlineKey) : t('np.headline')}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {winners.length > 0 && (
              <span className="flex items-center gap-1 font-bold text-amber-900">
                🏆
                {winners.map((c) => (
                  <span key={c} className={`rounded-full border px-2 py-0.5 ${TEAM_META[c].card}`}>
                    {teamLabel(c)}
                  </span>
                ))}
              </span>
            )}
            {fixture.mvpId && nameOf(fixture.mvpId) !== '?' && (
              <span className="text-amber-900/70">
                🌟 <Name className="font-bold text-amber-950">{nameOf(fixture.mvpId)}</Name>
              </span>
            )}
            <span className="text-amber-900/55">
              {t('np.played', { n: fixture.players.length })}
            </span>
          </div>
        </div>

        {/* A night that was tallied from memory has no sequence in it, and the
            page says so rather than rendering empty boxes — the same honesty
            the head-to-head card practises. */}
        {!story ? (
          <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4">
            <p className="text-sm text-amber-900/60">
              {t('np.tallied')}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {TEAM_COLORS.map((c) => (
                <div key={c} className={`rounded-xl border p-2.5 text-xs ${TEAM_META[c].card}`}>
                  <div className={`font-black ${TEAM_META[c].header}`}>
                    {TEAM_META[c].emoji} {teamLabel(c)}
                    {winners.includes(c) && <span title={t('np.wonTheNight')}> 👑</span>} —{' '}
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
                {t('np.matchByMatch')}
              </h3>
              {/* No colour key. A black tile is the black team on a page whose
                  own team cards are those three colours — spelling it out was
                  three words explaining something already looked at. The bar
                  is the one mark here that cannot say itself. */}
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-amber-900/35">
                {t('np.thinBar')}
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
                    // A run is one block: no gap inside it, rounded at both
                    // ends, so holding the pitch *looks* like holding the
                    // pitch.
                    //
                    // Logical sides rather than left/right. A run opens at the
                    // end the reader starts from, which is the right in Hebrew
                    // — with `rounded-l`/`ml-2` the rounding and the gap both
                    // landed on the far end instead, which split a run down
                    // the middle and welded it to the one before it.
                    const opens = i === 0 || log[i - 1].winner !== m.winner;
                    const closes = i === log.length - 1 || log[i + 1].winner !== m.winner;
                    return (
                      <span
                        key={i}
                        title={`${t('np.matchTitle', {
                          n: i + 1,
                          winner: teamLabel(m.winner),
                          loser: teamLabel(loser),
                        })}${m.viaPenalties ? t('np.matchTitle.pens') : ''}`}
                        className={`relative grid h-14 w-11 shrink-0 place-items-center overflow-hidden font-mono text-base font-black ${
                          TEAM_META[m.winner].tile
                        } ${opens ? (i === 0 ? 'rounded-s-xl' : 'ms-2 rounded-s-xl') : ''} ${
                          closes ? 'rounded-e-xl' : ''
                        }`}
                      >
                        {i + 1}
                        {m.viaPenalties && (
                          <span className="absolute end-1 top-0.5 text-[10px] opacity-70">½</span>
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
                  <b className="text-amber-900">{story.matches}</b> {t('np.matches')}
                </span>
                {story.longest && (
                  <span>
                    {t('np.longestRun')} <b className="text-amber-900">{story.longest.length}</b>{' '}
                    {TEAM_META[story.longest.team].emoji}
                  </span>
                )}
                <span>
                  {t('np.leadChanged')} <b className="text-amber-900">{story.leadChanges}</b>×
                </span>
                {story.penalties > 0 && (
                  <span>
                    <b className="text-amber-900">{story.penalties}</b> {t('np.onPenalties')}
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
                const tn = story.teams[c];
                return (
                  <div key={c} className={`rounded-xl border p-2.5 shadow-sm ${TEAM_META[c].card}`}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-x-2 px-0.5">
                      <h3 className={`text-sm font-black ${TEAM_META[c].header}`}>
                        {TEAM_META[c].emoji} {teamLabel(c)}
                        {/* who took the night, said on the card as well as in
                            the header — the points are right there beside it,
                            but a crown is read without arithmetic */}
                        {winners.includes(c) && <span title={t('np.wonTheNight')}> 👑</span>}
                      </h3>
                      {/* Points, and nothing else. Not wins, so this agrees
                          with the result at the top of the page — a match taken
                          on penalties is worth half (§2.8) — and not `4.5 from
                          12`, because the number beside a team's name on the
                          night they played is the one thing nobody has to be
                          told the meaning of. How many they played is still in
                          the ribbon above, one tile per match. */}
                      <span className={`text-[11px] font-semibold ${TEAM_META[c].sub}`}>
                        {fmtWins(tn.points)}
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
                {t('np.report.title')}
              </h3>
              {saved && !draft && (
                <span className="text-[10px] text-amber-900/35">
                  {t('np.report.written', { date: fmtDate(saved.at, getLang(), {}) })}
                </span>
              )}
              {draft && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-orange-700/70">
                  {t('np.report.draft')}
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
                {t('np.report.nothing')}
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
                  {t('np.report.share')}
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
                      ? t('np.report.writing')
                      : saved || draft
                        ? t('np.report.writeAnother')
                        : t('np.report.write')}
                  </button>
                  {draft && (
                    <>
                      <button
                        onClick={keep}
                        disabled={busy !== null}
                        className="rounded-lg border border-emerald-600/50 px-3 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        {busy === 'saving' ? t('np.report.saving') : t('np.report.publish')}
                      </button>
                      <button
                        onClick={() => setDraft(null)}
                        className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                      >
                        {t('np.report.discard')}
                      </button>
                    </>
                  )}
                  {saved && !draft && (
                    <button
                      onClick={forget}
                      className="rounded-lg border border-red-500/50 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                    >
                      {t('np.report.delete')}
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* Everyone's personal verdict on the night just told above it — last
            on the page, deliberately: the story comes first, the marks come
            after. See NightGrades.tsx for why they are grouped by shirt
            rather than one ranked list of fifteen friends. */}
        <NightGrades fixture={fixture} history={history} players={players} adminWord={adminWord} />
      </div>
    </div>
  );
}
