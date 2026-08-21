import type { ClockState, LiveFixture, MatchLogEntry } from '../types';
import { TEAM_COLORS } from '../balancer';
import { Name, TEAM_META } from './ui';
import MatchClock from './MatchClock';
import MatchLog from './MatchLog';
import ScoreBar from './ScoreBar';

interface Props {
  fixture: LiveFixture;
  onChangeClock: (clock: ClockState) => void;
  onChangeLog: (log: MatchLogEntry[]) => void;
  // Present for an organiser who is *not* running the night on this device —
  // see the note on the button below. Absent for everyone else.
  onEndFixture?: () => void;
}

const agoLabel = (startedAt: number): string => {
  const mins = Math.floor((Date.now() - startedAt) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
};

// What the rest of the group sees while a fixture is on (§2.15). The teams
// half is read-only by construction rather than by hiding buttons: the payload
// behind it (LivePlayer) has no ratings in it to leak and no result to edit,
// so there is nothing here an organiser's screen would have shown differently.
//
// The clock and the match log are the exceptions, and deliberately so — both
// are shared, and anyone can work them. A match ends and whoever is nearest a
// phone writes down who won; there is no reason that has to be the organiser,
// and every reason it shouldn't be (they are usually playing).
//
// Deliberately not the teams board. That one is a work surface — drag targets,
// rating averages, keep-apart warnings — and this is the answer to one
// question a player has while walking to the pitch: which shirt am I in, and
// how long is left.
export default function LiveFixtureView({
  fixture,
  onChangeClock,
  onChangeLog,
  onEndFixture,
}: Props) {
  const byId = new Map(fixture.players.map((p) => [p.id, p]));
  const gkSet = new Set(fixture.gkIds);
  // absent on a fixture published by an older build, which is a night with
  // nothing written down rather than a broken one
  const matchLog = fixture.matchLog ?? [];

  // Ending a night must never depend on which phone the organiser happens to
  // be holding — without this, an organiser whose browser was cleared could see
  // a fixture they owned and have no way to stop it, which is exactly what
  // happened. Reached only in the moment before an admin device has rebuilt the
  // night locally (App's adoptLive), or when it can't: everything else on the
  // organiser's page needs teams and ratings this view doesn't carry, but
  // *ending* needs nothing but the admin word.
  const end = () => {
    if (
      confirm(
        "End tonight's fixture for everyone?\n\nThe live view disappears from the group's phones. Nothing already saved to history is affected.",
      )
    ) {
      onEndFixture?.();
    }
  };

  return (
    <div className="space-y-4">
      <ScoreBar clock={fixture.clock} log={matchLog} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-lg font-black text-amber-950">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
          </span>
          Tonight's fixture
        </h2>
        <span className="text-sm text-amber-900/55">kicked off {agoLabel(fixture.startedAt)}</span>
        {onEndFixture && (
          <>
            <div className="flex-1" />
            <button
              onClick={end}
              className="rounded-xl border border-red-500/60 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              ⏹️ End fixture
            </button>
          </>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {TEAM_COLORS.map((c) => {
          const m = TEAM_META[c];
          const ids = fixture.teams[c];
          return (
            <div key={c} className={`pop-in rounded-xl border p-3 shadow-md ${m.card}`}>
              <div className="mb-2 flex items-baseline justify-between gap-x-2 px-0.5">
                <h3 className={`text-sm font-black ${m.header}`}>
                  {m.emoji} {m.label}
                </h3>
                {/* how many, but never how good — the rating average that sits
                    here on the organiser's board is a judgement about people
                    and stays on the organiser's board */}
                <span className={`text-[11px] font-semibold ${m.sub}`}>
                  {ids.length} player{ids.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul dir="rtl" className="space-y-1">
                {ids.map((id) => {
                  const p = byId.get(id);
                  if (!p) return null;
                  return (
                    <li
                      key={id}
                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-semibold ${m.row}`}
                    >
                      {gkSet.has(id) && <span title="Goalkeeper tonight">🧤</span>}
                      <Name className="min-w-0 flex-1 truncate">{p.name}</Name>
                      {p.isGuest && (
                        <span className={`text-[9px] ${m.sub}`} title="Guest">
                          ★
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <MatchClock state={fixture.clock} onChange={onChangeClock} fixtureId={fixture.id} />

      <MatchLog log={matchLog} onChange={onChangeLog} />
    </div>
  );
}
