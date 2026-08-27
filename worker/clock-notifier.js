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

import { isGone, keyIsConsistent, sendPush } from './push.js';

const ONE_MINUTE_MS = 60 * 1000;

// A club, not a stadium. Also bounds what one alarm has to fan out to.
const MAX_SUBSCRIPTIONS = 200;

// KV gave the live record a 12-hour expiry for free, which is what stopped an
// organiser who closed the tab mid-night leaving a fixture that reads as live
// forever. Durable Object storage has no TTL, so the same guarantee is applied
// on read instead — cheaper than an alarm, and this object's single alarm is
// already spoken for by the announcements.
const LIVE_TTL_MS = 12 * 60 * 60 * 1000;

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
// Which push service a subscription belongs to — web.push.apple.com,
// fcm.googleapis.com — which is the only part of an endpoint worth reporting.
export function hostOf(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown';
  }
}

// These are read in about a second, on a lock screen, by someone who may be
// in the middle of playing. Three rules came out of that:
//
//   · The title is the moment, and nothing else. It is the half that survives
//     truncation on a watch or a banner, so the words that identify *which* of
//     the four this is come first and stay fixed week to week — a timing cue
//     you have to read twice has already failed.
//   · The body earns its place by being either an instruction or a branch.
//     Announcing a fact the title already carried ("Added time — golden goal"
//     under "One minute left") is a line nobody needs to look at twice.
//   · Never who is playing. These land on screens anyone standing nearby can
//     read, and tonight's line-up is not theirs to have.
//
// The full-time one is the interesting case: what happens next depends on the
// score, which this app deliberately never learns (§2.8). So rather than a
// half-answer, it states both branches with the commoner one first.
// Is `next` a legitimate one-step move from `prev`? One match written down,
// one undone, or the identical list sent twice.
//
// This is what makes a log anyone can write to safe. The write carries a whole
// list, so without this a phone whose last poll was stale would append to an
// old base and erase a match somebody else had just recorded. Rejecting instead
// means the loser of a race is handed the real log and adopts it.
//
// It lives beside the storage it guards, because the check and the write it
// guards have to happen without anything in between.
export function isLogStep(prev, next) {
  const same = (a, b) =>
    a.length === b.length &&
    a.every(
      (m, i) =>
        m.a === b[i].a && m.b === b[i].b && m.winner === b[i].winner &&
        m.viaPenalties === b[i].viaPenalties,
    );
  if (same(prev, next)) return true; // a retry, or two people recording the same result
  if (next.length === prev.length + 1) return same(prev, next.slice(0, -1)); // recorded
  if (next.length === prev.length - 1) return same(prev.slice(0, -1), next); // undone
  return false;
}

