import { kickoffLabel, useCountdownTick } from '../kickoff';
import NotifyToggle from './NotifyToggle';

interface Props {
  startedAt: number;
  // Same identity a live fixture would carry — stable from scheduling through
  // kickoff (§2.7.2), which is what lets an opt-in made days early still work.
  fixtureId: string | null;
}

// Takes the sticky slot `ScoreBar` occupies once a match is on. While
// scheduled, "how long until kickoff" is the one number worth pinning to the
// top the same way — see `useCountdownTick` for why this doesn't tick nearly
// as often as it looks like it should.
export default function KickoffCountdown({ startedAt, fixtureId }: Props) {
  useCountdownTick(startedAt);
  return (
    <div className="sticky top-0 z-30 -mx-3 mb-3 border-b border-amber-900/15 bg-[#fdf6e3]/95 px-3 py-2 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-black text-amber-950">
          ⏳ Kicks off {kickoffLabel(startedAt)}
        </span>
        <span className="text-xs text-amber-900/50">
          {new Date(startedAt).toLocaleString([], {
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <div className="flex-1" />
        {/* Same control `MatchClock` hosts once the match starts — the id is
            stable across the wait, so an opt-in made now still holds. */}
        <NotifyToggle fixtureId={fixtureId} />
      </div>
    </div>
  );
}
