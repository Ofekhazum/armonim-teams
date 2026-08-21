// The fixture being played right now, shared with the whole group (§2.14).
//
// Match day is the organiser's screen and is hidden from everyone else, so
// without this a player has no way to find out what team they're on tonight
// short of being sent a link. Starting a fixture publishes it here; ending one
// clears it. Exactly one key on the Worker, so exactly one fixture can ever be
// live — "which of these three is the real one" is a question this app should
// never be able to ask.
//
// Polled rather than pushed. The live rooms in liveRoom.ts already do the
// WebSocket thing, but they exist for dragging players between teams, where a
// second's lag is felt; this is a scoreboard. Polling needs no connection to
// keep alive on fifteen backgrounded phones, and because the clock travels as
// an absolute `endsAt` rather than a countdown, a poll arriving late still
// renders the right number — only the *transition* is late, never the time.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClockState, LiveFixture, MatchLogEntry } from './types';
import { REMOTE_URL, type PublishResult } from './remote';

export interface RemoteLive {
  version: number;
  fixture: LiveFixture | null;
}

// How often to ask. Two rates rather than one because the cost is paid by
// every phone with the app open: while a fixture is on, people are watching a
// clock and want it to start when it starts; the rest of the week the only
// question is "has anything begun yet". Polling stops entirely on a hidden tab
// (see the hook) — a backgrounded phone in someone's pocket has nobody to show
// it to — and resumes with an immediate poll when the tab comes back, which
// covers the common case of someone *arriving* at the app on a match night.
//
// The idle rate was a minute at first, on the reasoning that nobody watches an
// empty app. They do: the organiser starts the night with the tab already open
// on their other phone, and a minute of nothing reads as broken even though
// it isn't. Half a minute is still cheap — worst case one request per device
// per 30s, and only while someone is actually looking at it.
// A real night settled the question the last interval change was asking: three
// seconds of polling still felt slow, because the floor was never the interval.
// The live record was in KV, whose reads are edge-cached, so a clock paused a
// minute ago could still be read as running. It lives in a Durable Object now
// (§2.15) — strongly consistent, so a read after a write sees the write — and
// the interval is finally the whole of the delay rather than the smaller half
// of it. Two seconds while live is therefore worth what it costs: polling
// stops entirely on a hidden tab, so this is paid by the handful of phones
// actually looking at a clock, not by fifteen sitting in pockets.
const POLL_LIVE_MS = 2_000;
const POLL_IDLE_MS = 15_000;

export async function fetchLive(): Promise<RemoteLive | null> {
  if (!REMOTE_URL) return null;
  try {
    const res = await fetch(`${REMOTE_URL}/live`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as RemoteLive;
    return { version: data.version, fixture: data.fixture ?? null };
  } catch {
    return null;
  }
}

// Passing null ends the night — the key is deleted rather than set to an empty
// fixture, so "is anything live" stays a question about existence.
export async function publishLive(
  fixture: LiveFixture | null,
  secret: string,
): Promise<PublishResult> {
  if (!REMOTE_URL) return 'not-configured';
  try {
    const res = await fetch(`${REMOTE_URL}/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, fixture }),
    });
    if (res.status === 401) return 'wrong-word';
    if (res.status === 429) return 'rate-limited';
    if (!res.ok) return 'error';
    return 'ok';
  } catch {
    return 'error';
  }
}

// Starting or pausing the clock, from any device at the pitch — no admin word
// (see the /live/clock note in worker/roster-worker.js for why that's safe).
export async function publishClock(clock: ClockState): Promise<PublishResult> {
  if (!REMOTE_URL) return 'not-configured';
  try {
    const res = await fetch(`${REMOTE_URL}/live/clock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clock }),
    });
    if (res.status === 429) return 'rate-limited';
    if (!res.ok) return 'error';
    return 'ok';
  } catch {
    return 'error';
  }
}

// Writing down a finished match, from any device at the pitch — same reasoning
// and same lack of a password as the clock above. Returns 'stale' when someone
// else recorded first: the Worker only accepts one step at a time, so a phone
// appending to a base three seconds out of date is refused rather than allowed
// to erase the other person's match. The caller's answer to that is to stop
// preferring its local copy and let the next poll land.
export interface LogWrite {
  result: PublishResult | 'stale';
  // what the night actually says, returned with a refusal so the phone that
  // lost the race can show the truth immediately instead of waiting a poll out
  matchLog?: MatchLogEntry[];
}

