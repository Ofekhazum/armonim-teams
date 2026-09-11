// Re-derives the tuning tables documented in src/calibration.ts.
//
//   npx vite-node scripts/calibration-report.ts            # everything
//   npx vite-node scripts/calibration-report.ts precision   # one section
//
// Not a test — it takes minutes and prints tables, which is the wrong shape for
// CI. It exists so the numbers in calibration.ts's comments can be *checked*
// rather than trusted, and so a change to the estimator can be judged against
// what it replaces. The behaviour those tables justify is pinned by
// calibration.test.ts; this is where the tables themselves come from.

import { ratingErrors, suggestRatings } from '../src/calibration';
import {
  mis,
  mkPlayers,
  season,
  seasonWithLog,
  setSeed,
  spread,
  withError,
  type SeasonOpts,
} from '../src/calibration.sim';

const RUNS = 400;

// The club's own nights run to ~11-12 wins between the three teams, which is
// four matches per pairing — twice what the simulator used to assume.
const HOUSE: SeasonOpts = { teams: 'balanced', matchesPerPairing: 4 };

const pct = (n: number, of: number) => `${((100 * n) / of).toFixed(0)}%`;

interface Tally {
  runs: number;
  found: number; // the mis-rated player, pointed the right way
  backwards: number; // the mis-rated player, pointed the wrong way
  falseFlags: number; // correctly-rated players flagged
}

// Runs `RUNS` seasons and counts what the panel said about `targets` (whose
// true rating differs from the printed one) versus everyone else.
function measure(
  specs: Spec[],
  nights: number,
  opts: SeasonOpts,
  runs = RUNS,
  seed0 = 1000,
): Tally {
  const t: Tally = { runs, found: 0, backwards: 0, falseFlags: 0 };
  const wrongBy = new Map(specs.map((s) => [s.id, s.truth - s.rated]));
  for (let r = 0; r < runs; r++) {
    setSeed(seed0 + r * 7919);
    const hist = season(specs, nights, opts);
    for (const s of suggestRatings(hist, mkPlayers(specs))) {
      const off = wrongBy.get(s.id) ?? 0;
      if (off === 0) t.falseFlags++;
      else if ((off > 0) === (s.direction === 'up')) t.found++;
      else t.backwards++;
    }
  }
  return t;
}

// How often the panel got a *specific* player right, as a share of runs.
function detection(specs: Spec[], id: string, nights: number, opts: SeasonOpts, runs = RUNS) {
  const off = specs.find((s) => s.id === id)!;
  const delta = off.truth - off.rated;
  let hit = 0;
  let backwards = 0;
  let flags = 0;
  for (let r = 0; r < runs; r++) {
    setSeed(2000 + r * 7919);
    const list = suggestRatings(season(specs, nights, opts), mkPlayers(specs));
    for (const s of list) {
      if (s.id !== id) {
        flags++;
        continue;
      }
      if ((delta > 0) === (s.direction === 'up')) hit++;
      else backwards++;
    }
  }
  return { hit, backwards, falsePerRun: flags / runs, runs };
}

// --- Sections --------------------------------------------------------------

function sectionVolume() {
  console.log('\n## How much a night is worth (mis: p0 truly 5, p1 truly 1, all rated 3)\n');
  // Note the two team modes come out the same here, and should: everyone on
  // this roster is *rated* 3, so there is nothing for a balancer to level and
  // a balanced draw is just a random one. Use `null` or `size` (spread roster)
  // to see what team mode actually costs.
  console.log('  teams     │ matches/pair │ nights │ found │ backwards │ false flags/run');
  for (const teams of ['random', 'balanced'] as const) {
    for (const mpp of [2, 4]) {
      for (const nights of [5, 10, 20]) {
        const t = measure(mis, nights, { teams, matchesPerPairing: mpp });
        console.log(
          `  ${teams.padEnd(9)} │ ${String(mpp).padStart(12)} │ ${String(nights).padStart(6)} │ ` +
            `${pct(t.found, t.runs * 2).padStart(5)} │ ${pct(t.backwards, t.runs * 2).padStart(9)} │ ` +
            `${(t.falseFlags / t.runs).toFixed(2).padStart(15)}`,
        );
      }
    }
  }
}

function sectionErrorSize() {
  console.log('\n## Detection vs how wrong the rating is (spread roster, house volume)\n');
  console.log('  who              │ off by │ nights │ caught │ backwards │ others flagged/run');
  // p2 is a mid-table 4★; p9 an ordinary 3★. Both are the realistic case —
  // errors at the very top get partly masked by the ceiling.
  for (const [who, id] of [
    ['4★ mid-table', 'p2'],
    ['3★ ordinary', 'p9'],
  ] as const) {
    for (const by of [0.5, 1, 1.5, 2.5]) {
      for (const nights of [5, 8, 12, 20]) {
        const specs = withError(id, by);
        const d = detection(specs, id, nights, HOUSE);
        console.log(
          `  ${who.padEnd(16)} │ ${`+${by}`.padStart(6)} │ ${String(nights).padStart(6)} │ ` +
            `${pct(d.hit, d.runs).padStart(6)} │ ${pct(d.backwards, d.runs).padStart(9)} │ ` +
            `${d.falsePerRun.toFixed(2).padStart(18)}`,
        );
      }
    }
  }
}

