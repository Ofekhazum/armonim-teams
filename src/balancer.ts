import type { Player, Playstyle, TeamColor, Teams } from './types';

export const TEAM_COLORS: TeamColor[] = ['black', 'white', 'blue'];
export const FULL_TEAM = 5;

// Soft-constraint weights. GK and size are so heavy they act as hard
// constraints whenever a valid arrangement exists.
const W = {
  size: 800,
  gkStack: 300, // per extra keeper on the same team — spread them, but no team *needs* one
  rating: 120, // per point of avg-rating spread between best and worst team
  style: 6,
  chemistry: 12,
  avoid: 40, // clashing players on the same team hurts more than friendship helps
  unknown: 20,
};

const STYLES: Playstyle[] = ['defensive', 'mixed', 'attacking', 'gk'];

interface Ctx {
  byId: Map<string, Player>;
  gkIds: Set<string>;
  chemPairs: Set<string>;
  avoidPairs: Set<string>;
  targets: Record<TeamColor, number>;
  total: number;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function targetSizes(n: number): number[] {
  const base = Math.floor(n / 3);
  const rem = n % 3;
  return TEAM_COLORS.map((_, i) => base + (i < rem ? 1 : 0));
}

function buildCtx(
  players: Player[],
  gkIds: Set<string>,
  targets: Record<TeamColor, number>,
): Ctx {
  const byId = new Map(players.map((p) => [p.id, p]));
  const chemPairs = new Set<string>();
  const avoidPairs = new Set<string>();
  for (const p of players) {
    for (const other of p.chemistry ?? []) {
      if (byId.has(other)) chemPairs.add(pairKey(p.id, other));
    }
    for (const other of p.avoid ?? []) {
      if (byId.has(other)) avoidPairs.add(pairKey(p.id, other));
    }
  }
  return { byId, gkIds, chemPairs, avoidPairs, targets, total: players.length };
}

export interface TeamStats {
  size: number;
  sum: number;
  avg: number;
  gkCount: number;
  unknowns: number;
  styles: Record<Playstyle, number>;
}

export function teamStats(
  ids: string[],
  byId: Map<string, Player>,
  gkIds: Set<string>,
): TeamStats {
  const styles: Record<Playstyle, number> = { defensive: 0, mixed: 0, attacking: 0, gk: 0 };
  let sum = 0;
  let counted = 0;
  let unknowns = 0;
  let gkCount = 0;
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    // an outfield player keeping goal this fixture doesn't contribute their
    // outfield rating; a permanent GK's rating counts normally
    const tempGk = gkIds.has(id) && p.playstyle !== 'gk';
    if (!tempGk) {
      sum += p.rating;
      counted++;
    }
    styles[p.playstyle]++;
    if (p.ratingUnknown) unknowns++;
    if (gkIds.has(id)) gkCount++;
  }
  return {
    size: ids.length,
    sum,
    avg: counted ? sum / counted : 0,
    gkCount,
    unknowns,
    styles,
  };
}

function scoreTeams(teams: Teams, ctx: Ctx): number {
  const stats = TEAM_COLORS.map((c) => ({
    color: c,
    s: teamStats(teams[c], ctx.byId, ctx.gkIds),
  }));

  let score = 0;
  for (const { color, s } of stats) {
    score += Math.abs(s.size - ctx.targets[color]) * W.size;
    score += Math.max(0, s.gkCount - 1) * W.gkStack;
    score += Math.max(0, s.unknowns - 1) * W.unknown;
  }

  const avgs = stats.filter((x) => x.s.size > 0).map((x) => x.s.avg);
  if (avgs.length > 1) score += (Math.max(...avgs) - Math.min(...avgs)) * W.rating;

  for (const style of STYLES) {
    const totalOfStyle = stats.reduce((n, x) => n + x.s.styles[style], 0);
    if (!totalOfStyle) continue;
    for (const { s } of stats) {
      const expected = totalOfStyle * (s.size / ctx.total);
      score += Math.abs(s.styles[style] - expected) * W.style;
    }
  }

  if (ctx.chemPairs.size || ctx.avoidPairs.size) {
    const teamOf = new Map<string, TeamColor>();
    for (const c of TEAM_COLORS) for (const id of teams[c]) teamOf.set(id, c);
    for (const key of ctx.chemPairs) {
      const [a, b] = key.split('|');
      if (teamOf.get(a) && teamOf.get(a) === teamOf.get(b)) score -= W.chemistry;
    }
    for (const key of ctx.avoidPairs) {
      const [a, b] = key.split('|');
      if (teamOf.get(a) && teamOf.get(a) === teamOf.get(b)) score += W.avoid;
    }
  }

  return score;
}

