import { useState } from 'react';
import type { TimelineEvent, TimelineKind } from '../playerTimeline';
import { periodLabel } from '../wrapped';
import { TEAM_META, teamLabel } from './ui';
import { fmtDate, getLang, t } from '../i18n';

// The player's career as a feed (§2.29). `playerTimeline` decides what happened
// and when; everything here is how to say it.
//
// The rail is the point of the component. Cards in a plain list are a list of
// facts; the same cards threaded on a line are a *career*, and the gaps in the
// line are as legible as the events on it — six months of nothing between two
// dots reads as six months of nothing, which no ribbon of medals can show.

// How many cards before the feed folds.
//
// Three, which is fewer than it looks. A career feed is the one card on this
// page with no natural length — a regular of two seasons has dozens of events,
// and at eight the timeline alone was taller than everything below it put
// together, so the shirts, the shirts worn, the mates and rivals and the rest
// of the profile were all below the fold on a phone. Three is a glance: what
// happened lately. The rest is one tap away and folds back up again.
const PAGE = 3;

// One tone per kind, so the rail reads as a sequence of coloured moments rather
// than a column of identical dots. Gold is reserved for the two events that are
// honours rather than counts — a milestone anyone reaches by turning up long
// enough should not look like the shirt.
//
// Written out rather than composed: Tailwind only ships class names it can see.
const TONE: Record<TimelineKind, { dot: string; ring: string }> = {
  debut: { dot: 'bg-emerald-500', ring: 'ring-emerald-500/20' },
  'nth-night': { dot: 'bg-amber-500', ring: 'ring-amber-500/20' },
  'nth-win': { dot: 'bg-orange-500', ring: 'ring-orange-500/20' },
  'nth-night-won': { dot: 'bg-orange-600', ring: 'ring-orange-600/20' },
  'nth-mvp': { dot: 'bg-yellow-400', ring: 'ring-yellow-400/25' },
  'streak-ended': { dot: 'bg-stone-400', ring: 'ring-stone-400/20' },
  'streak-live': { dot: 'bg-red-500', ring: 'ring-red-500/20' },
  'drought-ended': { dot: 'bg-sky-500', ring: 'ring-sky-500/20' },
  'best-night': { dot: 'bg-violet-500', ring: 'ring-violet-500/20' },
  totm: { dot: 'bg-amber-400', ring: 'ring-amber-400/30' },
};

/**
 * The count, shaped for whichever language is showing.
 *
 * English needs the suffix — "1st", "22nd", "13th", with the 11-13 exception
 * that catches every naive implementation. Hebrew needs no suffix at all: the
 * ordinal is carried by the "ה־" already in the string, so the number goes in
 * bare and this is the identity.
 */