export async function publishMatchLog(matchLog: MatchLogEntry[]): Promise<LogWrite> {
  if (!REMOTE_URL) return { result: 'not-configured' };
  try {
    const res = await fetch(`${REMOTE_URL}/live/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchLog }),
    });
    if (res.status === 429) return { result: 'rate-limited' };
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { matchLog?: MatchLogEntry[] };
      return { result: 'stale', matchLog: body.matchLog };
    }
    if (!res.ok) return { result: 'error' };
    return { result: 'ok' };
  } catch {
    return { result: 'error' };
  }
}

// How long a local clock press outranks whatever a poll brings back. A request
// already in flight when someone hits Start carries the *previous* clock, and
// landing it afterwards would snap the button back — the classic optimistic-
// update race. Comfortably longer than a round trip, far shorter than a match.
// Was four seconds, chosen when a round trip had to survive KV's cache. It is
// now comfortably longer than a trip to a Durable Object, and shorter matters:
// this window is also how long *someone else's* press is ignored, and at a
// pitch where anyone can hit pause, two people reaching for a phone at once is
// not a rare event.
const LOCAL_CLOCK_GRACE_MS = 2000;

export interface LiveState {
  fixture: LiveFixture | null;
  // Applies a clock press everywhere: on this screen immediately, and to
  // everyone else's on their next poll.
  setClock: (clock: ClockState) => void;
  // The same, for writing down a match. Rolls back on this screen if the
  // Worker says someone else got there first.
  setMatchLog: (log: MatchLogEntry[]) => void;
  // For the device that just ended the night: drop it now rather than showing
  // a Live tab for another poll cycle after the organiser pressed End fixture.
  // They already know; everyone else finds out on their next poll.
  forget: () => void;
}

// Watches for a fixture starting, running and ending. Returns whatever the
// last successful poll saw — a failed poll leaves the previous answer in place
// rather than blanking the screen, since a dropped request mid-match is far
// more likely than the night actually having ended.
export function useLiveFixture(enabled: boolean): LiveState {
  const [fixture, setFixture] = useState<LiveFixture | null>(null);
  const pressedAt = useRef(0);
  // set by forget(), so a poll that was already in flight when the night ended
  // can't put the fixture back on screen for one cycle
  const forgotten = useRef(false);

  useEffect(() => {
    if (!enabled || !REMOTE_URL) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // What the last successful poll saw, and the only thing that picks the
    // next delay. It is deliberately NOT read back off React state: the next
    // poll is scheduled synchronously after setFixture, before any re-render,
    // so state still holds the *previous* answer at that moment. Reading it
    // there meant the first poll of a live fixture scheduled the idle rate —
    // the app dropped to one check a minute exactly when a clock was running,
    // and took a minute to notice the night had ended.
    let live = false;

    const poll = async () => {
      if (!document.hidden) {
        const remote = await fetchLive();
        if (cancelled) return;
        if (remote) {
          const fresh = Date.now() - pressedAt.current < LOCAL_CLOCK_GRACE_MS;
          // we ended the night a moment ago; this response predates that
          if (forgotten.current && fresh && remote.fixture) {
            live = false;
          } else {
            forgotten.current = false;
            live = remote.fixture !== null;
            setFixture((prev) => {
              // keep a just-pressed clock and a just-written match, but take
              // everything else the poll brought — teams can still change under
              // us, and a fixture that has *ended* wins outright over any local
              // press
              if (prev && remote.fixture && fresh) {
                return { ...remote.fixture, clock: prev.clock, matchLog: prev.matchLog };
              }
              return remote.fixture;
            });
          }
        }
      }
      timer = setTimeout(poll, live ? POLL_LIVE_MS : POLL_IDLE_MS);
    };
    void poll();

    // coming back to the tab is exactly when the answer is most likely to have
    // changed and most likely to be looked at, so don't wait out the interval
    const onVisible = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      void poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  const setClock = useCallback((clock: ClockState) => {
    pressedAt.current = Date.now();
    // shown on this device before the round trip — a timer that waits for the
    // network to acknowledge a press is a timer nobody trusts
    setFixture((prev) => (prev ? { ...prev, clock } : prev));
    void publishClock(clock);
  }, []);

  const setMatchLog = useCallback((matchLog: MatchLogEntry[]) => {
    pressedAt.current = Date.now();
    setFixture((prev) => (prev ? { ...prev, matchLog } : prev));
    void publishMatchLog(matchLog).then(({ result, matchLog: theirs }) => {
      if (result !== 'stale') return;
      // Someone else wrote this match down first. Take what the night actually
      // says, right now — the refusal came back with it. Waiting for the next
      // poll instead is what makes a tap look like it vanished for no reason.
      pressedAt.current = 0;
      if (theirs) setFixture((prev) => (prev ? { ...prev, matchLog: theirs } : prev));
    });
  }, []);

  const forget = useCallback(() => {
    pressedAt.current = Date.now();
    forgotten.current = true;
    setFixture(null);
  }, []);

  return { fixture, setClock, setMatchLog, forget };
}
