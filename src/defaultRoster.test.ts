import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYERS } from './defaultRoster';

// The bundled seed roster, guarded for one thing only: that it carries no
// opinion about anybody (§2.28).
//
// **This file exists because the leak it prevents actually shipped.** The
// Worker strips `rating`, `attack`, `avoid`, `chemistry` and `aliases` out of
// the public `GET /roster`, and every one of those was readable anyway from
// `defaultRoster.ts` — which is compiled into the JS bundle every viewer
// downloads, out of a public repository. Twenty-one players' ratings, in the
// open, while the endpoint next door was carefully removing them.
//
// The way it comes back is not malice, it is convenience: the update
// instructions say "Roster tab → Export, then replace the array below", and an
// export contains the real numbers. So the guard is a test rather than a
// comment, because a comment does not fail a build.

describe('the bundled default roster', () => {
  it('still has the squad in it', () => {
    // Guards the opposite failure — a "privacy fix" that empties the file and
    // leaves a first-time visitor looking at nothing.
    expect(DEFAULT_PLAYERS.length).toBeGreaterThan(10);
    for (const p of DEFAULT_PLAYERS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
    }
  });

  it('tells nobody what the organiser thinks of anybody', () => {
    // Not "no ratings" — `rating` is a required field — but *no information*
    // in them: every player identical, so the array says nothing about anyone.
    // One shared value cannot rank a squad however it is read.
    const ratings = new Set(DEFAULT_PLAYERS.map((p) => p.rating));
    expect(ratings.size).toBe(1);

    // Same argument for the role spectrum, which is private for the same
    // reason and renders as a visible badge on every roster row.
    const attacks = new Set(DEFAULT_PLAYERS.map((p) => p.attack));
    expect(attacks.size).toBe(1);
  });

  it('carries no keep-apart list, chemistry or aliases', () => {
    // The socially sharpest of the private fields: `avoid` is who will not
    // play with whom. Empty here, always — it reaches an organiser's device
    // from /roster/full and nowhere else.
    for (const p of DEFAULT_PLAYERS) {
      expect(p.avoid ?? []).toHaveLength(0);
      expect(p.chemistry).toHaveLength(0);
      expect(p.aliases ?? []).toHaveLength(0);
    }
  });

  it('seeds the same neutral values the merge already falls back to', () => {
    // RATING_UNSEEN and ATTACK_DEFAULT. Pinned so the seed and
    // `mergePublicRoster`'s fallback cannot drift apart and start showing a
    // player two different neutral numbers depending on which one got there
    // first.
    for (const p of DEFAULT_PLAYERS) {
      expect(p.rating).toBe(3);
      expect(p.attack).toBe(50);
    }
  });
});
