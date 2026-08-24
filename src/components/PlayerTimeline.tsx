import { useState } from 'react';
import type { TimelineEvent, TimelineKind } from '../playerTimeline';
import { periodLabel } from '../wrapped';
import { TEAM_META } from './ui';

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

const ordinal = (n: number): string => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// `at` is a sort key first and a date second — Team of the Month's ends in a
// day that cannot exist, which is what keeps it above the month's nights.
const when = (event: TimelineEvent): string => {
  if (event.kind === 'totm' && event.period) return periodLabel(event.period);
  const [y, m, d] = event.at.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
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
        head: 'First night on record',
        detail: event.shirt
          ? `${TEAM_META[event.shirt].emoji} ${TEAM_META[event.shirt].label}${
              event.place ? ` · finished ${ordinal(event.place)}` : ''
            }`
          : undefined,
      };
    case 'nth-night':
      return { icon: '📅', head: `${ordinal(n)} night`, detail: 'nights with a result recorded' };
    case 'nth-win':
      return { icon: '🏆', head: `${ordinal(n)} match win`, detail: 'across every night they have played' };
    case 'nth-night-won':
      return { icon: '🥇', head: `${ordinal(n)} night won`, detail: 'nights their team finished top of' };
    case 'nth-mvp':
      return {
        icon: '⭐',
        head: n === 1 ? 'Picked MVP' : `${ordinal(n)} MVP night`,
        detail: n === 1 ? 'the first time' : undefined,
      };
    case 'streak-ended':
      return { icon: '💔', head: `A run of ${n} ended`, detail: `${n} nights won in a row, then this one` };
    case 'streak-live':
      return { icon: '🔥', head: `On a run of ${n}`, detail: 'still going' };
    case 'drought-ended':
      return { icon: '💧', head: 'Won a night again', detail: `first in ${n + 1}` };
    case 'best-night':
      return { icon: '🎯', head: `Best night yet — ${fmt(n)} wins`, detail: 'most their team has taken in one evening' };
    case 'totm':
      return { icon: '👕', head: 'Team of the Month', detail: 'named in the five' };
  }
}

export default function PlayerTimeline({ events }: { events: TimelineEvent[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, PAGE);
  const hidden = events.length - shown.length;

  if (events.length === 0) {
    return (
      <p className="text-sm text-amber-900/55">
        Nothing has happened twice yet. Milestones, runs and records land here as they do.
      </p>
    );
  }

  return (
    <div>
      {/* The rail: one continuous line behind the dots rather than a border on
          each row, so it runs through the gaps between cards and reads as a
          single thread. Stops at the last dot — a line continuing past the
          debut suggests history we do not have. */}
      <ol className="relative space-y-2.5 pl-7">
        <span
          aria-hidden
          className="absolute bottom-3 left-[9px] top-3 w-px bg-gradient-to-b from-amber-900/25 via-amber-900/15 to-transparent"
        />
        {shown.map((event, i) => {
          const { icon, head, detail } = say(event);
          const tone = TONE[event.kind];
          return (
            <li key={`${event.kind}-${event.at}-${event.n ?? i}`} className="relative">
              <span
                aria-hidden
                className={`absolute -left-[22px] top-[15px] h-2.5 w-2.5 rounded-full ring-4 ${tone.dot} ${tone.ring}`}
              />
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-900/10 bg-white/70 px-3 py-2.5 shadow-sm">
                <span className="text-base leading-5">{icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black leading-5 text-amber-950">{head}</p>
                  {detail && (
                    <p className="mt-0.5 text-[11px] leading-4 text-amber-900/50">{detail}</p>
                  )}
                </div>
                {/* Tabular so a column of dates lines up, and shrink-0 so a long
                    headline never squeezes the date onto two lines. */}
                <span className="shrink-0 pt-0.5 font-mono text-[10px] font-bold tabular-nums text-amber-900/40">
                  {when(event)}
                </span>
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
          {all
            ? '↑ Show less'
            : `↓ ${hidden} earlier ${hidden === 1 ? 'moment' : 'moments'}`}
        </button>
      )}
    </div>
  );
}
