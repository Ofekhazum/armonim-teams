import type { LiveFixture } from '../types';
import { TEAM_COLORS } from '../balancer';
import { Name, TEAM_META } from './ui';
import MatchClock from './MatchClock';

interface Props {
  fixture: LiveFixture;
}

const agoLabel = (startedAt: number): string => {
  const mins = Math.floor((Date.now() - startedAt) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
};

// What the rest of the group sees while a fixture is on (§2.14). Read-only by
// construction, not by hiding buttons: the payload behind it (LivePlayer) has
// no ratings in it to leak and no result to edit, so there is nothing on this
// screen that an organiser's screen would have shown differently.
//
// Deliberately not the teams board. That one is a work surface — drag targets,
// rating averages, keep-apart warnings — and this is the answer to one
// question a player has while walking to the pitch: which shirt am I in, and
// how long is left.
export default function LiveFixtureView({ fixture }: Props) {
  const byId = new Map(fixture.players.map((p) => [p.id, p]));
  const gkSet = new Set(fixture.gkIds);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-lg font-black text-amber-950">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
          </span>
          Tonight's fixture
        </h2>
        <span className="text-sm text-amber-900/55">kicked off {agoLabel(fixture.startedAt)}</span>
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

      <MatchClock state={fixture.clock} />
    </div>
  );
}
