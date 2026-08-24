// A player's career as a feed of dated events, newest first.
//
// The player page already draws the same history two other ways: a ribbon of
// medals, one square per night, and a set of progress bars toward the next
// milestone. Both are *shapes* — you read them at a glance and learn how much
// football someone has and roughly how it went. Neither can tell you the night
// something happened on.
//
// That is the gap this fills. A ribbon cannot say "this is where the run of
// five ended"; a progress bar cannot say "the 100th win was in March". The
// facts are all already computed somewhere in this repo — what was missing was
// a *when* attached to each one, and an order to read them in.
//
// Nothing here is new evidence. Every event below is a count crossing a
// threshold that `milestones.ts` already defines, or a run ending on the night
// it ended, which is arithmetic over `profileNights`. §2.9 holds: a card says
// "a run of four ended", never "they fell away".

import type { FixtureRecord, TeamColor } from './types';
import type { Place } from './playerProfile';
import { profileNights } from './playerProfile';
import {
  MIN_WIN_STREAK,
  MIN_WINLESS_RUN,
  isFixtureWinMilestone,
  isMilestoneNight,
  isMvpMilestone,
  isWinMilestone,
} from './milestones';

export type TimelineKind =
  // the first night on record — not necessarily the first they ever played
  | 'debut'
  // a counter crossing a rung of the ladders in milestones.ts
  | 'nth-night'
  | 'nth-win'
  | 'nth-night-won'
  | 'nth-mvp'
  // a run of won nights, ended or still alive
  | 'streak-ended'
  | 'streak-live'
  // the night a winless run finally broke
  | 'drought-ended'
  // most match wins they have ever taken in one night
  | 'best-night'
  // a month they were named in the registered Team of the Month
  | 'totm';

/**
 * One card in the feed.
 *
 * Deliberately flat rather than a discriminated union with a payload per kind,
 * which is the shape `Milestone` and `NightFact` use. Those are consumed by
 * exhaustive switches that build a different sentence for each; this is
 * consumed by one card component that draws icon + headline + number, so a
 * union here would buy nothing and cost a cast at every field access.
 *
 * No words in it, for the same reason `ProfileNight` has none: this module
 * decides *what happened and when*, and the page decides how to say it.
 */
export interface TimelineEvent {
  kind: TimelineKind;
  /**
   * Sort key, and — for everything tied to a night — the date of that night.
   *
   * Team of the Month belongs to a month rather than a night, so it sorts on
   * `${period}-99`: a key no real date can equal, above every night in the
   * month it is awarded for. That is where a reader expects to find it, since
   * the award is the month's conclusion.
   */
  at: string;
  fixtureId?: string;
  /** The number the event is about: which night, which win, how long the run. */
  n?: number;
  /** `totm` only, as `YYYY-MM`. */
  period?: string;
  /** `debut` only — the shirt worn and where they finished. */
  shirt?: TeamColor;
  place?: Place | null;
}

/**
 * Nights on record before a personal best is worth a card.
 *
 * Without a floor, the first night is always a record, the second one usually
 * is, and the feed opens with three "best night yet" cards that are artefacts
 * of having no history rather than facts about anybody. Four is the same floor
 * `playerArcs` and the profile's inference cards use.
 */
export const MIN_NIGHTS_FOR_RECORD = 4;

/**
 * Which rungs of a ladder a running total passed this night.
 *
 * Match wins are the only counter that can clear more than one rung at a time
 * — a night is worth four or five of them, and a shootout is worth half — so
 * the crossing has to be checked over the whole interval rather than by asking
 * whether the new total is itself a rung. Everything else increments by one and
 * gets the same treatment for free.
 */
const crossed = (before: number, after: number, isRung: (n: number) => boolean): number[] => {
  const out: number[] = [];
  for (let n = Math.floor(before) + 1; n <= Math.floor(after); n++) if (isRung(n)) out.push(n);
  return out;
};

/**
 * Everything worth a card in this player's history, newest first.
 *
 * `totmPeriods` comes from the awards read (`monthsWon`), which is a network
 * call and belongs to the page rather than to a pure function — so it is passed
 * in, and an empty array is the correct answer for an offline device rather
 * than a failure.
 */
