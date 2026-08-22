import { useMemo } from 'react';
import type { FixtureRecord, TonightPlayer } from '../types';
import type { Milestone } from '../milestones';
import type { DuoFact } from '../duos';
import { tonightsMilestones } from '../milestones';
import { bountyTonight, pendingTonight } from '../radar';
import { duoFacts } from '../duos';
import { Name } from './ui';

// The two strips that say what tonight means: what is on the line, and what has
// already been reached. Lifted out of the organiser's fixture page so the
// group's live view can render the identical thing — they were the only real
// difference between the two pages, and the difference had no reason to exist.
// These are counts of who has turned up, which is the group's own record; the
// organiser's page carries private things (ratings, averages, keep-apart) and
// those stay there. See §2.21.

interface Props {
  players: TonightPlayer[];
  history: FixtureRecord[];
  // Tonight's own record, once it has been saved, so the arithmetic doesn't
  // count tonight as a past night. See LiveFixtureView for the viewer's version
  // of the same exclusion, which has a date rather than an id to work with.
  tonightId?: string | null;
}

export default function TonightFacts({ players, history, tonightId = null }: Props) {
  // What tonight could turn into, as against what it already is (§2.19). Same
  // ledger, read one night short of the line.
  const pending = useMemo(
    () => pendingTonight(players, history, tonightId),
    [players, history, tonightId],
  );
  const bounty = useMemo(
    () => bountyTonight(players, history, tonightId),
    [players, history, tonightId],
  );
  const milestones = useMemo(
    () => tonightsMilestones(players, history, tonightId),
    [players, history, tonightId],
  );
  const duos = useMemo(() => duoFacts(players, history, tonightId), [players, history, tonightId]);

  return (
    <>
      {/* Forward-looking, so it sits above the facts about what has already
          happened rather than mixed in with them. A player reading this before
          kick-off is being told what is at stake, not what is true. */}
      {(pending.length > 0 || bounty) && (
        <div className="rounded-2xl border border-orange-500/25 bg-orange-50/60 px-4 py-2.5">
          <h3 className="mb-1 text-[11px] font-black uppercase tracking-wide text-orange-800/70">
            🎯 On the line tonight
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-amber-900">
            {pending.map((f) => {
              switch (f.kind) {
                case 'nth-win':
                  return (
                    <span key={`w${f.id}`}>
                      🏆 <Name className="font-bold">{f.name}</Name> is {f.away} from {f.target}{' '}
                      career wins
                    </span>
                  );
                case 'iron-man':
                  return (
                    <span key={`i${f.id}`}>
                      🦾 <Name className="font-bold">{f.name}</Name> makes it {f.current + 1} nights
                      in a row by turning up
                    </span>
                  );
                case 'win-streak':
                  return (
                    <span key={`s${f.id}`}>
                      📈 <Name className="font-bold">{f.name}</Name>'s team wins and that's{' '}
                      {f.current + 1} nights running
                    </span>
                  );
              }
            })}
          </div>
          {bounty && (
            <p className="mt-1.5 border-t border-orange-500/15 pt-1.5 text-sm font-semibold text-orange-900">
              🎖️ Bounty — <Name className="font-black">{bounty.name}</Name> is on {bounty.nights}{' '}
              winning nights. Somebody end it.
            </p>
          )}
        </div>
      )}

      <MilestoneStrip milestones={milestones} duos={duos} />
    </>
  );
}

// The same strip on a past night's page, where it says what that night turned
// out to be rather than what tonight might. Exported for NightPage: the facts
// are the same facts, counted as of the night in question (§2.22).
export function MilestoneStrip({
  milestones,
  duos,
}: {
  milestones: Milestone[];
  duos: DuoFact[];
}) {
  if (milestones.length === 0 && duos.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 px-4 py-2.5 text-sm text-amber-900">
      {/* Wording stays factual on purpose — "won 3 nights running" is a
          count, "on fire" would be a claim about how they're playing that
          a night's three win totals can't back up (§2.9). */}
      {milestones.map((m) => {
        switch (m.kind) {
          case 'debut-group':
            return <span key="debuts">✨ {m.count} first nights tonight</span>;
          case 'debut':
            return (
              <span key={m.id}>
                ✨ First night for <Name className="font-bold">{m.name}</Name>
              </span>
            );
          case 'nth-night':
            return (
              <span key={m.id}>
                🎉 <Name className="font-bold">{m.name}</Name>'s {m.nights}th night
              </span>
            );
          case 'nth-win':
            return (
              <span key={`w${m.id}`}>
                🏆 <Name className="font-bold">{m.name}</Name>'s {m.wins}th win
              </span>
            );
          case 'iron-man':
            return (
              <span key={`i${m.id}`}>
                🦾 <Name className="font-bold">{m.name}</Name> hasn't missed a night in{' '}
                {m.nights} straight
              </span>
            );
          case 'win-streak':
            return (
              <span key={`s${m.id}`}>
                📈 <Name className="font-bold">{m.name}</Name> has won {m.nights} nights running
              </span>
            );
          case 'winless':
            return (
              <span key={`l${m.id}`}>
                💤 <Name className="font-bold">{m.name}</Name> hasn't won in {m.nights} nights
              </span>
            );
        }
      })}
      {/* Always the raw record ("won 5 of 8 nights together"), never a
          verdict like "these two click" — see the sample-size note in
          duos.ts for why the stronger claim isn't available. */}
      {duos.map((d) => (
        <span key={`${d.kind}${d.aName}${d.bName}`}>
          {d.kind === 'together-better' ? '🤝' : '🙃'}{' '}
          <Name className="font-bold">{d.aName}</Name> &{' '}
          <Name className="font-bold">{d.bName}</Name> have won {d.won} of their {d.together}{' '}
          nights together
        </span>
      ))}
    </div>
  );
}
