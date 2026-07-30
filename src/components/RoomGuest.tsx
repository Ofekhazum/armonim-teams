import { useEffect, useRef, useState } from 'react';
import type { ActivityEvent, PresenceMember, RoomConnection, RoomState } from '../liveRoom';
import { joinRoom } from '../liveRoom';
import { getMyName, setMyName } from '../storage';
import { createUserColorTracker } from '../userColor';
import LiveRoomBar from './LiveRoomBar';
import TeamsBoard from './TeamsBoard';

interface Props {
  roomId: string;
}

const ACTIVITY_MS = 950;

// What a guest sees after opening a shared room link — straight onto the
// Teams page, restricted to dragging players between teams. No roster, no
// availability, no re-roll/back/new-fixture — those stay host-only.
export default function RoomGuest({ roomId }: Props) {
  const [name, setName] = useState(() => getMyName());
  const [nameDraft, setNameDraft] = useState('');
  const [state, setState] = useState<RoomState | null>(null);
  const [presence, setPresence] = useState<PresenceMember[]>([]);
  const [activity, setActivity] = useState<ActivityEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connRef = useRef<RoomConnection | null>(null);
  const colorOf = useRef(createUserColorTracker()).current;

  // owns how long an activity banner + its matching player-row highlight
  // stay up, so both fade together
  useEffect(() => {
    if (!activity) return;
    const t = setTimeout(() => setActivity(null), ACTIVITY_MS);
    return () => clearTimeout(t);
  }, [activity]);

  const highlight =
    activity?.ids && activity.ids.length > 0
      ? { ids: activity.ids, color: activity.by ? colorOf(activity.by) : '#78350f' }
      : null;

  useEffect(() => {
    if (!name) return;
    // StrictMode runs this effect twice in dev (mount → cleanup → mount) —
    // without this guard, the first (intentionally torn-down) connection's
    // eventual onClose still fires and stomps the second, live one's state
    // with a false "disconnected".
    let cancelled = false;
    const conn = joinRoom(roomId, name, null, {
      onState: (s) => !cancelled && setState(s),
      onPresence: (p) => !cancelled && setPresence(p),
      onActivity: (a) => !cancelled && setActivity(a),
      onError: (e) => !cancelled && setError(e),
      onClosed: () => !cancelled && setError('closed'),
      onClose: () => !cancelled && setError((e) => e ?? 'disconnected'),
    });
    if (!conn) {
      setError('not-configured');
      return;
    }
    connRef.current = conn;
    return () => {
      cancelled = true;
      conn.close();
    };
  }, [roomId, name]);

  const join = () => {
    if (!nameDraft.trim()) return;
    setMyName(nameDraft.trim());
    setName(nameDraft.trim());
  };

  if (!name) {
    return (
      <div className="mx-auto max-w-sm space-y-3 px-4 py-16 text-center">
        <h1 className="text-xl font-black text-amber-950">🦁 Armonim FC — live room</h1>
        <p className="text-sm text-amber-900/70">What's your name? It's shown next to any change you make.</p>
        <div className="flex gap-2">
          <input
            dir="auto"
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            placeholder="Your name"
            className="flex-1 rounded-lg border border-amber-900/30 bg-white px-3 py-2 text-amber-950 outline-none focus:border-orange-500"
          />
          <button
            onClick={join}
            disabled={!nameDraft.trim()}
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-amber-50 disabled:opacity-40"
          >
            Join
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    const msg =
      error === 'room-not-found'
        ? "This room doesn't exist — ask the host to send a fresh link."
        : error === 'closed'
          ? 'The host closed this room.'
          : error === 'not-configured'
            ? 'Live rooms are not set up for this app.'
            : "Lost connection to the room — try reopening the host's link.";
    return (
      <div className="mx-auto max-w-sm space-y-2 px-4 py-16 text-center">
        <h1 className="text-xl font-black text-amber-950">🦁 Armonim FC</h1>
        <p className="text-sm text-amber-900/70">{msg}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 text-center text-sm text-amber-900/60">
        Connecting…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-3 px-3 py-5 sm:px-6">
      <h1 className="text-lg font-black text-amber-950">
        <span className="mr-2">🦁</span>Armonim FC — live
      </h1>
      <div className="rounded-2xl border border-red-600/20 bg-red-600/5 p-3 shadow-sm">
        <LiveRoomBar presence={presence} activity={activity} colorOf={colorOf} />
      </div>
      <TeamsBoard
        teams={state.teams}
        players={state.players}
        gkIds={state.gkIds}
        highlight={highlight}
        onTeamsChange={(teams) => {
          setState((s) => (s ? { ...s, teams } : s));
          connRef.current?.sendSync(teams);
        }}
      />
    </div>
  );
}
