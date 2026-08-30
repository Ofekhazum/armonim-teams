// Making one guest one person (§2.6).
//
// A guest is created on the night they turn up, with a fresh `uid()`, because
// at that moment there is nothing to match them against — they are a name
// somebody typed into a box. That is fine for one evening and wrong across a
// season: the same guest returning three weeks later gets a second id, and the
// standings then show them twice on one night each rather than once on three.
//
// The fix is applied when history is *read*, never when it is written. The
// stored records keep the ids they were filed with, so nothing already on the
// server is rewritten and a merge that turns out to be wrong is undone by
// changing this file rather than by repairing data. It also means the merge
// improves retroactively: a guest who joins the roster later stops being
// merged by name the moment they have an id of their own.

import type { FixtureRecord } from './types';
import { TEAM_COLORS } from './balancer';

// Two spellings of the same guest should collide, three spaces and a stray
// capital should not keep them apart. Nothing cleverer than this — no fuzzy
// matching, because quietly merging two people who are genuinely different is
// a far worse failure than leaving a duplicate row visible.
export const guestKey = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('he');

// A roster player who has the same name as a guest absorbs that guest's past
// nights — which is what promoting a guest to the roster has to mean. Without
// it, promotion would *split* somebody rather than settle them: the id they are
// given is on the roster and so is skipped below, while their earlier guest ids
// carry on merging with each other into a second, separate person.
//
// Two roster players sharing a name make the answer ambiguous, so that name
// absorbs nothing and the guests under it stay guests. Silence is the right
// failure here — welding a guest onto the wrong member is invisible and
// permanent-looking, where an unabsorbed guest is a visible row somebody can
// act on.
const AMBIGUOUS = Symbol('two roster players share this name');

export interface GuestAbsorber {
  id: string;
  name: string;
  aliases?: string[];
}

/** `guestKey(name)` → the roster id that name should count as. */
export function guestAbsorbers(players: GuestAbsorber[]): Map<string, string> {
  const claimed = new Map<string, string | typeof AMBIGUOUS>();
  for (const p of players) {
    for (const name of [p.name, ...(p.aliases ?? [])]) {
      const key = guestKey(name);
      if (!key) continue;
      const held = claimed.get(key);
      // the same player listing a name twice (name and alias) is not a clash
      claimed.set(key, held === undefined || held === p.id ? p.id : AMBIGUOUS);
    }
  }
  const out = new Map<string, string>();
  for (const [key, id] of claimed) if (typeof id === 'string') out.set(key, id);
  return out;
}

/**
 * id → the id that id should be counted as.
 *
 * Only ids absent from the roster are candidates: anybody with a roster entry
 * already has one identity and keeps it, which is what stops two squad members
 * who happen to share a first name being welded together.
 *
 * A guest whose name matches a roster player is counted as that player
 * (`absorbers`, above) — the promotion path. Otherwise repeat guests collapse
 * onto each other, earliest night first, so the canonical id is stable as
 * history grows: picking the most recent would silently renumber a guest every
 * time they played again.
 */
export function guestIdentities(
  history: FixtureRecord[],
  rosterIds: Set<string>,
  absorbers: Map<string, string> = new Map(),
): Map<string, string> {
  const firstSeen = new Map<string, string>();
  const canonical = new Map<string, string>();

  for (const fx of [...history].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const p of fx.players) {
      if (rosterIds.has(p.id)) continue;
      const key = guestKey(p.name);
      if (!key) continue;
      const owner = absorbers.get(key);
      if (owner !== undefined) {
        canonical.set(p.id, owner);
        continue;
      }
      const first = firstSeen.get(key);
      if (first === undefined) firstSeen.set(key, p.id);
      else if (first !== p.id) canonical.set(p.id, first);
    }
  }
  return canonical;
}

/**
 * The same history with repeat guests counted as one person.
 *
 * Returns the original array when nothing needed merging, so the common case
 * costs one pass and no allocation — this runs on every render of anything
 * that reads history.
 */
export function mergeGuestIdentities(
  history: FixtureRecord[],
  rosterIds: Set<string>,
  absorbers: Map<string, string> = new Map(),
): FixtureRecord[] {
  const canonical = guestIdentities(history, rosterIds, absorbers);
  if (canonical.size === 0) return history;
  const idOf = (id: string) => canonical.get(id) ?? id;

  return history.map((fx) => {
    const players: FixtureRecord['players'] = [];
    const at = new Map<string, number>();
    for (const p of fx.players) {
      const id = idOf(p.id);
      const already = at.get(id);
      if (already === undefined) {
        at.set(id, players.length);
        players.push(id === p.id ? p : { ...p, id });
        continue;
      }
      // The same person can only appear once on a night. Position is the first
      // entry's, so the order a night was filed in survives — but if one of the
      // colliding rows *is* the canonical player (a promoted guest who also
      // played under their roster id), that row's name and rating win, since
      // they are the ones the player carries now.
      if (p.id === id) players[already] = p;
    }
    return {
      ...fx,
      players,
      teams: {
        black: fx.teams.black.map(idOf),
        white: fx.teams.white.map(idOf),
        blue: fx.teams.blue.map(idOf),
      },
      ...(fx.mvpId ? { mvpId: idOf(fx.mvpId) } : {}),
    };
  });
}

// Guests already known to history, newest name first — what a match-day guest
// box can offer so a returning guest is picked rather than retyped. Exported
// for the write side of the same problem; the read side above stands on its
// own without it.
export function knownGuests(
  history: FixtureRecord[],
  rosterIds: Set<string>,
): { id: string; name: string }[] {
  const out = new Map<string, { id: string; name: string }>();
  for (const fx of [...history].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const c of TEAM_COLORS) {
      for (const id of fx.teams[c]) {
        if (rosterIds.has(id)) continue;
        const p = fx.players.find((q) => q.id === id);
        if (p) out.set(guestKey(p.name), { id, name: p.name });
      }
    }
  }
  return [...out.values()];
}
