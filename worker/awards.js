// Team of the Month, written down rather than worked out (§2.25).
//
// Everything else this app shows is derived at read time — a night page
// recomputes, the career table recomputes, and that is right, because a
// corrected result *should* change what a count says. An award is not a count.
// It is an announcement: five names, picked for a month, posted to the group.
// If it were derived, a correction to some night in June could quietly change
// who was in June's team, and a player's page would end up disagreeing with
// the card everybody actually saw.
//
// So it is registered once and kept. The registrar is the cron below.
//
// The scoring itself is imported from the app rather than reimplemented here.
// That import is the whole point of `src/totm.ts` existing: the shirt image the
// organiser posts and the award this file writes have to be the same five
// people, and the only way to guarantee that is for there to be one rule.

import { teamOfMonth, totmPeriods } from '../src/totm';

export const AWARDS_KEY = 'totm';

const PERIOD = /^\d{4}-\d{2}$/;

export const isPeriod = (v) => typeof v === 'string' && PERIOD.test(v);

/** Everything registered so far, keyed by `YYYY-MM`. `{}` when there is none. */
export async function readAwards(env) {
  const raw = await env.ROSTER_KV.get(AWARDS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const readHistory = async (env) => {
  const raw = await env.ROSTER_KV.get('history');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.fixtures) ? parsed.fixtures : [];
  } catch {
    return [];
  }
};

/**
 * One month's team, as a record rather than as five objects.
 *
 * The **names travel with the ids**, which is the difference between an award
 * that still renders in two years and one that turns into five blanks the week
 * somebody leaves the roster. The ids are what a player page matches on; the
 * names are what it falls back to.
 */
const award = (five, at) => ({
  ids: five.map((p) => p.id),
  names: five.map((p) => p.name),
  at,
});

/**
 * Register every month that is finished and hasn't been registered yet.
 *
 * Three properties, all of them from the same two lines:
 *
 * - **It backfills.** The first run writes the whole archive rather than
 *   starting from whenever it was deployed.
 * - **It self-heals.** A run missed because the Worker was mid-deploy is
 *   picked up by the next one, a month later, with nothing lost.
 * - **It never overwrites.** A month registered by hand — the correction path,
 *   for when the automatic pick was wrong — is left exactly as it was.
 *
 * The current month is skipped because it is still being played. Note that
 * this is a *calendar* month in UTC, which is the one place a clock enters the
 * design; every other question ("is this month finished?") reduces to it.
 */
export async function registerAwards(env, now = Date.now()) {
  const history = await readHistory(env);
  const stored = await readAwards(env);
  const current = new Date(now).toISOString().slice(0, 7);

  let added = 0;
  for (const period of totmPeriods(history)) {
    if (period >= current) continue;
    if (stored[period]) continue;
    const five = teamOfMonth(history, period);
    if (five.length === 0) continue;
    stored[period] = award(five, now);
    added++;
  }
  if (added > 0) await env.ROSTER_KV.put(AWARDS_KEY, JSON.stringify(stored));
  return { added, awards: stored };
}

/**
 * Register one month now, overwriting whatever was there.
 *
 * The organiser's path, and it exists for two cases: seeding the archive
 * without waiting a month for the first cron, and correcting a month the
 * automatic pick got wrong. Since the cron never overwrites, anything set
 * here stays set.
 */
export async function announceMonth(env, period, now = Date.now()) {
  const history = await readHistory(env);
  const five = teamOfMonth(history, period);
  if (five.length === 0) return null;
  const stored = await readAwards(env);
  stored[period] = award(five, now);
  await env.ROSTER_KV.put(AWARDS_KEY, JSON.stringify(stored));
  return stored[period];
}

/** Forget one month, so the next cron may register it afresh. */
export async function clearMonth(env, period) {
  const stored = await readAwards(env);
  if (!(period in stored)) return stored;
  delete stored[period];
  await env.ROSTER_KV.put(AWARDS_KEY, JSON.stringify(stored));
  return stored;
}
