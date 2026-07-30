import { useEffect, useRef, useState } from 'react';
import type { Player, Session } from '../types';
import { emptySession, getHostRoom, getMyName, setHostRoom, setMyName, uid } from '../storage';
import { generateTeams, targetSizes } from '../balancer';
import { parseImportList, resolveImportedNames } from '../importRoster';
import { ROOMS_ENABLED, hostRoom, roomShareUrl } from '../liveRoom';
import type { ActivityEvent, PresenceMember, RoomConnection } from '../liveRoom';
import { createUserColorTracker } from '../userColor';
import LiveRoomBar from './LiveRoomBar';
import TeamsBoard from './TeamsBoard';
import { fmtRating, Name, RATING_STEPS, STYLE_META } from './ui';

const ACTIVITY_MS = 4000;

interface Props {
  players: Player[];
  session: Session;
  setSession: (s: Session) => void;
}

const MIN_PLAYERS = 13;
const IDEAL_PLAYERS = 15;

export default function MatchDay({ players, session, setSession }: Props) {
  const [step, setStep] = useState<'players' | 'gk'>('players');

  // guest form
  const [gName, setGName] = useState('');
  const [gInviter, setGInviter] = useState('');
  const [gRating, setGRating] = useState<'?' | number>('?');

  // paste-a-list import
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importSummary, setImportSummary] = useState<{ matched: string[]; guests: string[] } | null>(
    null,
  );

  // live room (Teams page only) — see LiveRoomBar/liveRoom.ts
  const [room, setRoom] = useState<RoomConnection | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMember[]>([]);
  const [activity, setActivity] = useState<ActivityEvent | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const colorOf = useRef(createUserColorTracker()).current;
  // lets the room's onState callback always patch the latest session, since
  // the callback is created once (in goLive) and would otherwise close over
  // a stale session from that render
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // owns how long an activity toast + its matching player-row highlight stay
  // up, so both fade together
  useEffect(() => {
    if (!activity) return;
    const t = setTimeout(() => setActivity(null), ACTIVITY_MS);
    return () => clearTimeout(t);
  }, [activity]);

  const highlight =
    activity?.ids && activity.ids.length > 0
      ? { ids: activity.ids, color: activity.by ? colorOf(activity.by) : '#78350f' }
      : null;

  const selectedMembers = players.filter((p) => session.availableIds.includes(p.id));
  const todays: Player[] = [...selectedMembers, ...session.guests];
  const count = todays.length;

  // permanent goalkeepers (playstyle 'gk') are always GK-capable
  const effectiveGkIds = [
    ...new Set([
      ...todays.filter((p) => p.playstyle === 'gk').map((p) => p.id),
      ...session.gkIds.filter((id) => todays.some((p) => p.id === id)),
    ]),
  ];

  const toggleAvailable = (id: string) => {
    const has = session.availableIds.includes(id);
    setSession({
      ...session,
      availableIds: has
        ? session.availableIds.filter((x) => x !== id)
        : [...session.availableIds, id],
      // deselecting a member also drops their guests
      guests: has ? session.guests.filter((g) => g.invitedBy !== id) : session.guests,
    });
  };

  const addGuest = () => {
    if (!gName.trim()) return;
    const guest: Player = {
      id: uid(),
      name: gName.trim(),
      rating: gRating === '?' ? 3.5 : gRating,
      ratingUnknown: gRating === '?',
      playstyle: 'mixed',
      isGuest: true,
      // no inviter → the guest is balanced freely instead of pinned to a team
      ...(gInviter ? { invitedBy: gInviter } : {}),
      chemistry: [],
    };
    setSession({ ...session, guests: [...session.guests, guest] });
    setGName('');
    setGInviter('');
    setGRating('?');
  };

  const applyImport = () => {
    const names = parseImportList(importText);
    // pasting a list is a full override — it replaces availability and guests
    // entirely, rather than merging with whatever was picked before
    const { availableIds, guests, matchedNames, guestNames } = resolveImportedNames(
      names,
      players,
      [],
      (name) => ({
        id: uid(),
        name,
        rating: 3.5,
        ratingUnknown: true,
        playstyle: 'mixed',
        isGuest: true,
        chemistry: [],
      }),
    );
    const knownIds = new Set([...availableIds, ...guests.map((g) => g.id)]);
    setSession({
      ...session,
      availableIds,
      guests,
      gkIds: session.gkIds.filter((id) => knownIds.has(id)),
    });
    setImportSummary({ matched: matchedNames, guests: guestNames });
    setImportText('');
  };

  const updateGuestRating = (id: string, value: string) => {
    setSession({
      ...session,
      guests: session.guests.map((g) =>
        g.id === id
          ? value === '?'
            ? { ...g, rating: 3.5, ratingUnknown: true }
            : { ...g, rating: Number(value), ratingUnknown: false }
          : g,
      ),
    });
  };

  const updateGuestInviter = (id: string, inviterId: string) => {
    setSession({
      ...session,
      guests: session.guests.map((g) =>
        g.id === id ? { ...g, invitedBy: inviterId || undefined } : g,
      ),
    });
  };

  const removeGuest = (id: string) => {
    setSession({
      ...session,
      guests: session.guests.filter((g) => g.id !== id),
      gkIds: session.gkIds.filter((x) => x !== id),
    });
  };

  const toggleGk = (id: string) => {
    setSession({
      ...session,
      gkIds: session.gkIds.includes(id)
        ? session.gkIds.filter((x) => x !== id)
        : [...session.gkIds, id],
    });
  };

  const generate = () => {
    const results = generateTeams(todays, new Set(effectiveGkIds));
    setSession({ ...session, teams: results[0] ?? null, teamAlts: results, altIndex: 0 });
  };

  const reroll = () => {
    if (session.teamAlts.length < 2) return;
    const next = (session.altIndex + 1) % session.teamAlts.length;
    const teams = session.teamAlts[next];
    setSession({ ...session, teams, altIndex: next });
    room?.sendSync(teams);
  };

  const leaveRoom = () => {
    room?.close();
    setRoom(null);
    setRoomId(null);
    setPresence([]);
    setActivity(null);
  };

  // Turns the current (already-generated) teams into a live room: guests who
  // open the share link land straight on this same board, restricted to
  // dragging players between teams. Reuses the same room id/token across
  // re-visits so a previously shared link keeps working.
  const goLive = () => {
    if (!session.teams) return;
    let name = getMyName();
    if (!name) {
      const entered = window.prompt('Pick a name to show when you make changes:');
      if (!entered?.trim()) return;
      name = entered.trim();
      setMyName(name);
    }
    const existing = getHostRoom();
    const id = existing?.roomId ?? uid();
    const token = existing?.adminToken ?? uid();
    setHostRoom({ roomId: id, adminToken: token });
    const conn = hostRoom(
      id,
      token,
      name,
      { players: todays, teams: session.teams, gkIds: effectiveGkIds },
      {
        onState: (state) => setSession({ ...sessionRef.current, teams: state.teams }),
        onPresence: setPresence,
        onActivity: setActivity,
        onError: () => {},
        onClose: () => setRoom(null),
        // fires if the room got closed from elsewhere (e.g. this host open
        // in a second tab) — clean up here too so state stays consistent
        onClosed: () => {
          leaveRoom();
          setHostRoom(null);
        },
      },
    );
    setRoom(conn);
    setRoomId(id);
  };

  const closeRoomAction = () => {
    if (!confirm('Close the room? Anyone with the link will be disconnected.')) return;
    room?.closeRoom();
    leaveRoom();
    setHostRoom(null);
  };

  const copyRoomLink = async () => {
    if (!roomId) return;
    const url = roomShareUrl(roomId);
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      window.prompt('Copy the room link:', url);
    }
  };

  if (session.teams) {
    return (
      <div className="space-y-3">
        {ROOMS_ENABLED &&
          (room ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-red-600/20 bg-red-600/5 p-3 shadow-sm">
              <LiveRoomBar presence={presence} activity={activity} colorOf={colorOf} />
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={copyRoomLink}
                  className="rounded-lg border border-amber-900/30 bg-white/70 px-3 py-1.5 text-xs font-bold text-amber-900 hover:border-orange-500"
                >
                  {linkCopied ? '✓ Link copied!' : '📋 Copy link'}
                </button>
                <button
                  onClick={closeRoomAction}
                  className="rounded-lg border border-red-500/60 bg-white/70 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50"
                >
                  ✕ Close room
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <button
                onClick={goLive}
                className="rounded-lg border border-red-500/60 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50"
              >
                🔴 Go live — let others move players in real time
              </button>
            </div>
          ))}
        <TeamsBoard
          teams={session.teams}
          players={todays}
          gkIds={effectiveGkIds}
          highlight={highlight}
          onTeamsChange={(teams) => {
            setSession({ ...session, teams });
            room?.sendSync(teams);
          }}
          onReroll={session.teamAlts.length > 1 ? reroll : undefined}
          rerollLabel={
            session.teamAlts.length > 1
              ? `Variation ${session.altIndex + 1}/${session.teamAlts.length}`
              : undefined
          }
          onBack={() => {
            leaveRoom();
            setSession({ ...session, teams: null });
            setStep('gk');
          }}
          onNewFixture={() => {
            // tell any connected guests the room's gone, not just forget it
            // locally and leave it orphaned in storage
            room?.closeRoom();
            leaveRoom();
            setHostRoom(null);
            setSession(emptySession());
            setStep('players');
          }}
        />
      </div>
    );
  }

  const status =
    count < MIN_PLAYERS
      ? {
          cls: 'border-red-600/40 bg-red-600/10 text-red-800',
          msg: `Need at least ${MIN_PLAYERS} players for the fixture — currently ${count}.`,
        }
      : count === IDEAL_PLAYERS
        ? {
            cls: 'border-green-600/40 bg-green-600/10 text-green-800',
            msg: 'Perfect — three full teams of 5! 🎉',
          }
        : count < IDEAL_PLAYERS
          ? {
              cls: 'border-amber-600/50 bg-amber-500/15 text-amber-900',
              msg: `${count} players — teams of ${targetSizes(count).join('/')}. The resting team will lend players each match (rotation plan included).`,
            }
          : {
              cls: 'border-sky-600/40 bg-sky-600/10 text-sky-800',
              msg: `${count} players — teams of ${targetSizes(count).join('/')}.`,
            };

  const sortedMembers = [...players].sort((a, b) => a.name.localeCompare(b.name, 'he'));

  return (
    <div className="space-y-4">
      {/* step indicator */}
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <span className={step === 'players' ? 'text-orange-700' : 'text-amber-900/40'}>
          1 · Who's playing
        </span>
        <span className="text-amber-900/30">→</span>
        <span className={step === 'gk' ? 'text-orange-700' : 'text-amber-900/40'}>
          2 · Goalkeepers
        </span>
        <span className="text-amber-900/30">→</span>
        <span className="text-amber-900/40">3 · Teams</span>
      </div>

      <div
        className={`sticky top-2 z-20 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-md backdrop-blur-sm ${status.cls}`}
      >
        {status.msg}
      </div>

      {step === 'players' && (
        <div className="pop-in space-y-4">
          {players.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-amber-900/30 p-10 text-center text-amber-900/70">
              The roster is empty — add players in the <b>Roster</b> tab first.
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
                <button
                  onClick={() => setShowImport((v) => !v)}
                  className="font-bold text-amber-950"
                >
                  📋 Import a pasted list {showImport ? '▲' : '▼'}
                </button>
                {showImport && (
                  <div className="pop-in mt-3 space-y-2">
                    <p className="text-xs text-amber-900/60">
                      Paste the numbered player list (e.g. from WhatsApp). Recognized names get
                      checked off below; unrecognized names are added as guests automatically.
                      This replaces the current selection and guest list entirely.
                    </p>
                    <textarea
                      dir="auto"
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder={'1. חנגל\n2. הלחמי\n3. דורגי\n...'}
                      rows={6}
                      className="w-full rounded-lg border border-amber-900/30 bg-white px-3 py-2 text-sm text-amber-950 outline-none focus:border-orange-500"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={applyImport}
                        disabled={!importText.trim()}
                        className="rounded-lg bg-amber-900 px-4 py-2 text-sm font-bold text-amber-50 disabled:opacity-40"
                      >
                        Match & add
                      </button>
                      {importSummary && (
                        <span className="text-xs text-amber-900/70">
                          ✅ Matched {importSummary.matched.length}
                          {importSummary.guests.length > 0 &&
                            `, added ${importSummary.guests.length} guest(s): ${importSummary.guests.join(', ')}`}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
                <h3 className="mb-3 font-bold text-amber-950">
                  Available today{' '}
                <span className="text-sm font-normal text-amber-900/60">
                  ({selectedMembers.length} of {players.length} selected)
                </span>
              </h3>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {sortedMembers.map((p) => {
                  const on = session.availableIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleAvailable(p.id)}
                      dir="rtl"
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                        on
                          ? 'border-orange-500/70 bg-orange-500/10'
                          : 'border-amber-900/15 bg-white/60 opacity-70 hover:opacity-100'
                      }`}
                    >
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs font-bold ${
                          on
                            ? 'border-orange-600 bg-orange-600 text-amber-50'
                            : 'border-amber-900/40'
                        }`}
                      >
                        {on ? '✓' : ''}
                      </span>
                      <Name className="min-w-0 flex-1 truncate font-medium text-amber-950">
                        {p.name}
                      </Name>
                    </button>
                  );
                })}
              </div>
              </div>
            </>
          )}

          <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
            <h3 className="font-bold text-amber-950">Guests</h3>
            <p className="mb-3 text-xs text-amber-900/60">
              A guest plays on the same team as the friend who brought them. Leave the
              inviter empty if you don't know who brought them.
            </p>

            {session.guests.length > 0 && (
              <ul className="mb-3 space-y-1.5">
                {session.guests.map((g) => {
                  // the inviter might have been deselected since — still offer them so the
                  // dropdown doesn't silently blank out an existing pick
                  const inviterOptions =
                    g.invitedBy && !selectedMembers.some((p) => p.id === g.invitedBy)
                      ? [...selectedMembers, players.find((p) => p.id === g.invitedBy)!].filter(
                          Boolean,
                        )
                      : selectedMembers;
                  return (
                    <li
                      key={g.id}
                      dir="rtl"
                      className="space-y-1.5 rounded-lg border border-amber-900/15 bg-white/60 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Name className="min-w-0 flex-1 truncate font-medium text-amber-950">
                          {g.name}
                        </Name>
                        <button
                          onClick={() => removeGuest(g.id)}
                          className="shrink-0 text-xs font-semibold text-red-600"
                        >
                          remove
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <select
                          value={g.ratingUnknown ? '?' : String(g.rating)}
                          onChange={(e) => updateGuestRating(g.id, e.target.value)}
                          className="min-w-0 flex-1 rounded-lg border border-amber-900/30 bg-white px-2 py-1.5 text-xs text-amber-950 outline-none focus:border-orange-500"
                          title="Rating"
                        >
                          <option value="?">Rating: ?</option>
                          {RATING_STEPS.map((r) => (
                            <option key={r} value={r}>
                              Rating: {fmtRating(r)}
                            </option>
                          ))}
                        </select>
                        <select
                          value={g.invitedBy ?? ''}
                          onChange={(e) => updateGuestInviter(g.id, e.target.value)}
                          className="min-w-0 flex-1 rounded-lg border border-amber-900/30 bg-white px-2 py-1.5 text-xs text-amber-950 outline-none focus:border-orange-500"
                          title="Invited by"
                        >
                          <option value="">No inviter</option>
                          {inviterOptions.map((p) => (
                            <option key={p.id} value={p.id} dir="auto">
                              with {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {selectedMembers.length === 0 ? (
              <p className="text-sm text-amber-900/50">Select available players first.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  dir="auto"
                  value={gName}
                  onChange={(e) => setGName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addGuest()}
                  placeholder="Guest name"
                  className="w-40 rounded-lg border border-amber-900/30 bg-white px-3 py-2 text-sm text-amber-950 outline-none focus:border-orange-500"
                />
                <select
                  value={gInviter}
                  onChange={(e) => setGInviter(e.target.value)}
                  className="rounded-lg border border-amber-900/30 bg-white px-2 py-2 text-sm text-amber-950 outline-none focus:border-orange-500"
                >
                  <option value="">Invited by… (optional)</option>
                  {selectedMembers.map((p) => (
                    <option key={p.id} value={p.id} dir="auto">
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={String(gRating)}
                  onChange={(e) =>
                    setGRating(e.target.value === '?' ? '?' : Number(e.target.value))
                  }
                  className="rounded-lg border border-amber-900/30 bg-white px-2 py-2 text-sm text-amber-950 outline-none focus:border-orange-500"
                  title="Rating, if you can guess it"
                >
                  <option value="?">Rating: ?</option>
                  {RATING_STEPS.map((r) => (
                    <option key={r} value={r}>
                      Rating: {fmtRating(r)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={addGuest}
                  disabled={!gName.trim()}
                  className="rounded-lg bg-amber-900 px-4 py-2 text-sm font-bold text-amber-50 disabled:opacity-40"
                >
                  + Add guest
                </button>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => setStep('gk')}
              disabled={count < 6}
              className="rounded-xl bg-orange-600 px-6 py-2.5 font-bold text-amber-50 shadow-sm transition-transform hover:scale-105 disabled:opacity-40"
            >
              Next: goalkeepers →
            </button>
          </div>
        </div>
      )}

      {step === 'gk' && (
        <div className="pop-in space-y-4">
          <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
            <h3 className="font-bold text-amber-950">🧤 Who can play goalkeeper today?</h3>
            <p className="mb-3 text-xs text-amber-900/60">
              This changes week to week — mark everyone who can go in goal today. Keepers
              get spread across the teams.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {todays.map((p) => {
                const permanent = p.playstyle === 'gk';
                const on = permanent || session.gkIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => !permanent && toggleGk(p.id)}
                    disabled={permanent}
                    dir="rtl"
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                      on
                        ? 'border-amber-500 bg-amber-400/25'
                        : 'border-amber-900/15 bg-white/60 opacity-70 hover:opacity-100'
                    } ${permanent ? 'cursor-default' : ''}`}
                  >
                    <span className="text-lg">{on ? '🧤' : '·'}</span>
                    <Name className="min-w-0 flex-1 truncate font-medium text-amber-950">
                      {p.name}
                    </Name>
                    {permanent && (
                      <span className="rounded bg-amber-900/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900/70">
                        always
                      </span>
                    )}
                    <span title={STYLE_META[p.playstyle].label}>
                      {STYLE_META[p.playstyle].icon}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep('players')}
              className="rounded-xl border border-amber-900/30 px-5 py-2.5 font-semibold text-amber-900"
            >
              ← Back
            </button>
            <button
              onClick={generate}
              className="rounded-xl bg-orange-600 px-6 py-2.5 font-bold text-amber-50 shadow-sm transition-transform hover:scale-105"
            >
              ⚡ Generate teams
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
