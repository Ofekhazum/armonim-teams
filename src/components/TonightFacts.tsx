import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FixtureRecord, Teams, TonightPlayer } from '../types';
import type { Milestone } from '../milestones';
import type { DuoFact } from '../duos';
import { tonightsMilestones } from '../milestones';
import { bountyTonight, pendingTonight } from '../radar';
import { duoFacts } from '../duos';
import { derbyTonight } from '../derby';
import DerbyBanner from './DerbyBanner';
import { FoldHeader, Name } from './ui';

// The two strips that say what tonight means: what is on the line, and what has
// already been reached. Lifted out of the organiser's fixture page so the
// group's live view can render the identical thing — they were the only real
// difference between the two pages, and the difference had no reason to exist.
// These are counts of who has turned up, which is the group's own record; the
// organiser's page carries private things (ratings, averages, keep-apart) and
// those stay there. See §2.21.

/**
 * Which panels have been folded away, **for the length of one fixture** (§2.34).
 *
 * Two separate decisions, and they pull in opposite directions.
 *
 * **It has to survive a reload**, which is why this is storage at all rather
 * than plain state. The live view is reloaded constantly at a pitch — a phone
 * locks, a signal drops, somebody re-opens the link — and re-folding three
 * panels every time is precisely the annoyance folding was added to remove.
 *
 * **It has to die with the fixture**, which is why the key carries the
 * fixture's id. A fold is a decision about *tonight's* facts: this derby, this
 * set of near-milestones. Carrying it into next Thursday would mean somebody
 * who tidied the page away once silently gets a barer app every week after,
 * with no memory of having asked for it — and the facts are the reason the
 * strip exists. Keying on the fixture makes "it ends when the fixture ends"
 * true without anything having to notice that it ended; a write also drops
 * every other fixture's entry, so at most one is ever kept.
 *
 * `sessionStorage` rather than `localStorage` as the backstop: closing the tab
 * is a second thing that ends a night, and neither one should outlive it.
 */
const FOLD_PREFIX = 'armonim:folded:';

const foldKey = (fixtureId?: string | null) => `${FOLD_PREFIX}${fixtureId ?? 'unpublished'}`;

type PanelId = 'line' | 'derby' | 'facts';

const readFolded = (key: string): string[] => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    // Private browsing, a full quota, a hostile embed. A fold that fails to
    // persist is not worth breaking a match night over — open is the default
    // and open is the safe answer.
    return [];
  }
};

const writeFolded = (key: string, ids: string[]) => {
  try {
    // Sweep every other fixture's folds on the way past. Backwards, because
    // removing shifts the indices of everything after it.
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(FOLD_PREFIX) && k !== key) sessionStorage.removeItem(k);
    }
    sessionStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* see readFolded */
  }
};

function useFold(id: PanelId, fixtureId?: string | null): [boolean, () => void] {
  const key = foldKey(fixtureId);
  const [open, setOpen] = useState(() => !readFolded(key).includes(id));

  // The id arrives late: a fixture has no published id until the organiser
  // publishes it, so this page can be showing one night under two keys in the
  // same sitting. Re-deriving on the key rather than only on mount is what
  // stops the folds from a moment ago being read back off the wrong entry.
  useEffect(() => {
    setOpen(!readFolded(key).includes(id));
  }, [key, id]);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    // Re-read rather than hold a copy: the fixture page and a background tab
    // on the live view can both be showing this strip, and the last one to be
    // touched should not blank out the other's choices.
    const rest = readFolded(key).filter((x) => x !== id);
    writeFolded(key, next ? rest : [...rest, id]);
  }, [key, id, open]);

  return [open, toggle];
}

interface Props {
  players: TonightPlayer[];
  history: FixtureRecord[];
  // Tonight's shirts. Optional because a derby is the one fact here that needs
  // to know who is *opposite* whom rather than just who turned up — a caller
  // without teams drawn yet gets everything else and no banner.
  teams?: Teams | null;
  // Tonight's own record, once it has been saved, so the arithmetic doesn't
  // count tonight as a past night. See LiveFixtureView for the viewer's version
  // of the same exclusion, which has a date rather than an id to work with.
  tonightId?: string | null;
  // What the folds are scoped to, so they end when the night does. Separate
  // from `tonightId` because they answer different questions — that one is
  // "which record must the arithmetic skip", this one is "which night am I
  // making a decision about", and on an unpublished fixture only one of them
  // exists.
  fixtureId?: string | null;
}

