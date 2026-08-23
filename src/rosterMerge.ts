// Reconciling the shared roster with what a device already holds.
//
// These exist because the public roster read is deliberately incomplete: the
// worker strips `chemistry`, `avoid`, `aliases`, `rating` and `attack` from
// GET /roster, since that endpoint is unauthenticated and neither "who won't
// play with whom" nor "what I think of them out of five" is something to hand
// the open internet (see PublicPlayer in remote.ts). The cost of that is that
// a pull can no longer be a straight replace — it would blank the very fields
// it isn't allowed to carry — so the two directions get merged instead.

import type { Player } from './types';
import { migratePlayer } from './types';

// What a device shows for somebody it has only ever seen through the public
// read. The middle of the 1–5 scale: a device that is not allowed to know a
// rating should not be guessing high or low about anyone, and it never uses
// the number for anything — team generation is admin-only.
const RATING_UNSEEN = 3;
import type { PublicPlayer } from './remote';

// Adopt a shared roster without losing what only this device holds. Names and
// shirt numbers come from the shared copy; the five private fields are kept
// from whatever this device already had for that player, and start empty (or
// neutral) for someone it is meeting for the first time.
export function mergePublicRoster(prev: Player[], remote: PublicPlayer[]): Player[] {
  const local = new Map(prev.map((p) => [p.id, p]));
  return remote.map((p) => {
    const had = local.get(p.id);
    const attack = p.attack ?? had?.attack;
    return migratePlayer({
      ...(p as Player),
      chemistry: had?.chemistry ?? [],
      avoid: had?.avoid ?? [],
      aliases: had?.aliases ?? [],
      // `rating` and `attack` no longer travel on the public read either, so
      // they are held the same way: keep whatever this device already had,
      // and fall back to the middle of the scale for a player it is meeting
      // for the first time. An organiser's device fills in the real numbers a
      // moment later from /roster/full; a viewer's device never needs them,
      // because everything it can do — reading nights back, the live view —
      // is counted from results rather than from anybody's opinion.
      rating: p.rating ?? had?.rating ?? RATING_UNSEEN,
      // Left off entirely when nobody has one, rather than defaulted here:
      // `migratePlayer` is what turns a legacy `playstyle` into an attack
      // number, and handing it a 50 first makes it keep the 50 and quietly
      // lose the migration.
      ...(attack === undefined ? {} : { attack }),
    });
  });
}

// The other direction, run once admin is unlocked: keep this device's names
// (the public pull already refreshed those) and fill in the private fields
// from the admin-only read. Players the shared copy doesn't know about — a
// guest added locally — keep exactly what they had, so rehydrating never
// costs a local edit.
//
// `rating` and `attack` are in this list rather than the public one now, which
// makes this function the *only* way a device learns what the organiser thinks
// of anybody. That is the point: unlocking admin is what turns a device from
// one that can read the club's results into one that can see its opinions.
export function mergePrivateFields(prev: Player[], full: Player[]): Player[] {
  const byId = new Map(full.map((p) => [p.id, p]));
  return prev.map((p) => {
    const remote = byId.get(p.id);
    if (!remote) return p;
    return {
      ...p,
      chemistry: remote.chemistry ?? [],
      avoid: remote.avoid ?? [],
      aliases: remote.aliases ?? [],
      rating: remote.rating ?? p.rating,
      attack: remote.attack ?? p.attack,
    };
  });
}