const nth = (n: number): string => {
  if (getLang() !== 'en') return String(n);
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

// `at` is a sort key first and a date second — Team of the Month's ends in a
// day that cannot exist, which is what keeps it above the month's nights.
const when = (event: TimelineEvent): string => {
  if (event.kind === 'totm' && event.period) return periodLabel(event.period);
  // `Intl` rather than a hand-written month table, so the names arrive in
  // whichever language is showing.
  return fmtDate(event.at, getLang(), { day: 'numeric', month: 'short', year: '2-digit' });
};

// A match win can be a half — a shootout is worth one — so a tally is not
// always an integer, and "4.5 wins" is the true answer.
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * What the card says.
 *
 * Every line is the count it came from, phrased as the event it is. Nothing
 * here characterises anybody: a run ending is "a run of four ended", never "the
 * wheels came off", because the record is three numbers a night and cannot
 * carry the second sentence (§2.9).
 */
function say(event: TimelineEvent): { icon: string; head: string; detail?: string } {
  const n = event.n ?? 0;
  switch (event.kind) {
    case 'debut':
      return {
        icon: '🌱',
        head: t('tl.debut'),
        detail: event.shirt
          ? `${TEAM_META[event.shirt].emoji} ${teamLabel(event.shirt)}${
              event.place ? t('tl.debut.place', { ord: nth(event.place) }) : ''
            }`
          : undefined,
      };
    case 'nth-night':
      return {
        icon: '📅',
        head: t('tl.nthNight', { ord: nth(n) }),
        detail: t('tl.nthNight.detail'),
      };
    case 'nth-win':
      return {
        icon: '🏆',
        head: t('tl.nthWin', { ord: nth(n) }),
        detail: t('tl.nthWin.detail'),
      };
    case 'nth-night-won':
      return {
        icon: '🥇',
        head: t('tl.nthNightWon', { ord: nth(n) }),
        detail: t('tl.nthNightWon.detail'),
      };
    case 'nth-mvp':
      return {
        icon: '⭐',
        head: n === 1 ? t('tl.mvpFirst') : t('tl.nthMvp', { ord: nth(n) }),
        detail: n === 1 ? t('tl.mvpFirst.detail') : undefined,
      };
    case 'streak-ended':
      return {
        icon: '💔',
        head: t('tl.streakEnded', { n }),
        detail: t('tl.streakEnded.detail', { n }),
      };
    case 'streak-live':
      return { icon: '🔥', head: t('tl.streakLive', { n }), detail: t('tl.streakLive.detail') };
    case 'drought-ended':
      return {
        icon: '💧',
        head: t('tl.droughtEnded'),
        detail: t('tl.droughtEnded.detail', { n: n + 1 }),
      };
    case 'best-night':
      return {
        icon: '🎯',
        head: t('tl.bestNight', { n: fmt(n) }),
        detail: t('tl.bestNight.detail'),
      };
    case 'totm':
      return { icon: '👕', head: t('tl.totm'), detail: t('tl.totm.detail') };
  }
}

export default function PlayerTimeline({
  events,
  onOpenNight,
}: {
  events: TimelineEvent[];
  /** Given, every dated card becomes a way into its night (§2.60). */
  onOpenNight?: (fixtureId: string) => void;
}) {
  const [all, setAll] = useState(false);
  // Which run card is showing the nights it was made of. One at a time: these
  // open *inside* the rail, and two expanded at once pushes everything below
  // off a phone screen for a list nobody is reading twice.
  const [openRun, setOpenRun] = useState<string | null>(null);
  const shown = all ? events : events.slice(0, PAGE);
  const hidden = events.length - shown.length;

  if (events.length === 0) {
    return (
      <p className="text-sm text-amber-900/55">
        {t('tl.empty')}
      </p>
    );
  }

  return (
    <div>
      {/* The rail: one continuous line behind the dots rather than a border on
          each row, so it runs through the gaps between cards and reads as a
          single thread. Stops at the last dot — a line continuing past the
          debut suggests history we do not have. */}
      <ol className="relative space-y-2.5 ps-7">
        <span
          aria-hidden
          className="absolute bottom-3 start-[9px] top-3 w-px bg-gradient-to-b from-amber-900/25 via-amber-900/15 to-transparent"
        />
        {shown.map((event, i) => {
          const { icon, head, detail } = say(event);
          const tone = TONE[event.kind];
          const key = `${event.kind}-${event.at}-${event.n ?? i}`;
          // A run is the one card about several nights rather than the one it
          // is dated to, so it gets a list of its own instead of a single link.
          const runNights = event.runNights ?? [];
          const hasRun = onOpenNight && runNights.length > 0;
          const runOpen = openRun === key;
          return (
            <li key={key} className="relative">
              <span
                aria-hidden
                className={`absolute -start-[22px] top-[15px] h-2.5 w-2.5 rounded-full ring-4 ${tone.dot} ${tone.ring}`}
              />
              <div className="rounded-xl border border-amber-900/10 bg-white/70 px-3 py-2.5 shadow-sm">
                <div className="flex items-start gap-2.5">
                  <span className="text-base leading-5">{icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black leading-5 text-amber-950">{head}</p>
                    {detail && (
                      <p className="mt-0.5 text-[11px] leading-4 text-amber-900/50">{detail}</p>
                    )}
                    {hasRun && (
                      <button
                        onClick={() => setOpenRun(runOpen ? null : key)}
                        aria-expanded={runOpen}
                        className="mt-1 text-[11px] font-bold text-orange-700/80 underline decoration-dotted underline-offset-2 hover:text-orange-700"
                      >
                        {runOpen ? t('tl.run.hide') : t('tl.run.show')}
                      </button>
                    )}
                  </div>
                  {/* Tabular so a column of dates lines up, and shrink-0 so a
                      long headline never squeezes the date onto two lines.
                      On a card that has a night, the date is the way into it —
                      for a `streak-ended` that is the night which *broke* the
                      run, which is what the card is dated to and about. */}
                  {onOpenNight && event.fixtureId ? (
                    <button
                      onClick={() => onOpenNight(event.fixtureId!)}
                      aria-label={t('tl.openNight', { date: when(event) })}
                      className="shrink-0 rounded pt-0.5 font-mono text-[10px] font-bold tabular-nums text-amber-900/50 underline decoration-amber-900/25 decoration-dotted underline-offset-2 transition-colors hover:text-orange-700 hover:decoration-orange-600"
                    >
                      {when(event)}
                    </button>
                  ) : (
                    <span className="shrink-0 pt-0.5 font-mono text-[10px] font-bold tabular-nums text-amber-900/40">
                      {when(event)}
                    </span>
                  )}
                </div>

                {/* The nights the run was made of, newest first so they read
                    the same direction as the feed around them. */}
                {hasRun && runOpen && (
                  <ul
                    aria-label={t('tl.run.aria')}
                    className="mt-2 flex flex-wrap gap-1.5 border-t border-amber-900/10 pt-2"
                  >
                    {[...runNights].reverse().map((n) => (
                      <li key={n.fixtureId}>
                        <button
                          onClick={() => onOpenNight(n.fixtureId)}
                          aria-label={t('tl.openNight', { date: fmtDate(n.at) })}
                          className="rounded-lg border border-amber-900/15 bg-white px-2 py-1 font-mono text-[10px] font-bold tabular-nums text-amber-900/70 transition-colors hover:border-orange-500 hover:text-orange-700"
                        >
                          {fmtDate(n.at)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Opens and closes. A one-way expand is a card that can only ever get
          bigger, which on a phone means opening a long career once and then
          scrolling past it for the rest of the visit. */}
      {(hidden > 0 || all) && (
        <button
          onClick={() => setAll((open) => !open)}
          className="mt-3 w-full rounded-xl border border-amber-900/15 px-3 py-2 text-xs font-bold text-amber-900/70 transition-colors hover:border-orange-500 hover:text-amber-900"
        >
          {all ? t('tl.showLess') : t('tl.showMore', { n: hidden })}
        </button>
      )}
    </div>
  );
}
