import { useEffect, useRef, useState } from 'react';
import type { ClockPeriod, ClockState } from '../types';
import { ADDED_MIN, ADDED_MS, REGULATION_MIN, REGULATION_MS } from '../types';
import NotifyToggle from './NotifyToggle';

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
// REGULATION_MS / ADDED_MS live in types.ts — the clock's state is part of the
// session now, so modules with no business importing a component still need
// the lengths that define a fresh one.
const SHOUT_AT_MS = 60 * 1000; // "one minute left" — the resting team's cue

const fullLength = (p: ClockPeriod) => (p === 'regulation' ? REGULATION_MS : ADDED_MS);

const fmt = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

// Short beeps via Web Audio, so there's no audio asset to ship. The context is
// created on the first Start press — a user gesture — which is what lets it
// make sound at all on iOS. Only whoever is *running* the clock gets these:
// a viewer has made no gesture, so their context could never start anyway,
// and fifteen phones beeping at once is a worse cue than one.
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

interface Props {
  state: ClockState;
  // Absent means read-only — only used where there is nowhere to publish to.
  // Normally every device gets this: at 8 minutes a match, whoever is nearest
  // the phone has to be able to start it (§2.15).
  onChange?: (next: ClockState) => void;
}

// State lives outside the component so one clock is shared by everyone at the
// pitch. What travels is `endsAt`, an absolute epoch ms, not a countdown — so
// a device whose poll lands ten seconds late still shows the correct time.
// Only the transition is late; the number never is.
export default function MatchClock({ state, onChange }: Props) {
  const controllable = onChange !== undefined;
  const { period, endsAt, ended } = state;
  // re-renders once a tick while the clock runs; the displayed value is
  // derived from `endsAt` rather than accumulated, so a throttled background
  // tab can't drift
  const [, setTick] = useState(0);
  // Has anyone on *this* device touched the clock? Everyone can control it,
  // but that mustn't mean fifteen phones all beep at the one-minute mark and
  // all refuse to sleep for an hour. Pressing a button is the opt-in — which
  // also happens to be the gesture iOS requires before it will play audio at
  // all, so the two line up exactly.
  const [engaged, setEngaged] = useState(false);
  const shoutedRef = useRef(false);
  const { unlock, beep } = useBeeper();

  const remaining = endsAt !== null ? Math.max(0, endsAt - Date.now()) : state.remaining;
  // every device reaches zero on its own clock rather than waiting to be told
  const finished = ended || (endsAt !== null && remaining <= 0);
  const running = endsAt !== null && !finished;
  useWakeLock(running && engaged);

  useEffect(() => {
    if (endsAt === null) return;
    const t = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [endsAt]);

  // Only a device someone has actually used beeps, and only that device writes
  // down that the match ended — otherwise every phone in the squad posts the
  // same transition within a second of each other. Everyone still *sees* the
  // clock hit 0:00, because `finished` above is derived locally from `endsAt`.
  useEffect(() => {
    if (!controllable || !engaged || endsAt === null) return;
    const left = endsAt - Date.now();
    if (period === 'regulation' && !shoutedRef.current && left <= SHOUT_AT_MS && left > 0) {
      shoutedRef.current = true;
      beep(2);
    }
    if (left <= 0) {
      beep(3);
      onChange({ ...state, endsAt: null, remaining: 0, ended: true });
    }
  });

  const press = (next: ClockState) => {
    setEngaged(true);
    onChange?.(next);
  };

  const start = () => {
    unlock();
    press({ ...state, endsAt: Date.now() + remaining });
  };
  const pause = () =>
    press({ ...state, remaining: Math.max(0, (endsAt ?? 0) - Date.now()), endsAt: null });
  const toPeriod = (p: ClockPeriod) => {
    shoutedRef.current = false;
    press({ period: p, endsAt: null, remaining: fullLength(p), ended: false });
  };

  const shouting = period === 'regulation' && running && remaining <= SHOUT_AT_MS;
  const addedTime = period === 'added';
  const idle = endsAt === null && !finished && remaining === fullLength(period);

  const banner = finished
    ? addedTime
      ? { text: '🥅 Still level — penalties', cls: 'bg-red-600/15 text-red-800' }
      : {
          text: `⏱️ Full time — level? ${ADDED_MIN} minutes, golden goal`,
          cls: 'bg-amber-500/25 text-amber-900',
        }
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
            shouting || (finished && addedTime) ? 'text-red-700' : 'text-amber-950'
          }`}
        >
          {fmt(remaining)}
        </div>

        {controllable && (
          <div className="flex flex-wrap gap-2">
            {!finished &&
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
            {finished && !addedTime && (
              <button
                onClick={() => toPeriod('added')}
                className={`${btn} bg-orange-600 text-amber-50`}
              >
                ⚽ Level — added time
              </button>
            )}

            <button
              onClick={() => toPeriod('regulation')}
              className={`${btn} border border-amber-900/30 text-amber-900`}
              title="Reset the clock for the next match"
            >
              {finished || !idle ? '⏭ Next match' : '↺ Reset'}
            </button>
          </div>
        )}

        {banner && (
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${banner.cls}`}>
            {banner.text}
          </span>
        )}

        {running && (
          <span className="flex items-center gap-1.5 text-xs font-bold text-red-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
            </span>
            match in progress
          </span>
        )}

        <div className="flex-1" />
        {/* Sits with the clock because that is the only thing it announces —
            and lives here rather than in the two pages that render a clock, so
            a player and the organiser get the identical control. */}
        <NotifyToggle />
      </div>

      <p className="mt-2 text-xs text-amber-900/60">
        {REGULATION_MIN} minutes, or a two-goal lead (2:0, 3:1). Level at full time → {ADDED_MIN}{' '}
        minutes golden goal, then penalties. The clock doesn't know the score, so end a match early with <b>Next match</b>.
        {controllable && (
          <>
            {' '}
            Everyone at the pitch shares this clock — whoever is nearest the phone can start it, and
            it shows the same time on everyone else's within a few seconds.
          </>
        )}
      </p>
    </div>
  );
}
