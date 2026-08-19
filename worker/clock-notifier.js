// Durable Object: who wants telling about the match clock, and when to tell
// them. One instance for the whole club (`idFromName('clock')`).
//
// The point of doing this server-side rather than from the page is the entire
// point of the feature: a phone in a pocket with the screen off has no running
// JavaScript to fire a timer with. The clock's `endsAt` is an absolute time, so
// the moments worth announcing are known the instant someone presses Start —
// and a Durable Object alarm survives every phone in the squad going to sleep.
//
//   POST /subscribe    { subscription }  a device opts in
//   POST /unsubscribe  { endpoint }      it opts out
//   POST /schedule     { clock }         the clock changed; recompute alarms
//
// A DO holds exactly one alarm, so the pending triggers are kept as a list and
// the alarm is always set to the earliest of them.

import { isGone, sendPush } from './push.js';

const ONE_MINUTE_MS = 60 * 1000;

// A club, not a stadium. Also bounds what one alarm has to fan out to.
const MAX_SUBSCRIPTIONS = 200;

// An alarm can fire slightly late; anything within this of now is "due" rather
// than "still to come", so a late wake-up doesn't leave a trigger stranded in
// the pending list forever.
const DUE_SLACK_MS = 2000;

// The four moments worth announcing, derived from the clock as it stands.
// Pure and exported so the schedule can be tested without a Durable Object:
// getting these times wrong means a buzz at the wrong moment, which is worse
// than no buzz at all.
//
// A paused, reset or finished clock has nothing pending — `endsAt` is null the
// moment anyone hits Pause, and recomputing from scratch is what makes
// stopping and restarting a match behave.
export function triggersFor(clock, now) {
  if (!clock || !clock.endsAt || clock.ended) return [];
  return [
    { at: clock.endsAt - ONE_MINUTE_MS, kind: 'one-minute', period: clock.period },
    { at: clock.endsAt, kind: 'time-up', period: clock.period },
  ].filter((t) => t.at > now);
}

// What each moment says. Deliberately generic: these land on lock screens that
// anyone nearby can read, so they name the moment in the match and never who is
// playing in it.
export function messageFor(kind, period) {
  if (kind === 'one-minute') {
    return period === 'added'
      ? { title: '⏱️ One minute left', body: 'Added time — golden goal' }
      : { title: '⏱️ One minute left', body: 'Resting team shouts' };
  }
  return period === 'added'
    ? { title: '🥅 End of added time', body: 'Still level — penalties' }
    : { title: '🏁 Full time', body: 'Level? Two minutes, golden goal' };
}

export class ClockNotifier {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = await request.json().catch(() => ({}));

    if (path === '/subscribe') {
      const subs = await this.subscriptions();
      // keyed by endpoint, so re-subscribing the same device replaces rather
      // than duplicates — browsers hand out a fresh subscription fairly often
      const next = subs.filter((s) => s.endpoint !== body.subscription.endpoint);
      next.push(body.subscription);
      await this.state.storage.put('subs', next.slice(-MAX_SUBSCRIPTIONS));
      return Response.json({ ok: true, count: next.length });
    }

    if (path === '/unsubscribe') {
      const subs = await this.subscriptions();
      await this.state.storage.put(
        'subs',
        subs.filter((s) => s.endpoint !== body.endpoint),
      );
      return Response.json({ ok: true });
    }

    if (path === '/schedule') {
      await this.schedule(body.clock ?? null);
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  }

  async subscriptions() {
    return (await this.state.storage.get('subs')) ?? [];
  }

  // Recomputed from scratch on every clock change rather than patched: pausing,
  // resetting and starting the next match all land here, and "what should be
  // announced from now on" is always fully determined by the clock as it
  // stands. Nothing is remembered about triggers that were pending before.
  async schedule(clock) {
    const pending = triggersFor(clock, Date.now());
    await this.state.storage.put('pending', pending);
    if (pending.length === 0) {
      await this.state.storage.deleteAlarm();
      return;
    }
    await this.state.storage.setAlarm(Math.min(...pending.map((t) => t.at)));
  }

  async alarm() {
    const pending = (await this.state.storage.get('pending')) ?? [];
    const now = Date.now();
    const due = pending.filter((t) => t.at <= now + DUE_SLACK_MS);
    const later = pending.filter((t) => t.at > now + DUE_SLACK_MS);

    await this.state.storage.put('pending', later);
    if (later.length > 0) await this.state.storage.setAlarm(Math.min(...later.map((t) => t.at)));

    for (const trigger of due) {
      await this.broadcast(messageFor(trigger.kind, trigger.period));
    }
  }

  async broadcast(message) {
    const jwk = this.env.VAPID_JWK;
    if (!jwk) return; // notifications not configured on this deployment
    const subject = this.env.VAPID_SUBJECT ?? 'mailto:armonim@example.com';
    const subs = await this.subscriptions();
    if (subs.length === 0) return;

    const payload = JSON.stringify({ ...message, tag: 'armonim-clock' });
    const results = await Promise.allSettled(
      subs.map((s) => sendPush(s, payload, JSON.parse(jwk), subject)),
    );

    // A push service reporting 404/410 is telling us this device is gone for
    // good — the browser dropped the subscription or the app was uninstalled.
    // Anything else (a timeout, a 5xx) is transient and keeps its place.
    const dead = new Set();
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && isGone(r.value)) dead.add(subs[i].endpoint);
    });
    if (dead.size > 0) {
      await this.state.storage.put(
        'subs',
        subs.filter((s) => !dead.has(s.endpoint)),
      );
    }
  }
}
