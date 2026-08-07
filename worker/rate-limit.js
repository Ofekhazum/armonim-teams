// Durable Object: a failed-attempt counter, one instance per client IP.
//
// The publish word is the only thing standing between the internet and the
// shared roster, and `safeEqual` in roster-worker.js only stops an attacker
// *timing* their way to it — nothing there stopped them simply guessing, a few
// hundred times a second, forever. This adds the missing half: after
// MAX_FAILURES wrong words inside a WINDOW_MS window, that IP is turned away
// until the window rolls over.
//
// Why a Durable Object rather than KV: KV is eventually consistent and caps
// writes to the same key at roughly one per second, so a counter built on it
// would undercount exactly when it matters most. A DO is strongly consistent,
// and sharding by IP (`idFromName(ip)`) means each client gets its own counter
// instead of the whole world serializing through one instance.
//
//   POST /check → { blocked, retryAfter }   does this IP still get a turn?
//   POST /fail  → { ok: true }              record one wrong guess
//
// Only *failures* count, so a legitimate admin publishing repeatedly is never
// locked out — the counter only moves when someone gets the word wrong.

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_FAILURES = 10;

export class RateLimiter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const now = Date.now();
    const stored = await this.state.storage.get('attempts');
    // no record, or the previous window has rolled over → a clean slate
    const rec = stored && now - stored.start < WINDOW_MS ? stored : { count: 0, start: now };

    if (new URL(request.url).pathname === '/check') {
      const blocked = rec.count >= MAX_FAILURES;
      return Response.json({
        blocked,
        retryAfter: blocked ? Math.ceil((rec.start + WINDOW_MS - now) / 1000) : 0,
      });
    }

    // '/fail'
    rec.count += 1;
    await this.state.storage.put('attempts', rec);
    // self-destruct once the window is up, so a one-off typo doesn't leave a
    // counter sitting in storage for this IP forever
    await this.state.storage.setAlarm(rec.start + WINDOW_MS);
    return Response.json({ ok: true });
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}