function sectionNull() {
  console.log('\n## The null case — nobody is mis-rated, so the right answer is silence\n');
  console.log('  roster  │ teams    │ nights │ suggestions per run │ runs with any');
  for (const [name, specs] of [
    ['flat', mis.map((s) => ({ ...s, truth: s.rated }))],
    ['spread', spread],
  ] as const) {
    for (const teams of ['random', 'balanced'] as const) {
      for (const nights of [5, 10, 20]) {
        let total = 0;
        let any = 0;
        for (let r = 0; r < RUNS; r++) {
          setSeed(3000 + r * 7919);
          const n = suggestRatings(
            season(specs, nights, { ...HOUSE, teams }),
            mkPlayers(specs),
          ).length;
          total += n;
          if (n) any++;
        }
        console.log(
          `  ${name.padEnd(7)} │ ${teams.padEnd(8)} │ ${String(nights).padStart(6)} │ ` +
            `${(total / RUNS).toFixed(2).padStart(19)} │ ${pct(any, RUNS).padStart(13)}`,
        );
      }
    }
  }
}

// The one that explains all the others: what does the estimate actually settle
// on, given unlimited football, for an error of known size?
function sectionConverge() {
  console.log('\n## What the estimate converges to, for an error of known size\n');
  console.log('  player      │ off by │ nights │ mean delta │ sd │ mean |z|');
  for (const [who, id] of [
    ['4★ mid-table', 'p2'],
    ['3★ ordinary', 'p9'],
  ] as const) {
    for (const by of [1, 1.5, 2.5]) {
      for (const nights of [5, 12, 20, 80]) {
        const specs = withError(id, by);
        const byId = new Map(mkPlayers(specs).map((p) => [p.id, p]));
        const ds: number[] = [];
        const zs: number[] = [];
        for (let r = 0; r < RUNS; r++) {
          setSeed(2000 + r * 7919);
          const e = ratingErrors(season(specs, nights, HOUSE), (i) => byId.get(i)?.rating ?? null);
          const est = e.get(id)!;
          ds.push(est.delta);
          zs.push(Math.abs(est.z));
        }
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        const m = mean(ds);
        const sd = Math.sqrt(mean(ds.map((d) => (d - m) ** 2)));
        console.log(
          `  ${who.padEnd(11)} │ ${`+${by}`.padStart(6)} │ ${String(nights).padStart(6)} │ ` +
            `${m.toFixed(2).padStart(10)} │ ${sd.toFixed(2)} │ ${mean(zs).toFixed(1).padStart(8)}`,
        );
      }
    }
  }
}

// Are the error bars honest? Run a league where nobody is mis-rated, where the
// right answer for every player is zero, and see how confident the estimator
// claims to be about pure noise. A well-calibrated |z| is half-normal: median
// 0.67, a tenth of players past 1.64, one in twenty past 1.96.
function sectionZ() {
  console.log('\n## Error bars on a correctly-rated league — confidence about nothing\n');
  console.log('  nights │ median |z| │ p90 │ max │ below 1 │ below 2.5');
  const byId = new Map(mkPlayers(spread).map((p) => [p.id, p]));
  for (const nights of [5, 8, 12, 20, 40]) {
    const zs: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      setSeed(5000 + r * 7919);
      for (const e of ratingErrors(
        season(spread, nights, HOUSE),
        (i) => byId.get(i)?.rating ?? null,
      ).values())
        zs.push(Math.abs(e.z));
    }
    zs.sort((a, b) => a - b);
    const q = (p: number) => zs[Math.floor(p * (zs.length - 1))];
    const below = (t: number) => pct(zs.filter((z) => z < t).length, zs.length);
    console.log(
      `  ${String(nights).padStart(6)} │ ${q(0.5).toFixed(1).padStart(10)} │ ${q(0.9).toFixed(1).padStart(4)} │ ` +
        `${zs[zs.length - 1].toFixed(1).padStart(4)} │ ${below(1).padStart(7)} │ ${below(2.5).padStart(9)}`,
    );
  }
}

// The question that actually decides `RATING_PANEL_READY`: not "does the
// estimator work" but "at the number of nights a real club has, is the panel
// worth reading". Precision — of the suggestions made, how many are right — is
// the number to hold that decision to, off both kinds of night this club
// actually has.
function sectionPrecision() {
  console.log('\n## Precision at realistic volumes: a genuine 2.5★ error on a 3★\n');
  console.log('  data          │ nights │ caught │ false/run │ precision');
  for (const useLog of [false, true]) {
    for (const nights of [5, 8, 12, 20, 40]) {
      const specs = withError('p9', 2.5);
      const ps = mkPlayers(specs);
      let hit = 0;
      let other = 0;
      for (let r = 0; r < RUNS; r++) {
        setSeed(2000 + r * 7919);
        const hist = useLog ? seasonWithLog(specs, nights) : season(specs, nights, HOUSE);
        for (const s of suggestRatings(hist, ps)) (s.id === 'p9' ? hit++ : other++);
      }
      const precision = hit + other > 0 ? pct(hit, hit + other) : '—';
      console.log(
        `  ${(useLog ? 'logged' : 'tally-only').padEnd(13)} │ ${String(nights).padStart(6)} │ ` +
          `${pct(hit, RUNS).padStart(6)} │ ${(other / RUNS).toFixed(2).padStart(9)} │ ${precision.padStart(9)}`,
      );
    }
  }
}

const sections: Record<string, () => void> = {
  volume: sectionVolume,
  size: sectionErrorSize,
  converge: sectionConverge,
  z: sectionZ,
  null: sectionNull,
  precision: sectionPrecision,
};

const want = process.argv.slice(2);
for (const [name, run] of Object.entries(sections)) {
  if (want.length && !want.includes(name)) continue;
  run();
}