// A "unit" is a group that must stay together: an inviter plus their guests,
// or a lone player.
function buildUnits(players: Player[]): string[][] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const groups = new Map<string, string[]>();
  for (const p of players) {
    if (p.isGuest && p.invitedBy && byId.has(p.invitedBy)) {
      const g = groups.get(p.invitedBy) ?? [p.invitedBy];
      g.push(p.id);
      groups.set(p.invitedBy, g);
    }
  }
  const units: string[][] = [...groups.values()];
  for (const p of players) {
    if (groups.has(p.id)) continue;
    if (p.isGuest && p.invitedBy && byId.has(p.invitedBy)) continue;
    units.push([p.id]);
  }
  return units;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const rand = (n: number) => Math.floor(Math.random() * n);

const cloneTeams = (t: Teams): Teams => ({
  black: [...t.black],
  white: [...t.white],
  blue: [...t.blue],
});

// Swap two same-sized groups between two teams, padding a glued group with
// loose singles from its own team when sizes differ, so glue and team sizes
// are both preserved.
function tryRandomSwap(teams: Teams, unitOf: Map<string, string[]>): Teams | null {
  const c1 = TEAM_COLORS[rand(3)];
  let c2 = TEAM_COLORS[rand(3)];
  while (c2 === c1) c2 = TEAM_COLORS[rand(3)];
  const t1 = teams[c1];
  const t2 = teams[c2];
  if (!t1.length || !t2.length) return null;

  let g1 = [...(unitOf.get(t1[rand(t1.length)]) ?? [])];
  let g2 = [...(unitOf.get(t2[rand(t2.length)]) ?? [])];
  if (!g1.length || !g2.length) return null;

  const pad = (group: string[], team: string[], deficit: number): string[] | null => {
    const inGroup = new Set(group);
    const singles = team.filter(
      (id) => !inGroup.has(id) && (unitOf.get(id)?.length ?? 1) === 1,
    );
    if (singles.length < deficit) return null;
    shuffle(singles);
    return [...group, ...singles.slice(0, deficit)];
  };

  if (g1.length > g2.length) {
    const padded = pad(g2, t2, g1.length - g2.length);
    if (!padded) return null;
    g2 = padded;
  } else if (g2.length > g1.length) {
    const padded = pad(g1, t1, g2.length - g1.length);
    if (!padded) return null;
    g1 = padded;
  }

  const s1 = new Set(g1);
  const s2 = new Set(g2);
  return {
    ...teams,
    [c1]: [...t1.filter((id) => !s1.has(id)), ...g2],
    [c2]: [...t2.filter((id) => !s2.has(id)), ...g1],
  };
}

const signature = (teams: Teams): string =>
  TEAM_COLORS.map((c) => [...teams[c]].sort().join(','))
    .sort()
    .join(';');