export default function TonightFacts({
  players,
  history,
  teams = null,
  tonightId = null,
  fixtureId = null,
}: Props) {
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
  // The one fact on this strip about two players *opposing* each other, which
  // is why it needs the shirts and everything else here does not (§2.33).
  const derby = useMemo(
    () => (teams ? derbyTonight(teams, players, history, tonightId) : null),
    [teams, players, history, tonightId],
  );

  const [lineOpen, toggleLine] = useFold('line', fixtureId);
  const [derbyOpen, toggleDerby] = useFold('derby', fixtureId);
  const [factsOpen, toggleFacts] = useFold('facts', fixtureId);

  return (
    <>
      {/* Forward-looking, so it sits above the facts about what has already
          happened rather than mixed in with them. A player reading this before
          kick-off is being told what is at stake, not what is true. */}
      {(pending.length > 0 || bounty) && (
        <div className="rounded-2xl border border-orange-500/25 bg-orange-50/60 px-4 py-2.5">
          <FoldHeader
            title="🎯 On the line tonight"
            open={lineOpen}
            onToggle={toggleLine}
            className="text-orange-800/70"
          />
          {lineOpen && (
          <div className="mt-1 flex flex-col gap-1 text-sm text-amber-900">
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
          )}
          {lineOpen && bounty && (
            <p className="mt-1.5 border-t border-orange-500/15 pt-1.5 text-sm font-semibold text-orange-900">
              🎖️ Bounty — <Name className="font-black">{bounty.name}</Name> is on {bounty.nights}{' '}
              winning nights. Somebody end it.
            </p>
          )}
        </div>
      )}

      {/* Above the milestones: a derby is about what is *about to* happen,
          like "on the line tonight" above it, where the strip below is about
          what already has. */}
      <DerbyBanner derby={derby} open={derbyOpen} onToggle={toggleDerby} />

      {/* The only one of the three with no heading of its own, so folding it
          had to give it one. "Coming in tonight" is the counterpart to "on the
          line tonight" directly above: what everybody is bringing to the pitch,
          as against what they could leave with. */}
      <MilestoneStrip
        milestones={milestones}
        duos={duos}
        title="📋 Coming in tonight"
        open={factsOpen}
        onToggle={toggleFacts}
      />
    </>
  );
}

// The same strip on a past night's page, where it says what that night turned
// out to be rather than what tonight might. Exported for NightPage: the facts
// are the same facts, counted as of the night in question (§2.22).
export function MilestoneStrip({
  milestones,
  duos,
  title,
  open = true,
  onToggle,
}: {
  milestones: Milestone[];
  duos: DuoFact[];
  // A heading, and with it the fold. Optional because the night page shows
  // this strip as the record of a night that is already over — one panel on a
  // page of panels, where nothing needs folding away to reach a clock. Left
  // off, this renders exactly what it always did.
  title?: string;
  open?: boolean;
  onToggle?: () => void;
}) {
  if (milestones.length === 0 && duos.length === 0) return null;
  return (
    // One fact per line. Wrapped inline, they ran together — two facts could
    // share a line and a third could straddle two, so "🏆 הלחמי's 50th win" and
    // "💪 פוגל hasn't missed a night in 10 straight" read as one long sentence
    // about somebody. These are separate claims about separate people, and a
    // line break is the cheapest possible way to say so. The same argument
    // moved "on the line tonight" onto one fact per line as well.
    <div className="flex flex-col gap-1 rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 px-4 py-2.5 text-sm text-amber-900">
      {title && onToggle && (
        <FoldHeader title={title} open={open} onToggle={onToggle} className="text-amber-900/60" />
      )}
      {!open ? null : (
        <>
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
        </>
      )}
    </div>
  );
}
