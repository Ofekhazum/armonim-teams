import { useMemo, useState } from 'react';
import type { FixtureRecord } from '../types';
import type { Comparison } from '../compare';
import { comparePlayers } from '../compare';
import { Name, fmtWins } from './ui';

// Two players' records, side by side (§2.37). The counting is `compare.ts`'s
// job; this file is the pickers and the layout.
//
// **Both pickers start empty.** Defaulting to two names would put an arbitrary
// pair of friends on screen under a heading that invites comparing them, every
// time anybody opens the tab — and there is no non-arbitrary default available,
// since the app has no idea which of the twenty players is holding the phone.
// An empty state that says what to do costs one tap and assumes nothing.
//
// **The bar under each row is the ratio, and nothing is declared a win.** No
// tick, no "leads", no colour for better — the two numbers and their
// proportion, which is what a reader could work out from the table anyway.
// Where a stat is zero on both sides the bar sits empty rather than splitting
// it 50/50, because "0 against 0" is not a dead heat, it is nothing to compare.

const A_BAR = 'bg-orange-500';
const B_BAR = 'bg-sky-500';
const A_TEXT = 'text-orange-700';
const B_TEXT = 'text-sky-700';

interface Row {
  label: string;
  a: number;
  b: number;
  /** How to print it — wins carry halves, a rate carries two decimals. */
  print: (n: number) => string;
}

const int = (n: number) => String(n);
const rate = (n: number) => n.toFixed(2);

function rowsOf(c: Comparison): Row[] {
  return [
    { label: 'Nights played', a: c.a.nights, b: c.b.nights, print: int },
    { label: 'Nights won', a: c.a.nightsWon, b: c.b.nightsWon, print: int },
    { label: 'Match wins', a: c.a.wins, b: c.b.wins, print: fmtWins },
    // Directly under the nights it is divided by, so the sample size is on
    // screen with the rate rather than a scroll away (see compare.ts).
    { label: 'Per night', a: c.a.perNight ?? 0, b: c.b.perNight ?? 0, print: rate },
    { label: 'MVP picks', a: c.a.mvps, b: c.b.mvps, print: int },
    // "Longest run", not "best run" — the same stat the podium names that way
    // (§2.36), and one fewer word on this screen that could be read as a
    // judgement rather than a measurement.
    { label: 'Longest run', a: c.a.bestRun, b: c.b.bestRun, print: int },
  ];
}

function StatRow({ row }: { row: Row }) {
  const total = row.a + row.b;
  const aPct = total > 0 ? (row.a / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={`w-16 shrink-0 font-mono text-sm font-black tabular-nums ${A_TEXT}`}>
          {row.print(row.a)}
        </span>
        <span className="flex-1 text-center text-[11px] font-bold uppercase tracking-wide text-amber-900/50">
          {row.label}
        </span>
        <span className={`w-16 shrink-0 text-end font-mono text-sm font-black tabular-nums ${B_TEXT}`}>
          {row.print(row.b)}
        </span>
      </div>
      {/* `dir="ltr"` so the split reads left-to-right regardless of the names
          either side of it — the left number is always the left bar. */}
      <div dir="ltr" className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-amber-900/[0.07]">
        {total > 0 && (
          <>
            <span className={A_BAR} style={{ width: `${aPct}%` }} />
            <span className={`flex-1 ${B_BAR}`} />
          </>
        )}
      </div>
    </div>
  );
}

function Shared({ c }: { c: Comparison }) {
  const { shared } = c;
  const never = shared.together === 0 && shared.against === 0;
  return (
    <div className="space-y-1.5 rounded-xl border border-amber-900/10 bg-amber-900/[0.03] px-3 py-2.5 text-sm text-amber-900">
      {never ? (
        <p className="text-amber-900/60">
          These two have never been on the same team sheet.
        </p>
      ) : (
        <>
          {shared.together > 0 && (
            <p>
              🤝 On the same team <b className="text-amber-950">{shared.together}</b>{' '}
              {shared.together === 1 ? 'night' : 'nights'}, winning{' '}
              <b className="text-amber-950">{shared.togetherWon}</b> of them
            </p>
          )}
          {shared.against > 0 && (
            <p>
              ⚔️ On opposite teams <b className="text-amber-950">{shared.against}</b>{' '}
              {shared.against === 1 ? 'night' : 'nights'}
            </p>
          )}
          {/* Teams beat teams, never people (§2.8) — the sentence says so even
              though the label above it is allowed its fun. */}
          {shared.faced > 0 ? (
            <p>
              🥊 <Name className="font-bold text-amber-950">{c.a.name}</Name>'s team has beaten{' '}
              <Name className="font-bold text-amber-950">{c.b.name}</Name>'s in{' '}
              <b className="text-amber-950">{shared.aWon}</b> of{' '}
              <b className="text-amber-950">{shared.faced}</b> matches
            </p>
          ) : (
            shared.against > 0 && (
              <p className="text-amber-900/55">
                None of those nights was written down match by match, so there is no head-to-head
                to read.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

export default function PlayerCompare({
  history,
  options,
}: {
  history: FixtureRecord[];
  /** Everyone with a recorded night, in the order the pickers list them. */
  options: { id: string; name: string }[];
}) {
  const [aId, setA] = useState('');
  const [bId, setB] = useState('');

  const comparison = useMemo(
    () => (aId && bId ? comparePlayers(history, aId, bId) : null),
    [history, aId, bId],
  );

  const picker = (value: string, onChange: (id: string) => void, tone: string, label: string) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={`min-w-0 flex-1 rounded-lg border border-amber-900/25 bg-white px-2 py-1.5 text-sm font-bold outline-none focus:border-orange-500 ${value ? tone : 'text-amber-900/50'}`}
    >
      <option value="">{label}</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-3 rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        {picker(aId, setA, A_TEXT, 'Pick a player…')}
        <span className="shrink-0 text-xs font-black uppercase text-amber-900/40">v</span>
        {picker(bId, setB, B_TEXT, 'Pick another…')}
      </div>

      {!comparison ? (
        <p className="text-sm text-amber-900/55">
          {aId && bId
            ? 'Pick two different players.'
            : 'Pick two players to put their records side by side.'}
        </p>
      ) : (
        <>
          <div className="space-y-2.5">
            {rowsOf(comparison).map((row) => (
              <StatRow key={row.label} row={row} />
            ))}
          </div>
          <Shared c={comparison} />
        </>
      )}
    </div>
  );
}
