// How many times each player has been named MVP — the one deliberately
// subjective input in this app. Everywhere else a fact has to be derived
// from the three win counts (§2.6) precisely because a human declaring
// "this player was good tonight" is a claim the data can't support (§2.9's
// whole design rule). MVP is the opposite: the organiser's own judgment,
// recorded as-is and simply counted afterwards — the count is honest
// because it's counting a real pick, not manufacturing one.

import type { FixtureRecord } from './types';

export interface MvpCount {
  id: string;
  name: string;
  count: number;
}

// Ranked most MVP nights first. Works over any fixture list — the whole
// history for a career total (History's standings table), or an
// already-month-filtered list for the monthly recap (wrapped.ts).
export function mvpCounts(fixtures: FixtureRecord[]): MvpCount[] {
  const counts = new Map<string, number>();
  const nameOf = new Map<string, string>();
  for (const fx of fixtures) {
    if (!fx.mvpId) continue;
    const player = fx.players.find((p) => p.id === fx.mvpId);
    if (!player) continue; // defensive: a malformed record shouldn't crash the count
    nameOf.set(fx.mvpId, player.name);
    counts.set(fx.mvpId, (counts.get(fx.mvpId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: nameOf.get(id)!, count }))
    .sort((a, b) => b.count - a.count);
}

// Filing a night that may already be filed. The fixture page rebuilds the
// whole record from the session every time it saves, which is right for
// everything it knows about — the teams, the tally, the match log — and wrong
// for the one field it doesn't: the MVP is picked afterwards, on History, and
// a second save (another match logged, the date corrected, the button pressed
// twice) would otherwise write a record with no pick straight over one that
// had it. Filing is idempotent; forgetting is not.
export function preserveMvp(
  existing: FixtureRecord | undefined,
  fixture: FixtureRecord,
): FixtureRecord {
  // an explicit pick on the incoming record still wins — this only fills a gap
  if (fixture.mvpId || !existing?.mvpId) return fixture;
  return { ...fixture, mvpId: existing.mvpId };
}
