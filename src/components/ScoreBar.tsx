import { useEffect, useState } from 'react';
import type { ClockState, MatchLogEntry, TeamColor } from '../types';
import { TEAM_COLORS } from '../balancer';
import { nextPairing, playedCounts, winsFromLog } from '../matchLog';
import { TEAM_META } from './ui';

// The two numbers you look up for, stuck to the top of the fixture page
// (§2.18): who is on what, and how long is left.
//
// Both already exist further down — the clock in its card, the tally in the
// log — but "further down" is the problem. A fixture page is long enough to
// scroll, and the questions it gets asked at a pitch are asked mid-glance,
// usually by someone who is also playing. Sticky rather than a second copy
// somewhere: one source, always reachable.

const fmt = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

// The clock travels as an absolute end time, so this ticks purely to redraw —
// the value is recomputed from `endsAt` every frame rather than counted down,
// which is what stops a throttled background tab drifting.
function useTick(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [active]);
}

const fmtPoints = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function ScoreBar({ clock, log }: { clock: ClockState; log: MatchLogEntry[] }) {
  const running = clock.endsAt !== null && !clock.ended;
  useTick(running);

  const remaining = clock.endsAt !== null ? Math.max(0, clock.endsAt - Date.now()) : clock.remaining;
  const finished = clock.ended || (clock.endsAt !== null && remaining <= 0);
  const shouting = running && remaining <= 60_000 && clock.period === 'regulation';

  const wins = winsFromLog(log);
  const played = playedCounts(log);
  const pair = nextPairing(log);
  const onNow = new Set<TeamColor>(pair ?? []);

  return (
    <div className="sticky top-0 z-30 -mx-3 mb-3 border-b border-amber-900/15 bg-[#fdf6e3]/95 px-3 py-2 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="mx-auto flex max-w-5xl items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1.5">
          {TEAM_COLORS.map((c) => (
            <div
              key={c}
              // the two on the pitch are lifted out of the three, so the bar
              // answers "who is on" without anyone reading a word
              className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-1 ${
                onNow.has(c)
                  ? 'bg-orange-500/15 ring-1 ring-orange-500/40'
                  : 'bg-amber-900/[0.04] opacity-60'
              }`}
              title={`${TEAM_META[c].label} — ${fmtPoints(wins[c])} from ${played[c]} ${played[c] === 1 ? 'match' : 'matches'}`}
            >
              <span className="text-sm leading-none">{TEAM_META[c].emoji}</span>
              <span className="font-mono text-base font-black leading-none text-amber-950">
                {fmtPoints(wins[c])}
              </span>
            </div>
          ))}
        </div>

        <div
          className={`font-mono text-xl font-black tabular-nums ${
            shouting || finished ? 'text-red-700' : 'text-amber-950'
          }`}
        >
          {fmt(remaining)}
        </div>
      </div>
    </div>
  );
}
