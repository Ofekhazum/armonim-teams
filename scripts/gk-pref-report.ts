// How often does `noGkTeammate` actually get honoured? Measured, not assumed.
//
// Run: npx vite-node scripts/gk-pref-report.ts
import { generateTeams, teamStats, TEAM_COLORS } from '../src/balancer';
import { setSeed, rnd, shuffle } from '../src/calibration.sim';
import { ATTACK_DEFAULT } from '../src/types';
import type { Player } from '../src/types';

const mk = (i: number, over: Partial<Player> = {}): Player => ({
  id: `p${i}`,
  name: `p${i}`,
  rating: 1 + Math.floor(rnd() * 5),
  attack: ATTACK_DEFAULT,
  chemistry: [],
  avoid: [],
  ...over,
});

function trial(nPlayers: number, nKeepers: number, nWanters: number) {
  const ids = shuffle([...Array(nPlayers).keys()]);
  const keepers = new Set(ids.slice(0, nKeepers));
  // wanters drawn from the non-keepers, so the request is always meaningful
  const wanters = new Set(ids.filter((i) => !keepers.has(i)).slice(0, nWanters));
  const players = [...Array(nPlayers).keys()].map((i) =>
    mk(i, {
      ...(keepers.has(i) ? { isGk: true } : {}),
      ...(wanters.has(i) ? { noGkTeammate: true } : {}),
    }),
  );
  const gkIds = new Set([...keepers].map((i) => `p${i}`));
  const [teams] = generateTeams(players, gkIds, 1);
  if (!teams) return null;

  const byId = new Map(players.map((p) => [p.id, p]));
  let happy = 0;
  const avgs: number[] = [];
  for (const c of TEAM_COLORS) {
    const s = teamStats(teams[c], byId, gkIds);
    if (s.size) avgs.push(s.avg);
    if (s.gkCount === 0) {
      for (const id of teams[c]) if (wanters.has(Number(id.slice(1)))) happy++;
    }
  }
  return { happy, want: wanters.size, spread: Math.max(...avgs) - Math.min(...avgs) };
}

setSeed(99);
console.log('players keepers wanters | honoured      | rating spread');
console.log('------------------------|---------------|--------------');
for (const [n, k, w] of [
  [15, 1, 1], [15, 1, 3], [15, 1, 6],
  [15, 2, 1], [15, 2, 3], [15, 2, 6],
  [15, 3, 1], [15, 3, 3],
  [18, 2, 4], [12, 1, 2], [21, 2, 5],
] as const) {
  let ok = 0, want = 0, spread = 0, runs = 0;
  for (let r = 0; r < 60; r++) {
    const t = trial(n, k, w);
    if (!t) continue;
    ok += t.happy; want += t.want; spread += t.spread; runs++;
  }
  const pct = want ? ((ok / want) * 100).toFixed(0) : '—';
  console.log(
    `${String(n).padStart(7)} ${String(k).padStart(7)} ${String(w).padStart(7)} | ` +
    `${String(pct).padStart(3)}% (${ok}/${want})`.padEnd(13) + ' | ' +
    (spread / runs).toFixed(2),
  );
}
