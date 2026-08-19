// Reconciling the shared roster with what a device already holds.
//
// These exist because the public roster read is deliberately incomplete: the
// worker strips `chemistry`, `avoid` and `aliases` from GET /roster, since
// that endpoint is unauthenticated and "who won't play with whom" is not
// something to hand the open internet (see PublicPlayer in remote.ts). The
// cost of that is that a pull can no longer be a straight replace — it would
// blank the very fields it isn't allowed to carry — so the two directions get
// merged instead.

import type { Player } from './types';
import { migratePlayer } from './types';
import type { PublicPlayer } from './remote';

// Adopt a shared roster without losing what only this device holds. Names,
// ratings, shirt numbers and the attack spectrum come from the shared copy;
// the three private fields are kept from whatever this device already had for
// that player, and start empty for someone it is meeting for the first time.
export function mergePublicRoster(prev: Player[], remote: PublicPlayer[]): Player[] {
  const local = new Map(prev.map((p) => [p.id, p]));
  return remote.map((p) => {
    const had = local.get(p.id);
    return migratePlayer({
      ...(p as Player),
      chemistry: had?.chemistry ?? [],
      avoid: had?.avoid ?? [],
      aliases: had?.aliases ?? [],
    });
  });
}

// The other direction, run once admin is unlocked: keep this device's
// names/ratings (the public pull already refreshed those) and fill in only the
// private fields from the admin-only read. Players the shared copy doesn't
// know about — a guest added locally — keep exactly what they had, so
// rehydrating never costs a local edit.
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
    };
  });
}
