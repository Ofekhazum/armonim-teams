import { useEffect, useState } from 'react';
import type { PresenceMember } from '../liveRoom';
import { Name } from './ui';

interface Props {
  presence: PresenceMember[];
  activity: string | null;
}

// Presence chips + a fading "who did what" toast — shared by the host's live
// Teams page and the guest room view.
export default function LiveRoomBar({ presence, activity }: Props) {
  const [visible, setVisible] = useState<string | null>(null);

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
          className="rounded-full border border-amber-900/20 bg-white/60 px-2.5 py-1 font-semibold text-amber-900"
        >
          <Name>{m.name}</Name>
          {m.isHost && <span className="text-amber-900/50"> · host</span>}
        </span>
      ))}
      {visible && (
        <span className="pop-in rounded-full bg-amber-900 px-2.5 py-1 font-semibold text-amber-50">
          {visible}
        </span>
      )}
    </div>
  );
}
