import { useEffect, useRef, useState } from 'react';

// The house rules this clock encodes (see DESIGN.md §2.8):
//   · a match is 8 minutes, or ends early at a two-goal lead (2:0, 3:1, …)
//   · level after 8 minutes → 2 minutes of added time, golden goal
//   · still level after that → penalties
//   · the resting team shouts when there's a minute left
//
// Only the *time* half is automated. Nothing here knows the score — the app
// deliberately doesn't collect one live — so a match that ends early on a
// two-goal lead is ended with the same "next match" button that ends any
// other, and the one point where the score decides what happens next (level
// or not at full time) is a single two-button choice, not a running tally.
const REGULATION_MS = 8 * 60 * 1000;
const ADDED_MS = 2 * 60 * 1000;
const SHOUT_AT_MS = 60 * 1000; // "one minute left" — the resting team's cue

type Period = 'regulation' | 'added';

const fmt = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

// Short beeps via Web Audio, so there's no audio asset to ship. The context is
// created on the first Start press — a user gesture — which is what lets it
// make sound at all on iOS.
function useBeeper() {
  const ctxRef = useRef<AudioContext | null>(null);

  const unlock = () => {
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        return; // no Web Audio — the clock still works, just silently
      }
    }
    void ctxRef.current.resume();
  };

  const beep = (count: number) => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== 'running') return;
    for (let i = 0; i < count; i++) {
      const at = ctx.currentTime + i * 0.28;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      // a bare start/stop clicks; fade the tail instead
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.2);
    }
  };

  useEffect(() => () => void ctxRef.current?.close(), []);
  return { unlock, beep };
}

// Keeps the screen awake while the clock runs — a pitch-side timer the phone
// blanks after 30 seconds isn't one. Unsupported browsers just don't get it.
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let released = false;
    navigator.wakeLock
      .request('screen')
      .then((s) => {
        if (released) return void s.release();
        sentinel = s;
      })
      .catch(() => {}); // denied (often: tab not visible) — not worth surfacing
    return () => {
      released = true;
      void sentinel?.release();
    };
  }, [active]);
}

export default function MatchClock() {
  const [period, setPeriod] = useState<Period>('regulation');
  // when running: the epoch ms this period ends. Wall-clock rather than a
  // decrementing counter, so a throttled background tab doesn't lose time.
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(REGULATION_MS);
  const [ended, setEnded] = useState(false);
  const shoutedRef = useRef(false);
  const { unlock, beep } = useBeeper();
  const running = endsAt !== null && !ended;
  useWakeLock(running);

  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => {
      const left = endsAt - Date.now();
      setRemaining(left);
      if (period === 'regulation' && !shoutedRef.current && left <= SHOUT_AT_MS) {
        shoutedRef.current = true;
        beep(2);
      }
      if (left <= 0) {
        setEndsAt(null);
        setRemaining(0);
        setEnded(true);
        beep(3);
      }
    };
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [endsAt, period]);

  const start = () => {
    unlock();
    setEndsAt(Date.now() + remaining);
  };
  const pause = () => {
    setRemaining(Math.max(0, (endsAt ?? 0) - Date.now()));
    setEndsAt(null);
  };
  const toPeriod = (p: Period) => {
    const ms = p === 'regulation' ? REGULATION_MS : ADDED_MS;
    shoutedRef.current = false;
    setPeriod(p);
    setEnded(false);
    setRemaining(ms);
    setEndsAt(null);
  };

  const shouting = period === 'regulation' && running && remaining <= SHOUT_AT_MS;
  const addedTime = period === 'added';
  const idle = endsAt === null && !ended && remaining === (addedTime ? ADDED_MS : REGULATION_MS);

  const banner = ended
    ? addedTime
      ? { text: '🥅 Still level — penalties', cls: 'bg-red-600/15 text-red-800' }
      : { text: "⏱️ Full time — level? 2 minutes, golden goal", cls: 'bg-amber-500/25 text-amber-900' }
    : shouting
      ? { text: '🔔 One minute — resting team shouts!', cls: 'bg-red-600/15 text-red-800' }
      : addedTime
        ? { text: '⚽ Added time — golden goal', cls: 'bg-amber-500/25 text-amber-900' }
        : null;

  const btn =
    'rounded-xl px-4 py-2 text-sm font-bold shadow-sm transition-transform hover:scale-105';

  return (
    <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          className={`font-mono text-4xl font-black tabular-nums ${
            shouting || (ended && addedTime) ? 'text-red-700' : 'text-amber-950'
          }`}
        >
          {fmt(remaining)}
        </div>

        <div className="flex flex-wrap gap-2">
          {!ended &&
            (running ? (
              <button onClick={pause} className={`${btn} border border-amber-900/30 text-amber-900`}>
                ⏸ Pause
              </button>
            ) : (
              <button onClick={start} className={`${btn} bg-orange-600 text-amber-50`}>
                {idle ? (addedTime ? '▶️ Start added time' : '▶️ Start match') : '▶️ Resume'}
              </button>
            ))}

          {/* the one moment the score decides what happens next */}
          {ended && !addedTime && (
            <button onClick={() => toPeriod('added')} className={`${btn} bg-orange-600 text-amber-50`}>
              ⚽ Level — added time
            </button>
          )}

          <button
            onClick={() => toPeriod('regulation')}
            className={`${btn} border border-amber-900/30 text-amber-900`}
            title="Reset the clock for the next match"
          >
            {ended || !idle ? '⏭ Next match' : '↺ Reset'}
          </button>
        </div>

        {banner && (
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${banner.cls}`}>
            {banner.text}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-amber-900/60">
        8 minutes, or a two-goal lead (2:0, 3:1). Level at full time → 2 minutes golden goal, then
        penalties. The clock doesn't know the score, so end a match early with <b>Next match</b>.
      </p>
    </div>
  );
}