// Hill-climbing with random restarts; returns the best few distinct
// arrangements, best first.
export function generateTeams(
  players: Player[],
  gkIds: Set<string>,
  variants = 3,
): Teams[] {
  if (!players.length) return [];
  const sizes = targetSizes(players.length);
  const unitOf = new Map<string, string[]>();
  for (const unit of buildUnits(players)) {
    for (const id of unit) unitOf.set(id, unit);
  }

  const results: { teams: Teams; score: number; sig: string }[] = [];

  for (let restart = 0; restart < 40; restart++) {
    const colors = shuffle([...TEAM_COLORS]);
    const targets = { black: 0, white: 0, blue: 0 } as Record<TeamColor, number>;
    colors.forEach((c, i) => (targets[c] = sizes[i]));
    const ctx = buildCtx(players, gkIds, targets);

    const units = shuffle(buildUnits(players)).sort((a, b) => b.length - a.length);
    let teams: Teams = { black: [], white: [], blue: [] };
    for (const unit of units) {
      const dest = TEAM_COLORS.map((c) => ({ c, room: targets[c] - teams[c].length }))
        .sort((x, y) => y.room - x.room)[0].c;
      teams[dest].push(...unit);
    }

    let score = scoreTeams(teams, ctx);
    for (let iter = 0; iter < 800; iter++) {
      const next = tryRandomSwap(teams, unitOf);
      if (!next) continue;
      const nextScore = scoreTeams(next, ctx);
      if (nextScore < score) {
        teams = next;
        score = nextScore;
      }
    }

    const sig = signature(teams);
    const existing = results.find((r) => r.sig === sig);
    if (!existing) results.push({ teams: cloneTeams(teams), score, sig });
  }

  results.sort((a, b) => a.score - b.score);
  return results.slice(0, variants).map((r) => r.teams);
}

// Guests that ended up away from their inviter (possible after manual edits).
export function glueViolations(teams: Teams, byId: Map<string, Player>): Player[] {
  const teamOf = new Map<string, TeamColor>();
  for (const c of TEAM_COLORS) for (const id of teams[c]) teamOf.set(id, c);
  const out: Player[] = [];
  for (const p of byId.values()) {
    if (!p.isGuest || !p.invitedBy) continue;
    const gt = teamOf.get(p.id);
    const it = teamOf.get(p.invitedBy);
    if (gt && it && gt !== it) out.push(p);
  }
  return out;
}

// --- Short-handed rotation ------------------------------------------------

export interface MatchPlan {
  a: TeamColor;
  b: TeamColor;
  resting: TeamColor;
  loans: { id: string; to: TeamColor }[];
}

// For each of the three pairings, pick players from the resting team to
// complete any short team — preferring players loaned the fewest times, then
// the rating that best evens out the match.
export function planRotation(
  teams: Teams,
  byId: Map<string, Player>,
  gkIds: Set<string> = new Set(),
): MatchPlan[] {
  const order: [TeamColor, TeamColor, TeamColor][] = [
    ['black', 'white', 'blue'],
    ['blue', 'black', 'white'],
    ['white', 'blue', 'black'],
  ];
  const used = new Map<string, number>();
  // temporary keepers count as 0 outfield contribution (see teamStats)
  const isTempGk = (id: string) => {
    const p = byId.get(id);
    return !!p && gkIds.has(id) && p.playstyle !== 'gk';
  };
  const rating = (id: string) => (isTempGk(id) ? 0 : (byId.get(id)?.rating ?? 3.5));
  const avg = (ids: string[]) => {
    const counted = ids.filter((id) => !isTempGk(id));
    return counted.length
      ? counted.reduce((n, id) => n + rating(id), 0) / counted.length
      : 0;
  };

  return order.map(([a, b, resting]) => {
    const loans: { id: string; to: TeamColor }[] = [];
    const pool = [...teams[resting]];
    for (const t of [a, b]) {
      let need = FULL_TEAM - teams[t].length;
      const other = t === a ? b : a;
      while (need > 0 && pool.length) {
        const current = [...teams[t], ...loans.filter((l) => l.to === t).map((l) => l.id)];
        const counted = current.filter((id) => !isTempGk(id));
        const sum = counted.reduce((n, id) => n + rating(id), 0);
        // rating that would make this team's average equal the opponent's
        const ideal = avg(teams[other]) * (counted.length + 1) - sum;
        pool.sort((x, y) => {
          const ux = used.get(x) ?? 0;
          const uy = used.get(y) ?? 0;
          if (ux !== uy) return ux - uy;
          // guests shouldn't be the ones shuttling between teams
          const gx = byId.get(x)?.isGuest ? 1 : 0;
          const gy = byId.get(y)?.isGuest ? 1 : 0;
          if (gx !== gy) return gx - gy;
          return Math.abs(rating(x) - ideal) - Math.abs(rating(y) - ideal);
        });
        const pick = pool.shift()!;
        loans.push({ id: pick, to: t });
        used.set(pick, (used.get(pick) ?? 0) + 1);
        need--;
      }
    }
    return { a, b, resting, loans };
  });
}