export function playerTimeline(
  history: FixtureRecord[],
  id: string,
  totmPeriods: string[] = [],
): TimelineEvent[] {
  const nights = profileNights(history, id); // oldest first
  const out: TimelineEvent[] = [];

  // MVP is a pick rather than a result, so it counts on any night it was made
  // — including one whose tally was never typed in. Sorted with the nights so
  // the nth-MVP ladder climbs in the order the picks actually happened.
  const mvpNights = new Set(
    history.filter((fx) => fx.mvpId === id).map((fx) => fx.id),
  );

  // Nights counted the way the rest of the page counts them: only nights with
  // a result. The Milestones card on the profile uses the same total, and two
  // places on one screen disagreeing about which night was someone's 25th is
  // worse than either answer.
  let played = 0;
  let wins = 0;
  let nightsWon = 0;
  let mvps = 0;
  let run = 0; // nights won in a row
  let winless = 0; // nights not won in a row
  let best = 0; // most match wins in a night so far
  let lastDecided: { at: string; fixtureId: string } | null = null;

  for (const night of nights) {
    const at = night.date;
    const fixtureId = night.fixtureId;

    // The first night on record, whether or not anyone tallied it — turning up
    // is the event, and a debut nobody wrote a score for is still a debut.
    if (night === nights[0]) {
      out.push({ kind: 'debut', at, fixtureId, shirt: night.shirt, place: night.place });
    }

    if (mvpNights.has(fixtureId)) {
      mvps++;
      if (isMvpMilestone(mvps)) out.push({ kind: 'nth-mvp', at, fixtureId, n: mvps });
    }

    // Everything below is about results, so a night nobody tallied says
    // nothing either way and must not break a run — the same rule
    // `appearances()` follows in milestones.ts.
    if (night.won === null) continue;
    lastDecided = { at, fixtureId };

    played++;
    if (isMilestoneNight(played)) out.push({ kind: 'nth-night', at, fixtureId, n: played });

    const before = wins;
    wins += night.wins;
    for (const n of crossed(before, wins, isWinMilestone))
      out.push({ kind: 'nth-win', at, fixtureId, n });

    if (night.won) {
      nightsWon++;
      if (isFixtureWinMilestone(nightsWon))
        out.push({ kind: 'nth-night-won', at, fixtureId, n: nightsWon });

      // The night a long wait ended. Dated to the win rather than to the
      // losses, because the event is the win.
      if (winless >= MIN_WINLESS_RUN)
        out.push({ kind: 'drought-ended', at, fixtureId, n: winless });
      winless = 0;
      run++;
    } else {
      // The night a run ended, dated to the night that ended it. This is the
      // one card in the feed that is about something not happening, and it is
      // the one the reader remembers — which is why the length goes on it.
      if (run >= MIN_WIN_STREAK) out.push({ kind: 'streak-ended', at, fixtureId, n: run });
      run = 0;
      winless++;
    }

    // A record needs something to be a record against. `best` is still updated
    // below the floor so the first card, when it comes, beats a real number
    // rather than zero.
    if (played > MIN_NIGHTS_FOR_RECORD && night.wins > best)
      out.push({ kind: 'best-night', at, fixtureId, n: night.wins });
    if (night.wins > best) best = night.wins;
  }

  // A run that never ended has no night to be dated to, so it belongs to the
  // most recent night played — which is exactly where a reader looks for
  // "right now". `streak-ended` and `streak-live` are mutually exclusive for
  // any one run: a run is either broken or still going.
  if (run >= MIN_WIN_STREAK && lastDecided)
    out.push({ kind: 'streak-live', at: lastDecided.at, fixtureId: lastDecided.fixtureId, n: run });

  for (const period of totmPeriods) out.push({ kind: 'totm', at: `${period}-99`, period });

  // Newest first: this is a feed, and the top of a feed is the recent end.
  // Ties within one night are broken by insertion order reversed, so the
  // biggest event of a night — the ladder rung rather than the record — is not
  // buried under it.
  return out
    .map((event, i) => ({ event, i }))
    .sort((a, b) => b.event.at.localeCompare(a.event.at) || b.i - a.i)
    .map(({ event }) => event);
}
