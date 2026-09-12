import { useEffect, useMemo, useState } from 'react';
import type { FixtureRecord, Player } from '../types';
import { suggestRatings } from '../calibration';
import { RATING_PANEL_READY } from '../ratingPanel';
import { buildWrapped, periodLabel, wrappedPeriods } from '../wrapped';
import { announceMonth, clearMonth, fetchAwards, type Awards } from '../awards';
import { shareWrappedImage } from '../wrappedImage';
import { fetchAllMarks } from '../gradesApi';
import type { AllMarks } from '../gradeHistory';
import { fmtRating, fmtWins, Name, Section } from './ui';
import AlertsCheck from './AlertsCheck';
import PostMortem from './PostMortem';
import { fmtDate, getLang, t } from '../i18n';

/**
 * The organiser's workbench (§2.55).
 *
 * **What belongs here and what does not.** The dividing line is whether a
 * control acts on the thing you are looking at, or is a tool you go somewhere
 * to use. Editing a night belongs in the night's own drawer, editing a player
 * belongs on the roster, ending a live fixture belongs on the live tab — move
 * any of those here and using them means navigating away and back. What is
 * here instead are the four jobs that have no "thing you are looking at": the
 * monthly recap, Team of the Month, the balance analysis, and the alerts
 * check. All four used to be folded panels on the Club tab, which meant an
 * organiser's once-a-month tooling sat permanently between the club and its
 * own statistics.
 *
 * **The page is the gate.** There is no `isAdmin` check inside this file, and
 * there should not be: App.tsx only renders the tab, and only offers the tab,
 * when admin is unlocked. A component that re-checks the same thing its parent
 * already checked invites the reader to wonder which of the two is the real
 * gate.
 *
 * `adminWord` is the word itself rather than a flag, because three of the four
 * panels here are guarded *writes* on the Worker — registering a month,
 * clearing one, buzzing a phone — not locally hidden buttons.
 */
interface Props {
  history: FixtureRecord[];
  players: Player[];
  adminWord: string;
  onApplyRating: (playerId: string, rating: number) => void;
}

