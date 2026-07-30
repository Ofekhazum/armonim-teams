import { useEffect, useRef, useState } from 'react';
import type { ActivityEvent, PresenceMember } from '../liveRoom';
import { createUserColorTracker } from '../userColor';
import { Name } from './ui';

interface Props {
  presence: PresenceMember[];
  activity: ActivityEvent | null;
}

// Presence chips + a fading "who did what" toast — shared by the host's live
// Teams page and the guest room view. Each person gets a stable color (see
// userColor.ts) so it's easy to tell at a glance who's who and who just made
// a change — the name text is always shown too, so color is never the only
// way to identify someone.
export default function LiveRoomBar({ presence, activity }: Props) {
  const [visible, setVisible] = useState<ActivityEvent | null>(null);
  const colorOf = useRef(createUserColorTracker()).current;

  useEffect(() => {
    if (!activity) return;
    setVisible(activity);
    const t = setTimeout(() => setVisible(null), 3000);
    return () => clearTimeout(t);
  }, [activity]);

  return (
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
      {visible && (
        <span className="pop-in flex items-center gap-1.5 rounded-full bg-amber-900 px-2.5 py-1 font-semibold text-amber-50">
          {visible.by && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: colorOf(visible.by) }}
              aria-hidden
            />
          )}
          {visible.text}
        </span>
      )}
    </div>
  );
}
