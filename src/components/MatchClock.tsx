import { useEffect, useRef, useState } from 'react';
import type { ClockPeriod, ClockState } from '../types';
import { ADDED_MIN, ADDED_MS, REGULATION_MS, withAddedTime } from '../types';
import NotifyToggle from './NotifyToggle';
import PitchMode from './PitchMode';

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
const ADD_MS = 30 * 1000; // one press of +30s

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
  // Which night the alerts toggle is opting into — null before a fixture is
  // published, when there is nothing to be alerted about.
  fixtureId?: string | null;
}

// State lives outside the component so one clock is shared by everyone at the
// pitch. What travels is `endsAt`, an absolute epoch ms, not a countdown — so
// a device whose poll lands ten seconds late still shows the correct time.
// Only the transition is late; the number never is.
export default function MatchClock({ state, onChange, fixtureId = null }: Props) {
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
  // The clock filling the screen, for a phone propped up on the touchline.
  const [pitch, setPitch] = useState(false);
  const shoutedRef = useRef(false);
  // which `endsAt` we have already blown the whistle on — see the effect below
  const endedForRef = useRef<number | null>(null);
  const { unlock, beep } = useBeeper();

  const remaining = endsAt !== null ? Math.max(0, endsAt - Date.now()) : state.remaining;
  // every device reaches zero on its own clock rather than waiting to be told
  const finished = ended || (endsAt !== null && remaining <= 0);
  const running = endsAt !== null && !finished;
  // Pitch mode is its own reason to keep the screen on: the whole point is a
  // clock somebody can read from across the grass, and one that blanks after
  // thirty seconds is not that. Deliberately separate from `engaged`, which
  // still means "someone on this device pressed a button" and still decides
  // who beeps and who writes down that the match ended — putting the phone on
  // the floor to be looked at is not the same as running the match on it.
  useWakeLock((running && engaged) || pitch);

  useEffect(() => {
    if (endsAt === null) return;
    const t = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [endsAt]);

  // Only a device someone has actually used beeps, and only that device writes
  // down that the match ended — otherwise every phone in the squad posts the
  // same transition within a second of each other. Everyone still *sees* the
  // clock hit 0:00, because `finished` above is derived locally from `endsAt`.
  //
  // This effect deliberately has no dependency array — it has to re-check
  // against the wall clock on every tick, which is every 200ms. That makes the
  // guards load-bearing rather than tidy: `shoutedRef` for the one-minute beep,
  // and `endedForRef` for the whistle. Without the second one, "the clock has
  // run out" is true on every render until the parent hands back a cleared
  // clock — and the parent's clock is the *shared* one, which arrives by poll.
  // Any delay there (a slow write, a failed one, a rate-limited one) left this
  // firing five publishes a second, which is exactly how a 429 storm starts and
  // then feeds itself: the writes fail, the clock never clears, so it writes
  // again. Keyed on `endsAt` so a restart re-arms it.
  useEffect(() => {
    if (!controllable || !engaged || endsAt === null) return;
    const left = endsAt - Date.now();
    if (period === 'regulation' && !shoutedRef.current && left <= SHOUT_AT_MS && left > 0) {
      shoutedRef.current = true;
      beep(2);
    }
    if (left <= 0 && endedForRef.current !== endsAt) {
      endedForRef.current = endsAt;
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

  // Half a minute back, for the stoppage the clock didn't know about — someone
  // taking a goal kick from the car park, a ball over the fence. Works in every
  // state, because the moment you want it is rarely the moment the clock is in
  // a convenient one: running, it moves the end; paused or not yet started, it
  // grows what is left; already over, it hands the time back and un-ends the
  // match, leaving it paused so the restart is still a deliberate press.
  const addTime = () => {
    unlock();
    const now = Date.now();
    const next = withAddedTime(state, ADD_MS, now);
    // climbing back above a minute re-arms the shout, so the resting team gets
    // their cue again on the way down rather than being told once and never
    const left = next.endsAt !== null ? next.endsAt - now : next.remaining;
    if (left > SHOUT_AT_MS) shoutedRef.current = false;
    press(next);
  };
  const pause = () =>
    press({ ...state, remaining: Math.max(0, (endsAt ?? 0) - Date.now()), endsAt: null });
  const toPeriod = (p: ClockPeriod) => {
    shoutedRef.current = false;
    press({ period: p, endsAt: null, remaining: fullLength(p), ended: false });
  };

  // Added time is the one period that starts itself. Pressing "Level" at full
  // time is not a decision about *when* to restart — the two minutes begin the
  // moment somebody says the score is level, and the players are standing on
  // the pitch waiting for them. Loading a paused two minutes and asking for a
  // second press cost time nobody had and, on the night, got forgotten.
  // Everything else still waits for Start: a fresh match begins when the teams
  // are ready, which is a genuinely separate moment.
  const startAdded = () => {
    unlock();
    shoutedRef.current = false;
    press({ period: 'added', endsAt: Date.now() + ADDED_MS, remaining: ADDED_MS, ended: false });
  };

  const shouting = period === 'regulation' && running && remaining <= SHOUT_AT_MS;
  const addedTime = period === 'added';
  // `>=` rather than `===` so a match that has had time added before kickoff
  // still offers "Start match" rather than "Resume" — nothing has run yet.
  const idle = endsAt === null && !finished && remaining >= fullLength(period);

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

  // The card's banner carries an emoji and a sentence; from ten metres away
  // neither survives. Same states, said in two or three words.
  const headline = finished
    ? addedTime
      ? 'Penalties'
      : 'Full time'
    : shouting
      ? 'One minute'
      : addedTime
        ? 'Added time'
        : !running && !idle
          ? 'Paused'
          : null;

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
              <button onClick={startAdded} className={`${btn} bg-orange-600 text-amber-50`}>
                ⚽ Level — added time
              </button>
            )}

            <button
              onClick={addTime}
              className={`${btn} border border-amber-900/30 text-amber-900`}
              title="Add 30 seconds to the clock"
            >
              +30s
            </button>

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
        <button
          onClick={() => setPitch(true)}
          title="Fill the screen — for a phone propped up at the pitch"
          className="rounded-lg border border-amber-900/25 px-3 py-1.5 text-xs font-bold text-amber-900 transition-colors hover:border-orange-500"
        >
          ⛶ Pitch mode
        </button>
        {/* Sits with the clock because that is the only thing it announces —
            and lives here rather than in the two pages that render a clock, so
            a player and the organiser get the identical control. */}
        <NotifyToggle fixtureId={fixtureId} />
      </div>

      {pitch && (
        <PitchMode
          time={fmt(remaining)}
          alert={shouting || (finished && addedTime)}
          headline={headline}
          running={running}
          finished={finished}
          idle={idle}
          addedTime={addedTime}
          // handed through rather than re-implemented, so a press from the big
          // screen is the same act as a press from the card — it engages this
          // device, publishes to everyone, and unlocks the beeper
          onStart={controllable ? start : undefined}
          onPause={controllable ? pause : undefined}
          onAdded={controllable ? startAdded : undefined}
          onNext={controllable ? () => toPeriod('regulation') : undefined}
          onAddTime={controllable ? addTime : undefined}
          onExit={() => setPitch(false)}
        />
      )}
    </div>
  );
}