export default function AdminTools({ history, players, adminWord, onApplyRating }: Props) {
  const periods = useMemo(() => wrappedPeriods(history), [history]);
  const [wrappedPeriod, setWrappedPeriod] = useState('');
  const [sharingWrapped, setSharingWrapped] = useState(false);
  // What has been registered, and which month is mid-write. Read once when an
  // organiser opens the page — an award is a record rather than a calculation,
  // so the only way to know is to ask (§2.25).
  const [awards, setAwards] = useState<Awards>({});
  const [busyMonth, setBusyMonth] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchAwards().then((a) => live && setAwards(a));
    return () => {
      live = false;
    };
  }, []);

  // Published grades for the whole club, the same call PlayerPage makes for
  // its graph — the recap's grade-based banter stats (Teacher's Pet, Punching
  // Bag, the Rollercoaster) read from this. `{}` on any failure just means
  // those three stats say nothing, same as a club that hasn't graded a month
  // yet.
  const [marks, setMarks] = useState<AllMarks>({});
  useEffect(() => {
    let live = true;
    fetchAllMarks(history).then((all) => {
      if (live) setMarks(all);
    });
    return () => {
      live = false;
    };
  }, [history]);

  // Re-read rather than patch the copy in state. One extra request, and it is
  // the difference between the panel showing what is stored and the panel
  // showing what we believe we stored.
  const afterWrite = async (ok: boolean) => {
    if (ok) setAwards(await fetchAwards());
    setBusyMonth(null);
  };

  // periods only appear once a month's first night is saved — pick the newest
  // as soon as one shows up, rather than leaving the picker on nothing
  useEffect(() => {
    if (!wrappedPeriod && periods.length > 0) setWrappedPeriod(periods[0]);
  }, [periods, wrappedPeriod]);

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const suggestions = useMemo(
    () => suggestRatings(history, players).filter((s) => !dismissed.has(s.id)),
    [history, players, dismissed],
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-black text-amber-950">{t('tools.title')}</h2>
        <p className="max-w-2xl text-sm text-amber-900/60">{t('tools.intro')}</p>
      </div>

      {/* The recap is a produced thing — a shareable image the organiser sends
          out when a month is done, complete with the banter records.

          The one panel here that does not fold, and the exception is the point:
          it is already only two controls wide, so folding it would hide a month
          picker and a button behind a heading roughly their own size. Nothing
          is saved, and a fold that saves nothing is just a tap. Everything
          below this is a panel deep enough for the fold to earn its place. */}
      {periods.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-3 shadow-sm">
          <span className="text-sm font-bold text-amber-950">{t('tools.recap.title')}</span>
          <select
            value={wrappedPeriod}
            onChange={(e) => setWrappedPeriod(e.target.value)}
            className="rounded-lg border border-amber-900/25 bg-white px-2 py-1.5 text-sm font-semibold text-amber-950 outline-none focus:border-orange-500"
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </select>
          <button
            onClick={async () => {
              if (!wrappedPeriod) return;
              setSharingWrapped(true);
              // shirt numbers live on the roster, never in a fixture record —
              // the Team of the Month card wants them
              await shareWrappedImage(
                buildWrapped(history, wrappedPeriod, players, marks),
                new Map(players.map((p) => [p.id, p.number])),
              );
              setSharingWrapped(false);
            }}
            disabled={sharingWrapped || !wrappedPeriod}
            className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-bold text-amber-50 shadow-sm transition-transform enabled:hover:scale-105 disabled:opacity-40"
          >
            {sharingWrapped ? '…' : t('tools.recap.share')}
          </button>
        </div>
      )}

      {/* Team of the Month (§2.25). The cron on the 1st is the usual registrar
          and this panel is not a second way of doing its job — it covers the
          two cases the cron cannot: seeding the archive, which should not have
          to wait a month for its first entry, and correcting a month the
          automatic pick got wrong. Since the cron never overwrites, whatever
          is set here stays set — and removing a month hands it back, so the
          1st will register it afresh. */}
      {periods.length > 0 && (
        <Section id="totm" title={t('tools.totm.title')} defaultOpen={false}>
          <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
            <p className="mb-1 text-xs text-amber-900/45">{t('tools.totm.hint')}</p>
            <div className="divide-y divide-amber-900/10">
              {periods.map((period) => {
                const award = awards[period];
                const busy = busyMonth === period;
                // The month still being played. Registering it is allowed on
                // purpose — it is the only way to see what the shelf looks like
                // without waiting for the 1st — but it is worth saying out loud
                // that the number will move until the month is over.
                const running = period >= new Date().toISOString().slice(0, 7);
                return (
                  <div key={period} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                    <span className="w-28 shrink-0 text-sm font-bold text-amber-950">
                      {periodLabel(period)}
                    </span>
                    <div className="min-w-[10rem] flex-1 text-xs">
                      {award ? (
                        <>
                          <span className="text-amber-900/70">{award.names.join(', ')}</span>
                          <span className="text-amber-900/35">
                            {' '}
                            {t('tools.totm.registered', {
                              date: fmtDate(award.at, getLang(), {}),
                            })}
                          </span>
                        </>
                      ) : (
                        <span className="text-amber-900/35">
                          {t('tools.totm.notRegistered')}
                          {running ? t('tools.totm.stillPlayed') : ''}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        // Registering a month still being played is the way to
                        // try this out without waiting for the 1st — but the
                        // cron never overwrites, so a half-month team would sit
                        // there for good. Said once, here, rather than
                        // discovered in October.
                        if (
                          running &&
                          !confirm(t('tools.totm.runningConfirm', { period: periodLabel(period) }))
                        ) {
                          return;
                        }
                        setBusyMonth(period);
                        await afterWrite(await announceMonth(period, adminWord));
                      }}
                      disabled={busy}
                      title={
                        award ? t('tools.totm.reregister.title') : t('tools.totm.register.title')
                      }
                      className="rounded-lg border border-amber-900/25 px-2.5 py-1 text-xs font-bold text-amber-900 transition-colors enabled:hover:border-orange-500 disabled:opacity-40"
                    >
                      {busy ? '…' : award ? t('tools.totm.reregister') : t('tools.totm.register')}
                    </button>
                    {award && (
                      <button
                        onClick={async () => {
                          if (
                            !confirm(t('tools.totm.removeConfirm', { period: periodLabel(period) }))
                          ) {
                            return;
                          }
                          setBusyMonth(period);
                          await afterWrite(await clearMonth(period, adminWord));
                        }}
                        disabled={busy}
                        title={t('tools.totm.remove.title')}
                        className="rounded-lg border border-red-500/40 px-2.5 py-1 text-xs font-bold text-red-700 transition-colors enabled:hover:bg-red-50 disabled:opacity-40"
                      >
                        {t('tools.totm.remove')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </Section>
      )}

      {/* The balance analysis (§2.54). Folded like the rest, despite being the
          reason most visits here will happen — a page whose tools are shut
          except for the tall one is not a page of tools, it is that one tool
          with some headings above it. The verdict is one tap away and it is a
          tap the reader meant to make. */}
      <Section id="postmortem" title={t('pm.title')} defaultOpen={false}>
        {history.length > 0 ? (
          <PostMortem history={history} players={players} />
        ) : (
          <p className="text-sm text-amber-900/50">{t('tools.postmortem.empty')}</p>
        )}
      </Section>

      {/* Rating suggestions. Folded, and — unlike on the Club tab, where the
          panel simply was not rendered — present with a line saying why when
          the switch is off. The panel vanishing entirely is indistinguishable
          from the panel being broken, and this is a page an organiser comes to
          on purpose looking for exactly this sort of thing. */}
      <Section id="suggestions" title={t('tools.sugg.title')} defaultOpen={false}>
        {!RATING_PANEL_READY ? (
          <p className="text-sm text-amber-900/50">{t('tools.sugg.notReady')}</p>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-amber-900/50">{t('tools.sugg.body')}</p>
        ) : (
          <div className="space-y-2 rounded-2xl border border-orange-600/40 bg-orange-500/10 p-4 shadow-sm">
            <p className="text-xs text-amber-900/60">{t('tools.sugg.body')}</p>
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 text-sm ${
                    s.atLimit
                      ? 'border-amber-900/10 bg-amber-900/[0.04]'
                      : 'border-amber-900/10 bg-white/70'
                  }`}
                >
                  <Name className="font-bold text-amber-950">{s.name}</Name>
                  {s.atLimit ? (
                    <span className="font-semibold text-amber-900">
                      {s.direction === 'up' ? '⭐' : '⚓'}{' '}
                      {t('tools.sugg.staysAt', { r: fmtRating(s.current) })}
                    </span>
                  ) : (
                    <span className="font-semibold text-amber-900">
                      {fmtRating(s.current)} → {fmtRating(s.suggested)}
                      <span className="ms-1">{s.direction === 'up' ? '⬆️' : '⬇️'}</span>
                    </span>
                  )}
                  <span className="text-xs text-amber-900/55">
                    {t('tools.sugg.nights', { n: s.nights })} ·{' '}
                    {t('tools.sugg.wins', { n: fmtWins(s.wins) })}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      s.confidence === 'strong'
                        ? 'bg-green-600/15 text-green-800'
                        : s.confidence === 'solid'
                          ? 'bg-amber-500/25 text-amber-900'
                          : 'bg-amber-900/10 text-amber-900/70'
                    }`}
                    title={
                      s.confidence === 'building'
                        ? t('tools.sugg.early.title')
                        : t('tools.sugg.held.title')
                    }
                  >
                    {s.confidence === 'building'
                      ? t('tools.sugg.early')
                      : s.confidence === 'solid'
                        ? t('tools.sugg.solid')
                        : t('tools.sugg.strong')}
                  </span>
                  <div className="flex-1" />
                  {/* nothing to apply when the scale has run out — only the note */}
                  {!s.atLimit && (
                    <button
                      onClick={() => onApplyRating(s.id, s.suggested)}
                      className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-bold text-amber-50 hover:scale-105"
                    >
                      {t('tools.sugg.apply')}
                    </button>
                  )}
                  <button
                    onClick={() => setDismissed((d) => new Set(d).add(s.id))}
                    className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                  >
                    {t('tools.sugg.dismiss')}
                  </button>
                  {s.atLimit && (
                    <p className="w-full text-xs text-amber-900/60">
                      {t(
                        s.direction === 'up' ? 'tools.sugg.atLimit.up' : 'tools.sugg.atLimit.down',
                        { r: fmtRating(s.current) },
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Rendered again, at last. `AlertsCheck` was built to diagnose a push
          bug, found it, and was then taken out of the header rather than
          deleted — because the failure it diagnoses is *silence*, and when
          there is nothing to look at, this is the thing to reach for. It had no
          home; now it has one. */}
      <Section id="alerts" title={t('tools.alerts.title')} defaultOpen={false}>
        <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
          <p className="mb-2 text-xs text-amber-900/60">{t('tools.alerts.body')}</p>
          <AlertsCheck adminWord={adminWord} />
        </div>
      </Section>
    </div>
  );
}
