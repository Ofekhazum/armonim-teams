// Durable Object: an attempt counter, one instance per client IP (per purpose).
//
// The publish word is the only thing standing between the internet and the
// shared roster, and `safeEqual` in roster-worker.js only stops an attacker
// *timing* their way to it — nothing there stops them simply guessing. This
// adds the missing half: after `limit` attempts inside a `window` window, that
// IP is turned away until the window rolls over.
//
//   POST /attempt?limit=&window= → { blocked, retryAfter }  count it and decide
//   POST /refund?limit=&window=  → { ok: true }             give one back
//
// COUNT FIRST, DECIDE AFTER — and both in the same call. This used to be a
// read-only /check followed by a separate /fail, which looked equivalent and
// was not: the two round trips are individually atomic but not atomic *as a
// pair*, so a burst of concurrent guesses all read the counter before any of
// them incremented it, and every one sailed through the gate. The limit only
// ever bound strictly sequential attempts. Folding read-modify-write into one
// request closes that: a Durable Object's input gating holds incoming events
// while a storage operation is in flight, so the increment below is serialized
// against every other request to this same counter.
//
// The cost of counting first is that *successful* attempts are counted too —
// hence /refund, which the worker calls once the word checks out. A legitimate
// admin publishing repeatedly nets out at zero, exactly as before.
//
// Why a Durable Object rather than KV: KV is eventually consistent and caps
// writes to the same key at roughly one per second, so a counter built on it
// would undercount exactly when it matters most. A DO is strongly consistent,
// and sharding by IP (`idFromName(ip)`) means each client gets its own counter
// instead of the whole world serializing through one instance.

const DEFAULT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_LIMIT = 10;

// Callers pass their own budget (publishing and joining rooms want very
// different ones), but never one so large it defeats the point.
const MAX_LIMIT = 10_000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

const clamp = (raw, fallback, max) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
};

export class RateLimiter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const limit = clamp(url.searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
    const windowMs = clamp(url.searchParams.get('window'), DEFAULT_WINDOW_MS, MAX_WINDOW_MS);

    const now = Date.now();
    const stored = await this.state.storage.get('attempts');
    // no record, or the previous window has rolled over → a clean slate
    const rec = stored && now - stored.start < windowMs ? stored : { count: 0, start: now };

    if (url.pathname === '/refund') {
      // nothing to give back if the window already rolled over
      if (rec.count > 0) {
        rec.count -= 1;
        await this.state.storage.put('attempts', rec);
      }
      return Response.json({ ok: true });
    }

    // '/attempt' — the increment and the verdict are one indivisible step
    rec.count += 1;
    await this.state.storage.put('attempts', rec);
    // self-destruct once the window is up, so a one-off typo doesn't leave a
    // counter sitting in storage for this IP forever
    await this.state.storage.setAlarm(rec.start + windowMs);

    const blocked = rec.count > limit;
    return Response.json({
      blocked,
      retryAfter: blocked ? Math.ceil((rec.start + windowMs - now) / 1000) : 0,
    });
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}
