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

import { useEffect, useState } from 'react';
import type { LiveFixture } from './types';
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
const POLL_LIVE_MS = 10_000;
const POLL_IDLE_MS = 30_000;

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

// Watches for a fixture starting, running and ending. Returns whatever the
// last successful poll saw — a failed poll leaves the previous answer in place
// rather than blanking the screen, since a dropped request mid-match is far
// more likely than the night actually having ended.
export function useLiveFixture(enabled: boolean): LiveFixture | null {
  const [fixture, setFixture] = useState<LiveFixture | null>(null);

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
          live = remote.fixture !== null;
          setFixture(remote.fixture);
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

  return fixture;
}
