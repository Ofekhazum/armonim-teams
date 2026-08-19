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
