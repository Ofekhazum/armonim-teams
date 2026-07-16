import { useState } from 'react';
import type { Player, Session } from '../types';
import { emptySession, uid } from '../storage';
import { generateTeams, targetSizes } from '../balancer';
import TeamsBoard from './TeamsBoard';
import { fmtRating, Name, RATING_STEPS, STYLE_META } from './ui';

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
    if (!gName.trim() || !gInviter) return;
    const guest: Player = {
      id: uid(),
      name: gName.trim(),
      rating: gRating === '?' ? 3.5 : gRating,
      ratingUnknown: gRating === '?',
      playstyle: 'mixed',
      isGuest: true,
      invitedBy: gInviter,
      chemistry: [],
    };
    setSession({ ...session, guests: [...session.guests, guest] });
    setGName('');
    setGRating('?');
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
    setSession({ ...session, teams: session.teamAlts[next], altIndex: next });
  };

  if (session.teams) {
    return (
      <TeamsBoard
        teams={session.teams}
        players={todays}
        gkIds={effectiveGkIds}
        onTeamsChange={(teams) => setSession({ ...session, teams })}
        onReroll={session.teamAlts.length > 1 ? reroll : undefined}
        rerollLabel={
          session.teamAlts.length > 1
            ? `Variation ${session.altIndex + 1}/${session.teamAlts.length}`
            : undefined
        }
        onBack={() => {
          setSession({ ...session, teams: null });
          setStep('gk');
        }}
        onNewFixture={() => {
          setSession(emptySession());
          setStep('players');
        }}
      />
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
          )}

          <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
            <h3 className="font-bold text-amber-950">Guests</h3>
            <p className="mb-3 text-xs text-amber-900/60">
              A guest always plays on the same team as the friend who brought them.
            </p>

            {session.guests.length > 0 && (
              <ul className="mb-3 space-y-1.5">
                {session.guests.map((g) => (
                  <li
                    key={g.id}
                    dir="rtl"
                    className="flex items-center gap-2 rounded-lg border border-amber-900/15 bg-white/60 px-3 py-2"
                  >
                    <Name className="font-medium text-amber-950">{g.name}</Name>
                    <span className="min-w-0 flex-1 truncate text-xs text-amber-900/60">
                      with <Name>{players.find((p) => p.id === g.invitedBy)?.name ?? '?'}</Name>
                    </span>
                    <button
                      onClick={() => removeGuest(g.id)}
                      className="text-xs font-semibold text-red-600"
                    >
                      remove
                    </button>
                  </li>
                ))}
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
                  <option value="">Invited by…</option>
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
                  disabled={!gName.trim() || !gInviter}
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
