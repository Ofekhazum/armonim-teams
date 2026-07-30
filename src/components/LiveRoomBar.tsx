import type { ActivityEvent, PresenceMember } from '../liveRoom';
import { Name } from './ui';

interface Props {
  presence: PresenceMember[];
  activity: ActivityEvent | null;
  colorOf: (name: string) => string;
}

// Presence chips + a "who did what" toast — shared by the host's live Teams
// page and the guest room view. `activity`'s lifetime (when it appears/fades)
// is owned by the parent, which also drives the matching row highlight on
// TeamsBoard — see MatchDay.tsx/RoomGuest.tsx. The toast floats (fixed
// position) rather than sitting in-flow next to the chips, so it never
// pushes the page's layout around as it appears and disappears.
export default function LiveRoomBar({ presence, activity, colorOf }: Props) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1 rounded-full bg-red-600/10 px-2.5 py-1 font-bold text-red-700">
          🔴 Live
        </span>
        {presence.map((m, i) => (
          <span
            key={i}
            dir="auto"
            className="flex items-center gap-1.5 rounded-full border border-amber-900/20 bg-white/60 px-2.5 py-1 font-semibold text-amber-900"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: colorOf(m.name) }}
              aria-hidden
            />
            <Name>{m.name}</Name>
            {m.isHost && <span className="text-amber-900/50"> · host</span>}
          </span>
        ))}
      </div>
      {activity && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div
            className="pop-in flex items-center gap-2.5 rounded-xl bg-amber-900 py-2.5 pe-4 ps-3.5 text-sm font-bold text-amber-50 shadow-lg"
            style={{ borderInlineStart: `5px solid ${activity.by ? colorOf(activity.by) : '#eddcb4'}` }}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: activity.by ? colorOf(activity.by) : '#eddcb4' }}
              aria-hidden
            />
            {activity.text}
          </div>
        </div>
      )}
    </>
  );
}