export function messageFor(kind, period) {
  if (kind === 'one-minute') {
    return period === 'added'
      ? { title: '⏱️ One minute left', body: 'Golden goal — next goal ends it.' }
      : // the house rule the clock exists to prompt: the team that isn't
        // playing does the shouting, because they are the only ones free to
        { title: '⏱️ One minute left', body: 'Resting team — shout it out.' };
  }
  return period === 'added'
    ? { title: '🥅 End of added time', body: 'Still level? Penalties.' }
    : { title: '🏁 Full time', body: 'Ahead? Done. Level? Two minutes, golden goal.' };
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

    // Consent lasts one night. Whenever the live fixture changes — ended, or
    // replaced by a different one — every subscription is dropped, so being
    // buzzed next Thursday requires asking to be, again. The alternative is a
    // list that only ever grows: a phone that opted in once, months ago,
    // buzzing for matches its owner long ago stopped coming to.
    //
    // Doing it here rather than in the app is what makes it true. A device
    // that was switched off when the night ended never gets told anything —
    // the server simply no longer has it, and its own toggle reads off again
    // because that is keyed to the fixture id too.
    if (path === '/fixture') {
      return Response.json({ ok: true, cleared: await this.fixtureChanged(body.id ?? null) });
    }

    // --- The live fixture itself ------------------------------------------
    // Held here rather than in KV because KV is eventually consistent and its
    // reads are edge-cached with a 60-second floor: a clock that is paused and
    // resumed every few minutes was being read stale, and no poll interval
    // could fix it. A Durable Object is strongly consistent — a read after a
    // write sees the write — which is the only property this record ever
    // needed. It also puts the record in the same object as the alarm it
    // drives, so storing a clock and rescheduling its announcements is one
    // trip that cannot half-happen.

    if (path === '/live') {
      return Response.json(await this.live());
    }

    if (path === '/live/put') {
      const fixture = body.fixture ?? null;
      const version = Date.now();
      if (fixture === null) await this.state.storage.delete('live');
      else await this.state.storage.put('live', { version, fixture });
      // a different night means nobody is subscribed to this one yet (§2.17)
      await this.fixtureChanged(fixture ? fixture.id : null);
      await this.schedule(fixture ? fixture.clock : null);
      return Response.json({ ok: true, version });
    }

    // Replaces only the clock, and only on a fixture that is already live —
    // the narrowness is what makes this safe to expose without a password.
    if (path === '/live/clock') {
      const current = await this.live();
      if (!current.fixture) return Response.json({ error: 'no live fixture' }, { status: 404 });
      const version = Date.now();
      await this.state.storage.put('live', {
        version,
        fixture: { ...current.fixture, clock: body.clock },
      });
      await this.schedule(body.clock);
      return Response.json({ ok: true, version });
    }

    // The same, for the night's results — and this one has to be *here* rather
    // than in the Worker, because it is a compare-and-swap: read the stored
    // log, check the write is a legal one-step move from it, then write. Split
    // across a KV read and a KV write that is a race with a stale read in the
    // middle, which is precisely how the first version of this rejected every
    // match anyone logged. A Durable Object is single-threaded and strongly
    // consistent, so the read and the write cannot be pulled apart.
    if (path === '/live/log') {
      const current = await this.live();
      if (!current.fixture) return Response.json({ error: 'no live fixture' }, { status: 404 });
      const stored = current.fixture.matchLog ?? [];
      if (!isLogStep(stored, body.matchLog)) {
        // somebody else recorded first — hand back what the night actually
        // says, so the sender can adopt it now rather than wait for a poll
        return Response.json({ error: 'stale log', matchLog: stored }, { status: 409 });
      }
      const version = Date.now();
      await this.state.storage.put('live', {
        version,
        fixture: { ...current.fixture, matchLog: body.matchLog },
      });
      return Response.json({ ok: true, version, matchLog: body.matchLog });
    }

    // Push is a chain of links that each fail silently — the browser hands out
    // a subscription, the Worker stores it, an alarm fires hours later, Apple
    // or Google accepts or rejects it, a service worker draws a banner — and
    // the only symptom of any of them breaking is a phone that doesn't buzz.
    // This sends one announcement *now* and reports what every link said, so
    // "no notification" becomes a status code instead of a mystery.
    if (path === '/test') {
      const subs = await this.subscriptions();
      // Given an endpoint, only that device is buzzed: whoever is debugging is
      // holding it, and the rest of the squad shouldn't feel their pocket for
      // it. Without one, everyone — which is what the real announcements do.
      // Strictly about the device that asked: with no endpoint there is
      // nothing to have heard of, however many others are subscribed.
      const known = Boolean(body.endpoint) && subs.some((s) => s.endpoint === body.endpoint);
      // No endpoint means the caller has nothing to buzz — a device that never
      // subscribed asking why it never buzzes. It gets the report and nobody
      // else's pocket goes off. `all` is the deliberate fan-out, for checking
      // the group rather than the device in your hand.
      const targets = body.endpoint
        ? subs.filter((s) => s.endpoint === body.endpoint)
        : body.all
          ? subs
          : [];
      const sent = await this.send(targets, {
        title: '🔔 Test alert',
        body: 'This is what one minute left will look like',
      });
      // The two pieces of VAPID configuration a push service can object to.
      // The subject is not a secret — it exists precisely so a push provider
      // can contact whoever runs this — and seeing it is the difference
      // between fixing a typo and regenerating a key for nothing.
      const jwk = this.env.VAPID_JWK ? JSON.parse(this.env.VAPID_JWK) : null;
      return Response.json({
        subscribers: subs.length,
        known,
        configured: Boolean(this.env.VAPID_JWK),
        subject: this.env.VAPID_SUBJECT ?? 'mailto:armonim@example.com (default)',
        keyOk: jwk ? await keyIsConsistent(jwk) : false,
        pending: (await this.state.storage.get('pending')) ?? [],
        alarmAt: (await this.state.storage.getAlarm?.()) ?? null,
        now: Date.now(),
        sent,
      });
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  }

  async subscriptions() {
    return (await this.state.storage.get('subs')) ?? [];
  }

  // The night as anyone watching sees it. Expiry is enforced here rather than
  // stored, so a stale record simply stops being live rather than needing
  // anything to have run.
  //
  // Measured from `startedAt`, which is also what makes a *scheduled* fixture
  // (§2.7.2) correct here for free: `startedAt` may be up to a week in the
  // future, `Date.now() - rec.fixture.startedAt` is then negative, and a
  // negative number is never greater than `LIVE_TTL_MS` — so the clock this
  // subtraction runs on doesn't start until kickoff actually arrives, exactly
  // as if the record had never been scheduled at all.
  async live() {
    const rec = await this.state.storage.get('live');
    if (!rec?.fixture) return { version: 0, fixture: null };
    if (Date.now() - rec.fixture.startedAt > LIVE_TTL_MS) return { version: 0, fixture: null };
    return rec;
  }

  // Alerts are asked for one night at a time: any change of fixture — ended,
  // or replaced — drops every subscription. Returns whether it did, which is
  // only of interest to the test.
  async fixtureChanged(id) {
    const previous = (await this.state.storage.get('fixture')) ?? null;
    if (id === previous) return false;
    await this.state.storage.put('fixture', id);
    await this.state.storage.delete('subs');
    return true;
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
    return this.send(await this.subscriptions(), message);
  }

  // Returns one row per device — the push service it belongs to, what that
  // service answered, and why if it refused. The alarm path throws the answer
  // away; /test is what reads it. Endpoints themselves never leave here: the
  // host is the part that explains anything, the rest is a device identifier.
  async send(targets, message) {
    const jwk = this.env.VAPID_JWK;
    if (!jwk) return []; // notifications not configured on this deployment
    const subject = this.env.VAPID_SUBJECT ?? 'mailto:armonim@example.com';
    if (targets.length === 0) return [];

    const payload = JSON.stringify({ ...message, tag: 'armonim-clock' });
    const results = await Promise.allSettled(
      targets.map((s) => sendPush(s, payload, JSON.parse(jwk), subject)),
    );

    const rows = results.map((r, i) => ({
      host: hostOf(targets[i].endpoint),
      status: r.status === 'fulfilled' ? r.value.status : 0,
      detail: r.status === 'fulfilled' ? r.value.detail : String(r.reason).slice(0, 200),
    }));
    // The one trace an alarm leaves behind. `wrangler tail` during a match is
    // otherwise blind to a push service quietly rejecting everything.
    for (const row of rows) {
      if (row.status < 200 || row.status > 299) {
        console.warn(`push rejected by ${row.host}: ${row.status} ${row.detail}`);
      }
    }

    // A push service reporting 404/410 is telling us this device is gone for
    // good — the browser dropped the subscription or the app was uninstalled.
    // Anything else (a timeout, a 5xx) is transient and keeps its place.
    const dead = new Set();
    rows.forEach((row, i) => {
      if (isGone(row.status)) dead.add(targets[i].endpoint);
    });
    if (dead.size > 0) {
      const subs = await this.subscriptions();
      await this.state.storage.put(
        'subs',
        subs.filter((s) => !dead.has(s.endpoint)),
      );
    }
    return rows;
  }
}
