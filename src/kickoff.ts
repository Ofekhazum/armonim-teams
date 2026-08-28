// Whether a fixture has kicked off, and how long until it does (§2.7.2).
//
// "Kicked off" is never stored as its own field — it is always derived as
// `startedAt <= now`. An explicit flag would need something to flip it at the
// scheduled moment, and the device that would do that (the organiser's) may be
// in a pocket, out of signal, or closed. Deriving it means every device
// reaches the same answer on its own clock, with nothing to write and nothing
// to miss.

import { useEffect, useState } from 'react';

// `setTimeout` silently clamps to firing immediately above this (2^31 - 1 ms,
// ~24.8 days). A week-long schedule window is nowhere near it, but a stray
// huge delay should still be caught rather than fire early for the wrong
// reason.
const MAX_TIMEOUT_MS = 2_147_483_647;

// How far ahead a fixture may be scheduled. A bound has to exist somewhere —
// without one a mistyped year parks a record reading "starts in 200 years" —
// and matches `MAX_SCHEDULE_AHEAD_MS` in `worker/roster-worker.js`.
export const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;

export const hasKickedOff = (startedAt: number, now: number = Date.now()): boolean =>
  startedAt <= now;

// Never negative — "how long until" has nothing left to say once kickoff has
// passed.
export const untilKickOff = (startedAt: number, now: number = Date.now()): number =>
  Math.max(0, startedAt - now);

// A time is worth offering in the "Schedule…" dialog only if it's genuinely
// ahead of now and inside the lead-time bound above.
export function isSchedulable(startedAt: number, now: number = Date.now()): boolean {
  return startedAt > now && startedAt - now <= MAX_SCHEDULE_AHEAD_MS;
}

// A `datetime-local` input's value ("2026-08-20T20:00") carries no timezone
// designator, which — per the date-time string format `Date` follows — makes
// it local time already. The trap is reaching for `Date.UTC(...)` out of a
// habit of "always use UTC": that reads a Thursday-evening pick as a
// different hour entirely for anyone not sitting on UTC.
export function parseLocalKickoff(value: string): number | null {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// The mirror of the parse above, for the input's `value`/`min`/`max` — local
// wall-clock time truncated to the minute, with no timezone conversion.
// `toISOString()` would shift the moment to UTC and show the wrong hour.
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

// What the "Schedule…" dialog opens to: the coming Thursday at 19:00, or the
// following one if today already is Thursday past that hour. Not "tomorrow" —
// teams for a fixed weekly slot are usually picked more than a day ahead.
export function nextThursday7pm(now: number = Date.now()): Date {
  const THURSDAY = 4;
  const d = new Date(now);
  d.setDate(d.getDate() + ((THURSDAY - d.getDay() + 7) % 7));
  d.setHours(19, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 7);
  return d;
}

// "in 3d 4h" / "in 2h 15m" / "in 42m" / "in 0:37" — days and hours above an
// hour, minutes above a minute, and a clock face below it, matching the
// under-a-minute shape `fmt()` in `MatchClock.tsx` uses — that's the moment
// someone is actually watching the number.
export function kickoffLabel(startedAt: number, now: number = Date.now()): string {
  const ms = untilKickOff(startedAt, now);
  if (ms <= 0) return 'kicking off any moment';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000) % 24;
  const mins = Math.floor(ms / 60_000) % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  if (mins > 0) return `in ${mins}m`;
  const secs = Math.ceil(ms / 1000);
  return `in 0:${String(secs).padStart(2, '0')}`;
}

// "kicked off just now" / "42 min ago" / "3h 12m ago" — moved here from
// `LiveFixtureView.tsx`, which read a *future* `startedAt` as "just now"
// (a negative minute count still floors under 1). Only ever called once
// `hasKickedOff` is true, so that never arises in practice — the floor is
// just the honest answer for a fixture that kicked off a moment ago.
export function agoLabel(startedAt: number, now: number = Date.now()): string {
  const mins = Math.floor((now - startedAt) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
}

// Fires once, at the moment a scheduled fixture kicks off — not a repeating
// tick. `null` means "nothing to wait for", which reads as already kicked
// off, matching how a fixture with no scheduling ever behaved. Rechecks on
// `visibilitychange` since a suspended tab's timer may not run right on time
// (the same treatment `live.ts` gives a tab coming back).
export function useKickedOff(startedAt: number | null): boolean {
  const [kickedOff, setKickedOff] = useState(() =>
    startedAt === null ? true : hasKickedOff(startedAt),
  );

  useEffect(() => {
    if (startedAt === null) {
      setKickedOff(true);
      return;
    }
    const recheck = () => setKickedOff(hasKickedOff(startedAt));
    recheck();
    const t = setTimeout(recheck, Math.min(untilKickOff(startedAt), MAX_TIMEOUT_MS));
    document.addEventListener('visibilitychange', recheck);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [startedAt]);

  return kickedOff;
}

// Re-renders the caller only as often as a countdown string can actually
// change: every second under a minute to go, every minute above it, never
// once kicked off. ~60 renders/hour rather than the ~14,400 a 250ms tick would
// cost across a week-long schedule window. The value itself is read fresh off
// the wall clock wherever it's displayed (see `kickoffLabel`), never
// accumulated, so a throttled background tab can't drift.
export function useCountdownTick(startedAt: number | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const ms = untilKickOff(startedAt);
      if (ms <= 0) return;
      const step = ms > 60_000 ? ms % 60_000 || 60_000 : ms % 1_000 || 1_000;
      timer = setTimeout(() => {
        setTick((n) => n + 1);
        schedule();
      }, Math.min(step, MAX_TIMEOUT_MS));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [startedAt]);
}
