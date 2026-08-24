// Team of the Month, in the sandbox (§2.32).
//
// A real award is a *record* — the five names for August were decided on the
// 1st of September by a cron and written to KV, and reading them back is the
// only way to know them (§2.25). The sandbox has no Worker and no cron, so the
// months here are **derived** from the invented history using the same
// `teamOfMonth` the registrar itself calls.
//
// That is a deliberate inversion of the rule the real feature is built on, and
// it is kept in its own file, loaded only from the test branch of
// `fetchAwards`, so it can never be reached from live code. The shape it
// returns is the shape the Worker returns, so nothing downstream can tell the
// difference — which is the point of a sandbox.
//
// The newest month is left out. A month that has not ended has not been
// announced, and the real cron would not have written it yet; including it
// would make the sandbox disagree with the one behaviour anyone testing Team
// of the Month is trying to see.

import type { Awards } from './awards';
import { teamOfMonth, totmPeriods } from './totm';
import { buildTestClub } from './testData';

export function testAwards(): Awards {
  const { history } = buildTestClub();
  const periods = totmPeriods(history); // newest first
  const out: Awards = {};

  for (const period of periods.slice(1)) {
    const five = teamOfMonth(history, period);
    if (five.length === 0) continue;
    out[period] = {
      ids: five.map((p) => p.id),
      names: five.map((p) => p.name),
      // Announced at 8am on the 1st of the following month, which is when the
      // cron would have run.
      at: Date.UTC(
        Number(period.slice(0, 4)),
        Number(period.slice(5, 7)), // 0-indexed month + 1 = the month after
        1,
        5,
      ),
    };
  }
  return out;
}
